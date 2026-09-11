"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateCompliance } = require("./index.js");

function compliantInput() {
  return {
    mrp: { value: "₹50", box: [120, 300, 250, 340] },
    net_quantity: { value: "200 g", box: [110, 350, 290, 390] },
    manufacturer: { value: "ABC Foods Pvt Ltd", box: [90, 400, 300, 430] },
    packing_date: { value: "08/2026", box: [90, 440, 200, 465] },
    consumer_care: { value: "help@example.com", box: [90, 470, 300, 500] },
  };
}

test("completely compliant input is COMPLIANT", () => {
  assert.equal(evaluateCompliance(compliantInput()).overall_status, "COMPLIANT");
});

test("missing MRP fails and makes the result NON_COMPLIANT", () => {
  const input = compliantInput();
  input.mrp = { value: null, box: null };
  const result = evaluateCompliance(input);
  assert.equal(result.fields.mrp.status, "FAIL");
  assert.equal(result.overall_status, "NON_COMPLIANT");
});

test("missing consumer care fails with a violation", () => {
  const input = compliantInput();
  input.consumer_care = { value: null, box: null };
  const result = evaluateCompliance(input);
  assert.equal(result.fields.consumer_care.status, "FAIL");
  assert.deepEqual(result.violations, [
    { field: "consumer_care", reason: "Required declaration not detected" },
  ]);
});

test("each missing required field gets its own violation", () => {
  const input = compliantInput();
  input.mrp = { value: null, box: null };
  input.manufacturer = { value: null, box: null };
  const result = evaluateCompliance(input);
  assert.equal(result.violations.length, 2);
  assert.deepEqual(result.violations.map((violation) => violation.field), ["mrp", "manufacturer"]);
});

test("invalid net quantity fails", () => {
  const input = compliantInput();
  input.net_quantity.value = "two hundred grams";
  assert.equal(evaluateCompliance(input).fields.net_quantity.status, "FAIL");
});

test("valid net quantity passes", () => {
  assert.equal(evaluateCompliance(compliantInput()).fields.net_quantity.status, "PASS");
});

test("invalid packing date fails", () => {
  const input = compliantInput();
  input.packing_date.value = "2026";
  assert.equal(evaluateCompliance(input).fields.packing_date.status, "FAIL");
});

test("valid packing date passes", () => {
  assert.equal(evaluateCompliance(compliantInput()).fields.packing_date.status, "PASS");
});

test("null or empty extraction input does not crash", () => {
  assert.doesNotThrow(() => evaluateCompliance(null));
  assert.doesNotThrow(() => evaluateCompliance({}));
  assert.equal(evaluateCompliance(null).overall_status, "NON_COMPLIANT");
});

test("bounding boxes are preserved", () => {
  const input = compliantInput();
  assert.deepEqual(evaluateCompliance(input).fields.mrp.box, input.mrp.box);
});
