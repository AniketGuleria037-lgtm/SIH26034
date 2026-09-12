"use strict";

const FIELD_NAMES = [
  "mrp",
  "net_quantity",
  "manufacturer",
  "packing_date",
  "consumer_care",
];

function emptyResult() {
  return Object.fromEntries(
    FIELD_NAMES.map((field) => [field, { value: null, box: null }]),
  );
}

function normalizeText(text) {
  return String(text)
    .replace(/â‚¹/g, "₹")
    .replace(/\s+/g, " ")
    .trim();
}

function validBox(box) {
  return (
    Array.isArray(box) &&
    box.length === 4 &&
    box.every(
      (coordinate) =>
        typeof coordinate === "number" && Number.isFinite(coordinate),
    )
  );
}

function usableBlocks(ocrBlocks) {
  if (!Array.isArray(ocrBlocks)) return [];

  return ocrBlocks
    .map((item, index) => {
      if (!item || typeof item.text !== "string") return null;

      const text = normalizeText(item.text);

      if (!text) return null;

      return {
        text,
        box: validBox(item.box) ? item.box : null,
        confidence:
          typeof item.confidence === "number" &&
          Number.isFinite(item.confidence)
            ? item.confidence
            : null,
        index,
      };
    })
    .filter(Boolean);
}

function mergeBoxes(a, b) {
  if (!a || !b) return a || b || null;

  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.max(a[2], b[2]),
    Math.max(a[3], b[3]),
  ];
}

function combinedConfidence(a, b) {
  if (a === null && b === null) return null;
  if (a === null) return b;
  if (b === null) return a;

  return Math.min(a, b);
}

/* ---------------- MRP ---------------- */

function matchMrp(text) {
  const labeled = text.match(
    /m\s*\.?\s*r\s*\.?\s*p\s*\.?\s*[:\-]?\s*(?:rs\.?|inr|₹|â‚¹)?\s*(\d+(?:\.\d{1,2})?)/i,
  );

  if (labeled) {
    return `₹${labeled[1]}`;
  }

  const standalone = text.match(
    /(?:rs\.?|inr|₹|â‚¹)\s*(\d+(?:\.\d{1,2})?)\b/i,
  );

  return standalone ? `₹${standalone[1]}` : null;
}

/* ---------------- NET QUANTITY ---------------- */

function matchNetQuantity(text) {
  const labeled = text.match(
    /net\s*(?:weight|wt\.?|qty\.?|quantity|ory)\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|l)\b/i,
  );

  if (labeled) {
    return `${labeled[1]} ${labeled[2].toLowerCase()}`;
  }

  const netAnywhere = text.match(
    /\bnet\b.*?(\d+(?:\.\d+)?)\s*(kg|g|ml|l)\b/i,
  );

  if (netAnywhere) {
    return `${netAnywhere[1]} ${netAnywhere[2].toLowerCase()}`;
  }

  return null;
}

/* ---------------- PACKING DATE ---------------- */

function matchPackingDate(text) {
  // Explicit manufacturing/packing date.
  // Prefer this over "Use By".
  const manufacturingDate = text.match(
    /(?:mfd\.?|mfg\.?|manufactured|manufacturing|packed|packing)\s*(?:date)?\s*[:\-]?\s*(\d{1,2})\s*[\/\-]\s*(\d{1,2})\s*[\/\-]\s*(\d{4})/i,
  );

  if (manufacturingDate) {
    const month = manufacturingDate[2].padStart(2, "0");
    return `${month}/${manufacturingDate[3]}`;
  }

  // MM/YYYY format.
  const monthYear = text.match(
    /(?:mfd\.?|mfg\.?|manufactured|manufacturing|packed|packing)\s*(?:date)?\s*[:\-]?\s*(0[1-9]|1[0-2])\s*[\/\-]\s*(\d{4})/i,
  );

  if (monthYear) {
    return `${monthYear[1]}/${monthYear[2]}`;
  }

  return null;
}

/* ---------------- MANUFACTURER ---------------- */

function matchManufacturer(text) {
  const match = text.match(
    /(?:manufactured\s*(?:&|and)\s*packed\s+by|manufactured\s+and\s+marketed\s+by|manufactured\s+by|packed\s+by|marketed\s+by|packer)\s*[:\-]?\s*(.+)$/i,
  );

  if (!match) return null;

  const name = match[1]
    .trim()
    .replace(/^[,:;\-\s]+/, "")
    .replace(/[;,]+$/, "")
    .trim();

  // Never accept punctuation or a very short meaningless OCR fragment.
  if (!name || name.length < 3) return null;

  return name;
}

/* ---------------- CONSUMER CARE ---------------- */

function matchConsumerCare(text) {
  const email = text.match(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  );

  if (email) {
    return email[0];
  }

  const phone = text.match(
  /\b1800[\s-]?\d{2,4}[\s-]?\d{3,4}\b|\b(?:\+\s*\d{1,3}[\s-]*)?(?:\(?\d{2,4}\)?[\s-]*)?\d{3,5}[\s-]\d{3,6}(?:[\s-]\d{2,6})?/,
  );

  if (phone) {
    return phone[0].replace(/\s+/g, " ").trim();
  }

  return null;
}

