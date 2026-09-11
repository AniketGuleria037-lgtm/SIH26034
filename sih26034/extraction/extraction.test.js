"use strict";

const assert = require("node:assert/strict");
const { extractDeclarations } = require("./index");

const emptyFields = {
  mrp: { value: null, box: null },
  net_quantity: { value: null, box: null },
  manufacturer: { value: null, box: null },
  packing_date: { value: null, box: null },
  consumer_care: { value: null, box: null },
};

const allFieldsInput = [
  { text: "MRP Rs. 50", box: [120, 300, 250, 340], confidence: 0.94 },
  { text: "Net Weight 200 g", box: [110, 350, 290, 390], confidence: 0.88 },
  { text: "Manufactured & Packed by: Acme Foods Pvt. Ltd.", box: [10, 20, 300, 50] },
  { text: "Packing Date: 08/2026", box: [10, 60, 200, 90] },
  { text: "Customer Care: help@acme.test", box: [10, 100, 300, 130] },
];

function test(name, run) {
  try {
    run();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("all fields detected with their original boxes", () => {
  const result = extractDeclarations(allFieldsInput);
  assert.deepEqual(result, {
    mrp: { value: "₹50", box: [120, 300, 250, 340] },
    net_quantity: { value: "200 g", box: [110, 350, 290, 390] },
    manufacturer: { value: "Acme Foods Pvt. Ltd.", box: [10, 20, 300, 50] },
    packing_date: { value: "08/2026", box: [10, 60, 200, 90] },
    consumer_care: { value: "help@acme.test", box: [10, 100, 300, 130] },
  });
});

for (const field of Object.keys(emptyFields)) {
  test(`${field} remains null without evidence`, () => {
    const input = allFieldsInput.filter((_, index) => index !== Object.keys(emptyFields).indexOf(field));
    const result = extractDeclarations(input);
    assert.deepEqual(result[field], { value: null, box: null });
  });
}

test("empty OCR array returns all locked fields as null", () => {
  assert.deepEqual(extractDeclarations([]), emptyFields);
});

test("null OCR input returns all locked fields as null", () => {
  assert.deepEqual(extractDeclarations(null), emptyFields);
});

test("missing confidence is supported", () => {
  assert.deepEqual(extractDeclarations([{ text: "MRP: ₹75", box: [1, 2, 3, 4] }]).mrp, {
    value: "₹75",
    box: [1, 2, 3, 4],
  });
});

test("duplicate MRP candidates use higher confidence", () => {
  assert.deepEqual(
    extractDeclarations([
      { text: "MRP Rs 50", box: [1, 1, 2, 2], confidence: 0.4 },
      { text: "MRP Rs 55", box: [3, 3, 4, 4], confidence: 0.9 },
    ]).mrp,
    { value: "₹55", box: [3, 3, 4, 4] },
  );
});

test("different capitalization is recognized", () => {
  const result = extractDeclarations([
    { text: "m.r.p. rs 60", box: [1, 1, 2, 2] },
    { text: "NET QTY: 500ml", box: [3, 3, 4, 4] },
    { text: "MFG: 03/2026", box: [5, 5, 6, 6] },
  ]);
  assert.equal(result.mrp.value, "₹60");
  assert.equal(result.net_quantity.value, "500 ml");
  assert.equal(result.packing_date.value, "03/2026");
});

test("common OCR spacing variations are recognized", () => {
  const result = extractDeclarations([
    { text: "MRP   :   Rs.   60", box: [1, 1, 2, 2] },
    { text: "Net   Weight   200   g", box: [3, 3, 4, 4] },
  ]);
  assert.equal(result.mrp.value, "₹60");
  assert.equal(result.net_quantity.value, "200 g");
});

test("irrelevant OCR text does not create declarations", () => {
  const result = extractDeclarations([
    { text: "Delicious snack", box: [1, 2, 3, 4] },
    { box: [1, 2, 3, 4] },
    null,
  ]);
  assert.deepEqual(result, emptyFields);
});

test("a field with no valid evidence remains null", () => {
  const result = extractDeclarations([{ text: "MRP maybe", box: [1, 2, 3, 4] }]);
  assert.deepEqual(result.mrp, { value: null, box: null });
});

test("malformed boxes do not crash extraction", () => {
  const result = extractDeclarations([{ text: "MRP Rs 10", box: "not-a-box" }]);
  assert.deepEqual(result.mrp, { value: "₹10", box: null });
});

console.log("All extraction tests passed.");
