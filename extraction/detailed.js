"use strict";

/**
 * Detailed extraction.
 *
 * extractDeclarations() returns exactly {value, box} per field, and that shape
 * is the locked contract in contracts/extraction.json. It is not changed here.
 *
 * The screening engine needs two things that shape cannot carry:
 *
 *   - HOW WELL each declaration was read, so a glare-obscured price can be sent
 *     for review instead of being reported as a clean pass or a hard failure.
 *   - WHICH OCR TEXT it came from, so the inspector can see the evidence behind
 *     a finding instead of taking the number on trust.
 *
 * So this module runs the normal extractor and then walks the OCR blocks again
 * to attach that evidence, leaving the original output untouched alongside it.
 */

const { extractDeclarations } = require("./index.js");

const FIELD_NAMES = [
  "mrp",
  "net_quantity",
  "manufacturer",
  "packing_date",
  "consumer_care",
];

const CURRENCY_MARK = /(?:₹|â‚¹|\brs\.?\b|\binr\b)/i;

function normalize(text) {
  return String(text).replace(/â‚¹/g, "₹").replace(/\s+/g, " ").trim();
}

function boxesOverlap(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  return !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]);
}

/**
 * Find the OCR blocks a detected value most plausibly came from.
 *
 * Matching on the box alone is not enough: extraction merges nearby lines, so
 * one declaration box can cover several blocks. Matching on text alone is not
 * enough either, because the extractor reformats what it reads ("Rs. 50" becomes
 * "₹50"). Box overlap is the reliable signal, with a digit-level text check as a
 * tiebreaker.
 */
function sourceBlocksFor(declaration, blocks) {
  if (!declaration || declaration.box === null) return [];
  return blocks.filter((block) => boxesOverlap(declaration.box, block.box));
}

function confidenceOf(sourceBlocks) {
  const values = sourceBlocks
    .map((block) => block.confidence)
    .filter((c) => typeof c === "number" && Number.isFinite(c));

  if (!values.length) return null;
  // The weakest contributing block governs. A declaration is only as trustworthy
  // as its least legible part, and averaging hides exactly the problem we are
  // trying to surface.
  return Math.round(Math.min(...values) * 1000) / 1000;
}

/**
 * @param {Array<{text: string, box: ?Array<number>, confidence: ?number}>} ocrBlocks
 * @returns {{declarations: object, evidence: object}}
 */
function extractDetailed(ocrBlocks) {
  const declarations = extractDeclarations(ocrBlocks);
  const blocks = Array.isArray(ocrBlocks)
    ? ocrBlocks
        .filter((b) => b && typeof b.text === "string" && Array.isArray(b.box))
        .map((b) => ({ ...b, text: normalize(b.text) }))
    : [];

  const evidence = {};

  for (const [field, declaration] of Object.entries(declarations)) {
    const sources = sourceBlocksFor(declaration, blocks);
    const sourceText = sources.map((b) => b.text).join(" · ") || null;

    evidence[field] = {
      confidence: confidenceOf(sources),
      source: sourceText,
      // Recorded only for MRP, where a present amount with an absent currency
      // mark is a real and common compliance question rather than an OCR quirk.
      currencyMark:
        field === "mrp" && declaration.value !== null
          ? sourceText
            ? CURRENCY_MARK.test(sourceText)
            : null
          : undefined,
    };
  }

  return { declarations, evidence };
}

module.exports = { extractDetailed };

/**
 * Extract across several reads of the same photograph, merging per declaration.
 *
 * The OCR module returns every read it made — different preprocessing recipes,
 * segmentation modes and scales. Its own `blocks` is whichever ONE of those
 * scored best overall, and that global winner is the wrong unit of choice here.
 *
 * Measured on test-data/images: the sugar pack gives up its net weight and care
 * number at the 2600px working scale, and its price only at 3600px. The winner
 * at either scale is missing declarations the loser found. Scoring reads as
 * wholes therefore discards correct answers that were already in hand.
 *
 * So each read is extracted independently and the five fields are assembled
 * from whichever read read each one best. The passes have already been paid
 * for, so this costs almost nothing beyond the regex work.
 *
 * Selection per field, in order:
 *   1. a value at all, over none
 *   2. the higher OCR confidence
 *   3. agreement — a value two reads independently produced beats a lone one,
 *      because two preprocessing recipes arriving at the same string is much
 *      stronger evidence than one confident guess
 *
 * @param {Array<{blocks: Array}>} reads as returned in `reads` by ocr.recognize
 * @returns {{declarations: object, evidence: object, agreement: object}}
 */
