"use strict";

/**
 * Turning recognised words into the text blocks the extraction module consumes.
 *
 * This matters more than it looks. The extraction module matches whole strings:
 * "Net Weight 200 g", "Manufactured by ABC Foods Pvt Ltd". If OCR emits one
 * block per word, not one of those patterns can ever match and every field
 * comes back null through no fault of the extractor.
 *
 * So this module is responsible for producing text at the granularity the
 * contract actually needs:
 *
 *   line       - words sharing a visual baseline, merged left to right
 *   paragraph  - consecutive lines the recogniser grouped together
 *
 * Both are emitted by default, because Indian packaging routinely wraps a
 * declaration across two lines -- "Manufactured & Packed by:" on one, the
 * company name on the next. At line granularity that manufacturer is
 * unmatchable; at paragraph granularity it matches cleanly. Emitting both
 * costs nothing: extraction keeps the highest-confidence candidate, and a
 * field that matches at only one granularity simply has one candidate.
 */

/** Convert a Tesseract bbox object into the contract's [x1, y1, x2, y2]. */
function toBox(bbox, scale = 1) {
  if (!bbox) return null;
  const box = [
    Math.round(bbox.x0 * scale),
    Math.round(bbox.y0 * scale),
    Math.round(bbox.x1 * scale),
    Math.round(bbox.y1 * scale),
  ];
  return box.every((n) => Number.isFinite(n)) ? box : null;
}

function unionBox(boxes) {
  const valid = boxes.filter(Boolean);
  if (!valid.length) return null;
  return [
    Math.min(...valid.map((b) => b[0])),
    Math.min(...valid.map((b) => b[1])),
    Math.max(...valid.map((b) => b[2])),
    Math.max(...valid.map((b) => b[3])),
  ];
}

/** Tesseract reports 0-100; the contract and the sample data use 0-1. */
function toUnit(confidence) {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return null;
  return Math.round(Math.min(100, Math.max(0, confidence)) * 10) / 1000;
}

function meanConfidence(items) {
  const values = items.map((i) => i.confidence).filter((c) => typeof c === "number");
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Is this token real text, or recognition debris?
 *
 * A failed read does not return nothing. It returns confident rubbish: "r D",
 * "a", "2.", "i AS". Counting raw tokens sees text where there is none, so the
 * legibility signal has to count tokens that look like words.
 */
function isSubstantive(text) {
  const clean = text.trim();

  // A recognised word never contains a space. When the recogniser is guessing
  // it emits scattered marks that arrive as "i AS" or "r D" -- the space is the
  // tell, and it is a far more reliable one than any ratio threshold. Beyond
  // that, three alphanumeric characters is the bar: it keeps real content like
  // "20.00" and "Foods" while dropping "2." and "a".
  if (!clean || /\s/.test(clean)) return false;
  const alnum = (clean.match(/[A-Za-z0-9\u0900-\u097F]/g) || []).length;
  return alnum >= 3;
}

/** Collect every word from the nested Tesseract result, flattened. */
function flattenWords(data, scale = 1) {
  const words = [];
  for (const block of data.blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        for (const word of line.words || []) {
          const text = (word.text || "").trim();
          if (!text) continue;
          words.push({
            text,
            box: toBox(word.bbox, scale),
            confidence: toUnit(word.confidence),
            rawConfidence: word.confidence,
          });
        }
      }
    }
  }
  return words;
}

/**
 * Re-group words into lines by geometry rather than trusting the recogniser's
 * own line structure.
 *
 * Packaging text is set in columns and around curves, and in that layout
 * Tesseract splits a single visual row into several lines -- which is how a
 * promotional flash beside the net quantity ends up in a different line from
 * the declaration it crowds. Grouping on shared vertical centre, with a
 * tolerance proportional to glyph height, recovers the row a human sees.
 */
const MIN_HEIGHT_RATIO = 0.55;
const MAX_HEIGHT_RATIO = 1.8;

