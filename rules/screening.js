"use strict";

/**
 * Screening engine.
 *
 * evaluateCompliance() in ./index.js answers a narrow question: does each
 * declaration pass or fail. That is the contract the other modules were built
 * against and it is left exactly as it was.
 *
 * This module answers the question an inspector actually asks, which is a
 * different one: what do I need to look at, and why. The differences that
 * matter:
 *
 *   1. FOUR OUTCOMES, NOT TWO. A declaration that was never detected is a
 *      different problem from one that was read at low confidence. The first is
 *      a possible violation; the second is a possible bad photograph. Collapsing
 *      them into FAIL is how an automated checker turns a glare spot into a
 *      prosecution. So: PASS / REVIEW / MISSING / FAIL.
 *
 *   2. AN ILLEGIBLE FRAME SHORT-CIRCUITS EVERYTHING. If OCR reports the image
 *      was not readable, no declaration is reported as absent. Five missing
 *      fields and one unreadable photograph look identical to a rules engine and
 *      could not be more different to an inspector.
 *
 *   3. EVERY OUTCOME IS TRACEABLE. Each declaration carries its catalogue ID and
 *      rule citation so the finding, the table row and the generated report all
 *      refer to the same thing.
 *
 * Nothing here decides anything. The verdict is a screening suggestion and is
 * labelled as one all the way through to the PDF.
 */

const fs = require("fs");
const path = require("path");

const catalogPath = path.join(__dirname, "catalog.json");

const STATUS = {
  PASS: "PASS",
  REVIEW: "REVIEW",
  MISSING: "MISSING",
  FAIL: "FAIL",
};

const CODE = {
  MISSING_FIELD: "MISSING FIELD",
  FORMAT: "FORMAT",
  LEGIBILITY: "LEGIBILITY",
  FRAME: "FRAME QUALITY",
};

function loadCatalog() {
  return JSON.parse(fs.readFileSync(catalogPath, "utf8"));
}

function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Title for a finding, phrased as the thing the inspector should do rather than
 * as a fault code. "Packing date not found" tells them where to look; "DECL-04
 * FAIL" does not.
 */
function findingTitle(declaration, status) {
  if (status === STATUS.MISSING) return `${declaration.label} not found`;
  if (status === STATUS.REVIEW) return `${declaration.label} needs a closer look`;
  return `${declaration.label} does not meet the declared format`;
}

/**
 * Screen one declaration against its catalogue entry.
 *
 * @param {object} entry catalogue entry
 * @param {{value: ?string, box: ?Array<number>}} detected extraction output
 * @param {{confidence: ?number, currencyMark?: boolean, source?: string}} evidence
 */
function screenDeclaration(entry, detected, evidence) {
  const value = detected && detected.value != null ? detected.value : null;
  const box = detected && Array.isArray(detected.box) ? detected.box : null;
  const confidence = asNumber(evidence && evidence.confidence);

  if (value === null) {
    return {
      id: entry.id,
      field: entry.field,
      label: entry.label,
      short_label: entry.short_label,
      citation: entry.citation,
      requirement: entry.requirement,
      status: entry.required ? STATUS.MISSING : STATUS.PASS,
      code: entry.required ? CODE.MISSING_FIELD : null,
      value: null,
      note: entry.missing_note,
      box: null,
      confidence: null,
    };
  }

  // Format is checked before legibility on purpose. A value that is clearly the
  // wrong shape is a finding regardless of how confidently it was read.
  if (entry.format_regex && !new RegExp(entry.format_regex).test(value)) {
    return {
      id: entry.id,
      field: entry.field,
      label: entry.label,
      short_label: entry.short_label,
      citation: entry.citation,
      requirement: entry.requirement,
      status: STATUS.FAIL,
      code: CODE.FORMAT,
      value,
      note: entry.format_hint,
      box,
      confidence,
    };
  }

  // A confident read of the right shape, but a missing currency mark on the MRP
  // is the single most common real-world glare failure, so it is called out
  // rather than passed silently.
  const currencyMarkMissing =
    entry.field === "mrp" && evidence && evidence.currencyMark === false;

  const readWeakly =
    confidence !== null &&
    asNumber(entry.min_confidence) !== null &&
    confidence < entry.min_confidence;

  if (currencyMarkMissing || readWeakly) {
    return {
      id: entry.id,
      field: entry.field,
      label: entry.label,
      short_label: entry.short_label,
      citation: entry.citation,
      requirement: entry.requirement,
      status: STATUS.REVIEW,
      code: CODE.LEGIBILITY,
      value,
      note: entry.review_note,
      box,
      confidence,
    };
  }

  return {
    id: entry.id,
    field: entry.field,
    label: entry.label,
    short_label: entry.short_label,
    citation: entry.citation,
    requirement: entry.requirement,
    status: STATUS.PASS,
    code: null,
    value,
    note: entry.pass_note,
    box,
    confidence,
  };
}