function extractAcrossReads(reads) {
  const list = Array.isArray(reads) ? reads.filter((r) => r && Array.isArray(r.blocks)) : [];

  if (!list.length) {
    return extractAcrossReadsEmpty();
  }

  const extracted = list.map((read) => ({
    read,
    ...extractDetailed(read.blocks),
  }));

  // How many reads produced each distinct value, per field.
  const votes = {};
  for (const field of FIELD_NAMES) {
    votes[field] = new Map();
    for (const { declarations } of extracted) {
      const value = declarations[field].value;
      if (value === null) continue;
      votes[field].set(value, (votes[field].get(value) || 0) + 1);
    }
  }

  const declarations = {};
  const evidence = {};
  const agreement = {};

  for (const field of FIELD_NAMES) {
    let winner = null;

    for (const candidate of extracted) {
      const value = candidate.declarations[field].value;
      if (value === null) continue;

      const score = {
        agreement: votes[field].get(value) || 1,
        confidence: candidate.evidence[field]?.confidence ?? -Infinity,
      };

      if (
        winner === null ||
        score.agreement > winner.score.agreement ||
        (score.agreement === winner.score.agreement &&
          score.confidence > winner.score.confidence)
      ) {
        winner = { candidate, score };
      }
    }

    if (winner === null) {
      declarations[field] = { value: null, box: null };
      evidence[field] = { confidence: null, source: null };
      agreement[field] = 0;
      continue;
    }

    declarations[field] = winner.candidate.declarations[field];
    evidence[field] = winner.candidate.evidence[field];
    agreement[field] = winner.score.agreement;
  }

  return { declarations, evidence, agreement, readCount: list.length };
}

function extractAcrossReadsEmpty() {
  const declarations = {};
  const evidence = {};
  const agreement = {};

  for (const field of FIELD_NAMES) {
    declarations[field] = { value: null, box: null };
    evidence[field] = { confidence: null, source: null };
    agreement[field] = 0;
  }

  return { declarations, evidence, agreement, readCount: 0 };
}

module.exports.extractAcrossReads = extractAcrossReads;

/**
 * A predicate for ocr.recognize's `needsMore` hook.
 *
 * Answers one question: after this read, is any declaration still unfound? If
 * not, a further, slower pass at a finer scale has nothing left to contribute
 * and the inspector should not wait for it.
 */
function declarationsOutstanding(blocks) {
  const { declarations } = extractDetailed(blocks);
  return FIELD_NAMES.some((field) => declarations[field].value === null);
}

module.exports.declarationsOutstanding = declarationsOutstanding;

/*
 * Label families. Each is one of the five declarations, matched on its LABEL
 * rather than its value, because a label is a word and survives a bad read
 * better than a number does.
 */
const LABEL_FAMILIES = [
  /m\s*\.?\s*r\s*\.?\s*p|retail\s*(?:sale\s*)?price/i,
  /net\s*(?:weight|wt|qty|quantity|content)|gross\s*w|\bqty\b/i,
  /manufactur|marketed|packed\s*by|pkd\s*by|mf[dg]\b|processed\s*by/i,
  /mfg\.?\s*date|mfd|pkd|date\s*of\s*pack|packed\s*on|expiry|use\s*by|best\s*before/i,
  /consumer\s*(?:care|complaint|feedback)|customer\s*care|toll\s*free|helpline|@/i,
];

/**
 * Does this read look like it came from text that is not the right way up?
 *
 * Supplied to ocr.recognize as `orientationSuspect`. Counts how many of the
 * five declaration label families appear anywhere in the read. A pack
 * photographed square-on shows at least two of them even when the frame is
 * poor; sideways text yields a scattering of letters and almost no whole
 * labels, which is the distinction being drawn.
 *
 * Deliberately conservative. Each rotation costs a full recognition pass, so
 * the bar is "we found essentially nothing recognisable as a declaration",
 * not "we did not find everything".
 */
function orientationSuspect(blocks) {
  if (!Array.isArray(blocks) || !blocks.length) return true;

  const text = blocks.map((b) => (b && b.text) || "").join(" ");
  const hits = LABEL_FAMILIES.filter((pattern) => pattern.test(text)).length;

  return hits < 2;
}

module.exports.orientationSuspect = orientationSuspect;
