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
  return text
    .replace(/â‚¹/g, "₹") // Common UTF-8-as-Windows-1252 OCR artefact.
    .replace(/\s+/g, " ")
    .trim();
}

function validBox(box) {
  return (
    Array.isArray(box) &&
    box.length === 4 &&
    box.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))
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
          typeof item.confidence === "number" && Number.isFinite(item.confidence)
            ? item.confidence
            : null,
        index,
      };
    })
    .filter(Boolean);
}

function matchMrp(text) {
  const match = text.match(
    /m\s*\.?\s*r\s*\.?\s*p\s*\.?\s*[:\-]?\s*(?:rs\.?|inr|₹)\s*(\d+(?:\.\d{1,2})?)/i,
  );
  return match ? `₹${match[1]}` : null;
}

function matchNetQuantity(text) {
  const match = text.match(
    /net\s*(?:weight|wt\.?|qty\.?|quantity)\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|l)\b/i,
  );
  return match ? `${match[1]} ${match[2].toLowerCase()}` : null;
}

function matchPackingDate(text) {
  const match = text.match(
    /(?:packed(?:\s+on)?|packing\s+date|mfg(?:\s+date)?|manufactured|manufacturing\s+date)\s*[:\-]?\s*(?:on\s*)?(0[1-9]|1[0-2])\s*[/-]\s*(\d{4})/i,
  );
  return match ? `${match[1]}/${match[2]}` : null;
}

function matchManufacturer(text) {
  const match = text.match(
    /(?:manufactured\s*(?:&|and)\s*packed\s+by|manufactured\s+and\s+marketed\s+by|manufactured\s+by|packed\s+by|marketed\s+by|packer)\s*[:\-]?\s*(.+)$/i,
  );
  if (!match) return null;

  const name = match[1].trim().replace(/[;,]+$/, "").trim();
  return name ? name : null;
}

function matchConsumerCare(text) {
  const label = /(?:customer\s+care|consumer\s+care|consumer\s+complaint|helpline|toll\s*free|contact\s+us)/i;
  if (!label.test(text)) return null;

  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (email) return email[0];

  const phone = text.match(/(?:\+\s*\d{1,3}[\s-]*)?(?:\(?\d{2,4}\)?[\s-]*)?\d{3,5}[\s-]\d{3,6}(?:[\s-]\d{2,6})?/);
  return phone ? phone[0].replace(/\s+/g, " ").trim() : null;
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

  // Higher confidence wins. Missing confidence ranks below a numeric confidence;
  // ties retain OCR input order for deterministic results.
  return candidates.reduce((best, candidate) => {
    const bestScore = best.block.confidence === null ? -Infinity : best.block.confidence;
    const candidateScore =
      candidate.block.confidence === null ? -Infinity : candidate.block.confidence;
    return candidateScore > bestScore ? candidate : best;
  });
}

/**
 * Convert OCR text blocks into the five locked declaration fields.
 * @param {Array<{text: string, box: number[], confidence?: number}>|null} ocrBlocks
 * @returns {{mrp: {value: string|null, box: number[]|null}, net_quantity: {value: string|null, box: number[]|null}, manufacturer: {value: string|null, box: number[]|null}, packing_date: {value: string|null, box: number[]|null}, consumer_care: {value: string|null, box: number[]|null}}}
 */
function extractDeclarations(ocrBlocks) {
  const result = emptyResult();
  const blocks = usableBlocks(ocrBlocks);

  for (const field of FIELD_NAMES) {
    const candidates = blocks
      .map((block) => ({ value: MATCHERS[field](block.text), block }))
      .filter((candidate) => candidate.value !== null);
    const candidate = bestCandidate(candidates);

    if (candidate) {
      result[field] = { value: candidate.value, box: candidate.block.box };
    }
  }

  return result;
}

module.exports = { extractDeclarations };