function buildVerdict(declarations, frameLegible, thresholds, evidenceConfidence) {
  const total = declarations.length;
  const passed = declarations.filter((d) => d.status === STATUS.PASS).length;

  if (!frameLegible) {
    return {
      status: "INCONCLUSIVE",
      headline: "Evidence needs a re-shoot",
      detail: thresholds.illegible_frame_note,
      checks_passed: 0,
      checks_total: total,
      evidence_confidence: evidenceConfidence,
    };
  }

  const blocking = declarations.filter(
    (d) => d.status === STATUS.MISSING || d.status === STATUS.FAIL,
  );
  const toReview = declarations.filter((d) => d.status === STATUS.REVIEW);
  const attention = blocking.length + toReview.length;

  let status = "COMPLIANT";
  if (blocking.length > 0) status = "NON_COMPLIANT";
  else if (toReview.length > 0) status = "NEEDS_REVIEW";

  let headline = "Declarations look complete";
  let detail =
    "All five required declarations were read from this frame. Confirm against the physical pack before clearing it.";

  if (attention === 1) {
    headline = "Needs human review";
    detail = "One declaration check needs attention before this pack can be cleared.";
  } else if (attention > 1) {
    headline = "Needs human review";
    detail = `${attention} declaration checks need attention before this pack can be cleared.`;
  }

  return {
    status,
    headline,
    detail,
    checks_passed: passed,
    checks_total: total,
    evidence_confidence: evidenceConfidence,
  };
}

/**
 * Screen a package.
 *
 * @param {object} extracted extraction output keyed by field name
 * @param {object} [options]
 * @param {object} [options.evidence] per-field {confidence, currencyMark, source}
 * @param {object} [options.ocrMeta] OCR meta, used for frame legibility and confidence
 * @returns {object} screening result
 */
function screenPackage(extracted, options = {}) {
  const catalog = loadCatalog();
  const input = extracted && typeof extracted === "object" ? extracted : {};
  const evidence = options.evidence && typeof options.evidence === "object" ? options.evidence : {};
  const ocrMeta = options.ocrMeta && typeof options.ocrMeta === "object" ? options.ocrMeta : {};

  // An absent `legible` flag means the caller did not run our OCR module, so we
  // assume the frame was fine rather than inventing a frame-quality finding.
  const frameLegible = ocrMeta.legible === undefined ? true : Boolean(ocrMeta.legible);

  const declarations = catalog.declarations.map((entry) =>
    screenDeclaration(entry, input[entry.field], evidence[entry.field]),
  );

  const meanConfidence = asNumber(ocrMeta.meanConfidence);
  const perField = declarations.map((d) => d.confidence).filter((c) => c !== null);
  const evidenceConfidence =
    meanConfidence !== null
      ? meanConfidence
      : perField.length
        ? Math.round((perField.reduce((a, b) => a + b, 0) / perField.length) * 1000) / 1000
        : null;

  const findings = declarations
    .filter((d) => d.status !== STATUS.PASS)
    .map((d) => ({
      id: d.id,
      field: d.field,
      code: d.code,
      severity: d.status === STATUS.REVIEW ? "review" : "blocking",
      title: findingTitle(d, d.status),
      detail: d.note,
      citation: d.citation,
    }));

  if (!frameLegible) {
    findings.unshift({
      id: "FRAME",
      field: null,
      code: CODE.FRAME,
      severity: "blocking",
      title: "Frame did not read clearly",
      detail: catalog.thresholds.illegible_frame_note,
      citation: null,
    });
  }

  return {
    regulation: catalog.regulation,
    catalog_version: catalog.version,
    verdict: buildVerdict(declarations, frameLegible, catalog.thresholds, evidenceConfidence),
    declarations,
    findings,
    advisory:
      "Suggested outcome only. Confirm against the physical pack and your applicable protocol before recording a decision.",
  };
}

module.exports = {
  screenPackage,
  screenDeclaration,
  loadCatalog,
  STATUS,
  CODE,
};
