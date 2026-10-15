"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { screenPackage, STATUS } = require("./screening.js");

function cleanRead() {
  return {
    mrp: { value: "₹85.00", box: [10, 10, 100, 40] },
    net_quantity: { value: "72 g", box: [10, 50, 100, 80] },
    manufacturer: { value: "Kettle & Grain Foods", box: [10, 90, 200, 120] },
    packing_date: { value: "02/2025", box: [10, 130, 100, 160] },
    consumer_care: { value: "1800 22 0417", box: [10, 170, 150, 200] },
  };
}

function strongEvidence() {
  return {
    mrp: { confidence: 0.95, currencyMark: true },
    net_quantity: { confidence: 0.93 },
    manufacturer: { confidence: 0.9 },
    packing_date: { confidence: 0.91 },
    consumer_care: { confidence: 0.88 },
  };
}

function byField(result, field) {
  return result.declarations.find((d) => d.field === field);
}

test("a clean confident read is compliant with no findings", () => {
  const result = screenPackage(cleanRead(), {
    evidence: strongEvidence(),
    ocrMeta: { legible: true, meanConfidence: 0.92 },
  });

  assert.equal(result.verdict.status, "COMPLIANT");
  assert.equal(result.verdict.checks_passed, 5);
  assert.equal(result.findings.length, 0);
});

test("an absent declaration is MISSING, not FAIL", () => {
  const read = cleanRead();
  read.packing_date = { value: null, box: null };

  const result = screenPackage(read, {
    evidence: strongEvidence(),
    ocrMeta: { legible: true },
  });

  assert.equal(byField(result, "packing_date").status, STATUS.MISSING);
  assert.equal(result.verdict.status, "NON_COMPLIANT");
  assert.equal(result.findings[0].id, "DECL-04");
  assert.equal(result.findings[0].severity, "blocking");
});

test("a price read without a currency mark goes to review rather than failing", () => {
  const evidence = strongEvidence();
  evidence.mrp = { confidence: 0.95, currencyMark: false };

  const result = screenPackage(cleanRead(), { evidence, ocrMeta: { legible: true } });
  const mrp = byField(result, "mrp");

  assert.equal(mrp.status, STATUS.REVIEW);
  assert.equal(mrp.code, "LEGIBILITY");
  assert.equal(result.verdict.status, "NEEDS_REVIEW");
});

test("a weakly read declaration goes to review", () => {
  const evidence = strongEvidence();
  evidence.net_quantity = { confidence: 0.2 };

  const result = screenPackage(cleanRead(), { evidence, ocrMeta: { legible: true } });

  assert.equal(byField(result, "net_quantity").status, STATUS.REVIEW);
});

test("a wrongly shaped value fails on format and keeps the value visible", () => {
  const read = cleanRead();
  read.net_quantity = { value: "72 grms", box: [10, 50, 100, 80] };

  const result = screenPackage(read, {
    evidence: strongEvidence(),
    ocrMeta: { legible: true },
  });
  const quantity = byField(result, "net_quantity");

  assert.equal(quantity.status, STATUS.FAIL);
  assert.equal(quantity.code, "FORMAT");
  assert.equal(quantity.value, "72 grms");
});

test("an illegible frame never reports declarations as absent", () => {
  const empty = {
    mrp: { value: null, box: null },
    net_quantity: { value: null, box: null },
    manufacturer: { value: null, box: null },
    packing_date: { value: null, box: null },
    consumer_care: { value: null, box: null },
  };

  const result = screenPackage(empty, { ocrMeta: { legible: false, meanConfidence: 0.1 } });

  assert.equal(result.verdict.status, "INCONCLUSIVE");
  assert.equal(result.findings[0].code, "FRAME QUALITY");
  assert.match(result.verdict.detail, /re-shoot/i);
});

test("every declaration carries an id and a citation", () => {
  const result = screenPackage(cleanRead(), { evidence: strongEvidence() });

  for (const declaration of result.declarations) {
    assert.match(declaration.id, /^DECL-0\d$/);
    assert.match(declaration.citation, /^Rule 6\(1\)\([a-f]\)$/);
  }
});

test("missing evidence does not invent a frame-quality finding", () => {
  const result = screenPackage(cleanRead());
  assert.equal(result.verdict.status, "COMPLIANT");
  assert.equal(result.findings.length, 0);
});