const MATCHERS = {
  mrp: matchMrp,
  net_quantity: matchNetQuantity,
  manufacturer: matchManufacturer,
  packing_date: matchPackingDate,
  consumer_care: matchConsumerCare,
};

function bestCandidate(candidates) {
  if (candidates.length === 0) return null;

  return candidates.reduce((best, candidate) => {
    const bestScore =
      best.block.confidence === null ? -Infinity : best.block.confidence;

    const candidateScore =
      candidate.block.confidence === null
        ? -Infinity
        : candidate.block.confidence;

    return candidateScore > bestScore ? candidate : best;
  });
}

/*
 * Create combinations of nearby OCR blocks.
 *
 * This handles real OCR such as:
 *
 * "Manufactured By:"
 * "PepsiCo India Holdings Pvt. Ltd."
 *
 * or:
 *
 * "For consumer feedback, contact:"
 * "The Consumer Services Manager..."
 * "Call: 1800 22 4020"
 */
function nearbyCombinations(blocks) {
  const combinations = [];

  for (let i = 0; i < blocks.length; i++) {
    combinations.push({
      text: blocks[i].text,
      box: blocks[i].box,
      confidence: blocks[i].confidence,
      index: blocks[i].index,
    });

    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i];
      const b = blocks[j];

      if (!a.box || !b.box) continue;

      const verticalDistance = Math.abs(b.box[1] - a.box[3]);

      // Only combine reasonably nearby lines.
      if (verticalDistance > 160) continue;

      combinations.push({
        text: `${a.text} ${b.text}`,
        box: mergeBoxes(a.box, b.box),
        confidence: combinedConfidence(
          a.confidence,
          b.confidence,
        ),
        index: Math.min(a.index, b.index),
      });
    }
  }

  return combinations;
}

function extractDeclarations(ocrBlocks) {
  const result = emptyResult();
  const blocks = usableBlocks(ocrBlocks);

  if (blocks.length === 0) {
    return result;
  }

  /*
   * First pass:
   * Try each OCR block independently.
   */
  for (const field of ["net_quantity"]) {
    const candidates = blocks
      .map((block) => ({
        value: MATCHERS[field](block.text),
        block,
      }))
      .filter((candidate) => candidate.value !== null);

    const candidate = bestCandidate(candidates);

    if (candidate) {
      result[field] = {
        value: candidate.value,
        box: candidate.block.box,
      };
    }
  }
    // Manufacturer is often split by OCR into:
  // "Manufactured By:"
  // "PepsiCo India Holdings Pvt. Ltd."
  if (result.manufacturer.value === null) {
    for (let i = 0; i < blocks.length - 1; i++) {
      const current = blocks[i];
      const next = blocks[i + 1];

      if (!/manufactured\s+by|packed\s+by|marketed\s+by/i.test(current.text)) {
        continue;
      }

      if (!next.text || next.text.length < 3) {
        continue;
      }

      if (current.box && next.box) {
        const verticalGap = next.box[1] - current.box[3];

        if (verticalGap < -20 || verticalGap > 100) {
          continue;
        }
      }

      result.manufacturer = {
        value: next.text.replace(/^[,:;\-\s]+/, "").trim(),
        box: mergeBoxes(current.box, next.box),
      };

      break;
    }
  }

    // Consumer-care information is often spread over multiple OCR lines.
  if (result.consumer_care.value === null) {
    const labelIndex = blocks.findIndex((block) =>
      /consumer\s+(?:care|feedback|complaint)|customer\s+care|helpline|contact\s+us/i.test(
        block.text,
      ),
    );

    if (labelIndex !== -1) {
      for (
        let i = labelIndex;
        i < Math.min(blocks.length, labelIndex + 12);
        i++
      ) {
        const candidate = matchConsumerCare(blocks[i].text);

        if (candidate) {
          result.consumer_care = {
            value: candidate,
            box: blocks[i].box,
          };
          break;
        }
      }
    }

    if (result.consumer_care.value === null) {
      for (const block of blocks) {
        if (/call\s*:/i.test(block.text)) {
          const candidate = matchConsumerCare(block.text);

          if (candidate) {
            result.consumer_care = {
              value: candidate,
              box: block.box,
            };
            break;
          }
        }
      }
    }
  }

  /*
   * Second pass:
   * Try nearby OCR blocks together.
   */
  const combinedBlocks = nearbyCombinations(blocks);

  for (const field of FIELD_NAMES) {
    const candidates = combinedBlocks
      .map((block) => ({
        value: MATCHERS[field](block.text),
        block,
      }))
      .filter((candidate) => candidate.value !== null);

    const candidate = bestCandidate(candidates);

    if (!candidate) continue;

    /*
     * Only replace an existing result when:
     * - the existing value is missing, OR
     * - the combined result has better confidence.
     */
    if (result[field].value === null) {
      result[field] = {
        value: candidate.value,
        box: candidate.block.box,
      };
      continue;
    }
    if (!candidate) continue;

    if (result[field].value === null) {
      result[field] = {
        value: candidate.value,
        box: candidate.block.box,
      };
    }
  }

  return result;
}

module.exports = {
  extractDeclarations,
};