function groupWordsIntoLines(words, toleranceRatio = 0.6) {
  const pending = words
    .filter((w) => w.box)
    .slice()
    .sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0]);

  const used = new Array(pending.length).fill(false);
  const lines = [];

  for (let i = 0; i < pending.length; i += 1) {
    if (used[i]) continue;
    const seed = pending[i];
    const height = seed.box[3] - seed.box[1];
    const centre = seed.box[1] + height / 2;
    const tolerance = Math.max(4, height * toleranceRatio);

    const group = [seed];
    used[i] = true;

    for (let j = i + 1; j < pending.length; j += 1) {
      if (used[j]) continue;
      const other = pending[j];
      const otherHeight = other.box[3] - other.box[1];
      const otherCentre = other.box[1] + otherHeight / 2;
      if (Math.abs(otherCentre - centre) > tolerance) continue;

      // Sharing a baseline is not enough. Packaging sets promotional flashes in
      // tiny type right beside a declaration -- "FREE 10% EXTRA" next to the net
      // quantity -- and their centres line up. Merging them corrupted the
      // declaration into "Net et Ot Qty: 100 g FREE 10% EXTRA", which the
      // extractor cannot match. Text at a markedly different size is a
      // different piece of printing, whatever row it sits on.
      const heightRatio = otherHeight / Math.max(1, height);
      if (heightRatio < MIN_HEIGHT_RATIO || heightRatio > MAX_HEIGHT_RATIO) continue;

      group.push(other);
      used[j] = true;
    }

    group.sort((a, b) => a.box[0] - b.box[0]);
    lines.push({
      text: group.map((w) => w.text).join(" "),
      box: unionBox(group.map((w) => w.box)),
      confidence: toUnit(meanConfidence(group.map((w) => ({ confidence: w.rawConfidence })))),
      words: group.length,
      source: "line",
    });
  }

  return lines.sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0]);
}

/**
 * Merge consecutive lines that form one wrapped declaration.
 *
 * This is the fix for the most common real-world integration failure in this
 * project. Indian packaging sets a declaration as a caption on one line and its
 * value on the next:
 *
 *     Manufactured & Packed by:
 *     Sunrise Foods Private Limited
 *
 * The extraction module matches whole strings -- its manufacturer pattern needs
 * the name to follow "by" in the same block. At line granularity that
 * manufacturer is unmatchable and comes back null, through no fault of the
 * extractor. The same happens to consumer care.
 *
 * Tesseract's own paragraph grouping does not solve it: on the test labels it
 * grouped "Best Before ..." together with "Manufactured & Packed by:" and left
 * the company name in a paragraph of its own.
 *
 * So we do the layout analysis ourselves, on pure geometry and no domain
 * knowledge: two lines belong to one wrapped declaration when they are
 * vertically adjacent (the gap is small relative to their height) and share a
 * left margin (the same text column). That is what a wrapped line looks like,
 * and it is decided without knowing anything about what the text says.
 *
 * The merged blocks are emitted ALONGSIDE the individual lines, never instead
 * of them, so a declaration that fits on one line keeps its tight bounding box
 * for highlighting.
 */
function adaptiveGapThreshold(ratios, fallback = 0.85) {
  // Line spacing inside a wrapped declaration and spacing between separate
  // declarations form two clusters. On the test labels: 0.25-0.74 within, and
  // 1.03-1.78 between. Rather than hardcode a boundary that will not survive a
  // different font or layout, we find the widest jump in the sorted
  // distribution and split there -- the same one-dimensional clustering idea
  // used for choosing a threshold from a histogram.
  const usable = ratios.filter((r) => Number.isFinite(r) && r >= 0 && r <= 3).sort((a, b) => a - b);
  if (usable.length < 4) return fallback;

  // Maximise between-class variance (Otsu). Picking the single widest jump is
  // not enough: on the test labels the widest jump sat at 1.15|1.59, splitting
  // two outliers off the top, while the real boundary was at 0.74|1.03.
  // Weighting by cluster size finds the boundary that actually separates the
  // two populations rather than the one with the showiest gap.
  const prefix = [0];
  for (let i = 0; i < usable.length; i += 1) prefix.push(prefix[i] + usable[i]);

  let bestSplit = -1;
  let bestVariance = 0;
  for (let i = 1; i < usable.length; i += 1) {
    const midpoint = (usable[i] + usable[i - 1]) / 2;
    if (midpoint < 0.4 || midpoint > 1.4) continue;
    if (usable[i] - usable[i - 1] < 0.08) continue; // inside one cluster

    const n1 = i;
    const n2 = usable.length - i;
    const mean1 = prefix[i] / n1;
    const mean2 = (prefix[usable.length] - prefix[i]) / n2;
    const variance = n1 * n2 * (mean1 - mean2) ** 2;

    if (variance > bestVariance) {
      bestVariance = variance;
      bestSplit = midpoint;
    }
  }

  return bestSplit > 0 && bestVariance > 0 ? bestSplit : fallback;
}

function mergeWrappedLines(sorted, options = {}) {
  const alignTolerance = options.alignTolerance ?? 0.06; // of image width
  const maxSpan = options.maxSpan ?? 2;         // lines joined per merged block

  const ratios = [];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (!a.box || !b.box) continue;
    const height = a.box[3] - a.box[1];
    if (height > 0) ratios.push((b.box[1] - a.box[3]) / height);
  }
  const gapRatio = options.gapRatio ?? adaptiveGapThreshold(ratios);

  const merged = [];

  for (let i = 0; i < sorted.length - 1; i += 1) {
    const group = [sorted[i]];

    for (let j = i + 1; j < Math.min(i + maxSpan, sorted.length); j += 1) {
      const previous = group[group.length - 1];
      const next = sorted[j];
      if (!previous.box || !next.box) break;

      const previousHeight = previous.box[3] - previous.box[1];
      const gap = next.box[1] - previous.box[3];
      const leftShift = Math.abs(next.box[0] - previous.box[0]);
      const width = Math.max(previous.box[2], next.box[2]);

      const adjacent = gap >= -previousHeight * 0.3 && gap <= previousHeight * gapRatio;
      const aligned = leftShift <= Math.max(12, width * alignTolerance);
      if (!adjacent || !aligned) break;

      group.push(next);
    }

    if (group.length < 2) continue;

    merged.push({
      text: group.map((l) => l.text).join(" ").replace(/\s+/g, " ").trim(),
      box: unionBox(group.map((l) => l.box)),
      confidence: toUnit(
        (meanConfidence(group.map((l) => ({ confidence: l.confidence }))) || 0) * 100
      ),
      words: group.reduce((n, l) => n + (l.words || 0), 0),
      source: "wrapped",
      lineCount: group.length,
    });
  }

  return merged;
}

/**
 * Score a recognition result so competing preprocessing variants can be ranked.
 *
 * Mean confidence alone is a trap: a variant that finds three words at 0.95
 * outranks one that finds sixty at 0.88, and the second is plainly the better
 * read. The score therefore rewards volume of confident, word-shaped text, and
 * caps the contribution of any single token so one long spurious string cannot
 * win on its own.
 */
function scoreWords(words) {
  let score = 0;
  for (const word of words) {
    if (!isSubstantive(word.text)) continue;
    const confidence = word.confidence == null ? 0.3 : word.confidence;
    score += confidence * Math.min(word.text.length, 8);
  }
  return Math.round(score * 100) / 100;
}

module.exports = {
  toBox,
  toUnit,
  unionBox,
  flattenWords,
  groupWordsIntoLines,
  mergeWrappedLines,
  adaptiveGapThreshold,
  scoreWords,
  isSubstantive,
};
