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

/* ---------------- Label formats seen on real packs ---------------- */

test("MRP printed with the inclusive-of-taxes aside is recognized", () => {
  const result = extractDeclarations([
    { text: "MRP (incl. of all taxes) ₹85.00", box: [1, 1, 2, 2] },
  ]);
  assert.equal(result.mrp.value, "₹85.00");
});

test("the spelled-out price label is recognized", () => {
  const result = extractDeclarations([
    { text: "Maximum Retail Price Rs. 120", box: [1, 1, 2, 2] },
  ]);
  assert.equal(result.mrp.value, "₹120");
});

test("the price label does not reach across to unrelated digits", () => {
  const result = extractDeclarations([
    { text: "MRP printed on pack", box: [1, 1, 2, 2] },
    { text: "Net Weight 200 g", box: [1, 3, 2, 4] },
  ]);
  assert.equal(result.mrp.value, null);
  assert.equal(result.net_quantity.value, "200 g");
});

test("alternative unit spellings normalize to standard units", () => {
  const cases = [
    ["Net Wt. 200 gm", "200 g"],
    ["Net Qty 1.5 Ltr", "1.5 l"],
    ["Net Weight: 250 grams", "250 g"],
    ["NET QTY 2 KGS", "2 kg"],
  ];

  for (const [text, expected] of cases) {
    const result = extractDeclarations([{ text, box: [1, 1, 2, 2] }]);
    assert.equal(result.net_quantity.value, expected, text);
  }
});

test("a packing date printed with a month name is normalized", () => {
  const cases = [
    ["MFD: FEB 2025", "02/2025"],
    ["Packed on March 2026", "03/2026"],
    ["PKD DEC 2024", "12/2024"],
  ];

  for (const [text, expected] of cases) {
    const result = extractDeclarations([{ text, box: [1, 1, 2, 2] }]);
    assert.equal(result.packing_date.value, expected, text);
  }
});

test("a manufacturer named on the label line is not confused with the next line", () => {
  const result = extractDeclarations([
    { text: "Manufactured & Packed by: Acme Foods Pvt. Ltd.", box: [10, 20, 300, 50] },
    { text: "Packing Date: 08/2026", box: [10, 60, 200, 90] },
  ]);
  assert.equal(result.manufacturer.value, "Acme Foods Pvt. Ltd.");
  assert.equal(result.packing_date.value, "08/2026");
});

test("a manufacturer name on the line below its label is still found", () => {
  const result = extractDeclarations([
    { text: "Manufactured By:", box: [10, 20, 200, 45] },
    { text: "Kettle & Grain Foods Pvt Ltd", box: [10, 50, 260, 75] },
  ]);
  assert.equal(result.manufacturer.value, "Kettle & Grain Foods Pvt Ltd");
});

test("a two-digit year on the seal is expanded rather than dropped", () => {
  const cases = [
    ["MFD & USE BY: 05/09/23 & 02/05/24", "09/2023"],
    ["MFD 05.09.23", "09/2023"],
    ["PKD: 14-02-25", "02/2025"],
    ["Packed on 03/25", "03/2025"],
    ["MFD FEB 25", "02/2025"],
  ];

  for (const [text, expected] of cases) {
    const result = extractDeclarations([{ text, box: [1, 1, 2, 2] }]);
    assert.equal(result.packing_date.value, expected, text);
  }
});

test("a four-digit year is never truncated to a two-digit match", () => {
  const result = extractDeclarations([{ text: "Packing Date: 08/2026", box: [1, 1, 2, 2] }]);
  assert.equal(result.packing_date.value, "08/2026");
});

test("an OCR-mangled date label is still recognized", () => {
  // "MFO" is how the seal on test-data/chips.jpg actually comes back from OCR.
  const cases = [
    ["MFO USE BY: 09/23 & 02/05/24", "09/2023"],
    ["MF0: 03/2026", "03/2026"],
    ["PKG 11/24", "11/2024"],
  ];

  for (const [text, expected] of cases) {
    const result = extractDeclarations([{ text, box: [1, 1, 2, 2] }]);
    assert.equal(result.packing_date.value, expected, text);
  }
});

/* ------------------------------------------------------------------ *
 * Regressions from the labelled corpus in test-data/images.
 *
 * Each of these is a real OCR string from a real photograph of a real pack,
 * pasted verbatim. They are ugly on purpose: the whole point is that the
 * matchers cope with what the recogniser actually returns, not with what the
 * label says to a human reading the pack.
 * ------------------------------------------------------------------ */

test("a currency mark misread as a percent sign still yields a price", () => {
  // Singla Enterprises bottle: OCR renders "₹" as "%".
  const result = extractDeclarations([
    { text: "Max. Retail Price % 100.00 “{ (Incl taxes)", box: [1, 1, 2, 2] },
  ]);
  assert.equal(result.mrp.value, "₹100.00");
});

test("millilitres misread as 'mt' are still read as a quantity", () => {
  const result = extractDeclarations([{ text: "Gross Wt. 300 mt", box: [1, 1, 2, 2] }]);
  assert.equal(result.net_quantity.value, "300 ml");
});

test("a maker label misread as 'Mid' still finds the company", () => {
  const result = extractDeclarations([
    { text: "“3 Mid & Pkd By: ae SINGLA ENTERPRISES", box: [1, 1, 2, 2] },
  ]);
  assert.match(result.manufacturer.value, /SINGLA ENTERPRISES/);
});

test("quantity declared by number is read, as the Rules allow", () => {
  const result = extractDeclarations([{ text: "Qty 1 Unit", box: [1, 1, 2, 2] }]);
  assert.equal(result.net_quantity.value, "1 unit");
});

test("a declaration table is read across cells, not just down lines", () => {
  // Hammer cable box: label in one table cell, value in the next one along.
  const result = extractDeclarations([
    { text: "Maximum retail price per unit (Inclusive of all taxes)", box: [100, 100, 600, 140], confidence: 0.8 },
    { text: "₹ 999.00/-", box: [640, 102, 800, 138], confidence: 0.8 },
    { text: "Month & Year of Manufacturing/ Import", box: [100, 160, 600, 200], confidence: 0.8 },
    { text: "May 2026", box: [640, 162, 780, 198], confidence: 0.8 },
  ]);

  assert.equal(result.mrp.value, "₹999.00");
  assert.equal(result.packing_date.value, "05/2026");
});

test("an address line is never reported as the manufacturer", () => {
  // The real failure: OCR merged a maker label with the address continuation,
  // and the label match won while the actual company name sat in another block.
  const result = extractDeclarations([
    { text: "Manufactured, HammerLifestyle PVT LTO Sectar-25,,", box: [100, 100, 700, 140], confidence: 0.7 },
    { text: "Marketed Packed by | Trunk Road Panipat, Haryana o", box: [100, 150, 700, 190], confidence: 0.7 },
  ]);

  assert.doesNotMatch(result.manufacturer.value, /Trunk Road|Panipat/);
  assert.match(result.manufacturer.value, /Hammer/i);
});

test("print noise is not reported as a price", () => {
  // The currency fallback used to return "₹2" and "₹4" out of speckle, and
  // "₹2027" out of a use-by year. A wrong price is the worst output there is.
  for (const text of ["Rs 2", "₹ 4", "z 3", "Use By ₹ 2027"]) {
    const result = extractDeclarations([{ text, box: [1, 1, 2, 2] }]);
    assert.equal(result.mrp.value, null, text);
  }
});

test("a per-unit rate beside the price is not mistaken for the price", () => {
  const result = extractDeclarations([
    { text: "MRP₹ : 75.00(Rs 0.15/g)", box: [1, 1, 2, 2] },
  ]);
  assert.equal(result.mrp.value, "₹75.00");
});

test("an FSSAI licence number is never reported as a consumer-care contact", () => {
  const result = extractDeclarations([
    { text: "fssai Lic. No. 10013021000661", box: [1, 1, 2, 2] },
  ]);
  assert.equal(result.consumer_care.value, null);
});

test("a bare ten-digit mobile is recognized as a contact", () => {
  const result = extractDeclarations([
    { text: "Customer care No: 9817669229", box: [1, 1, 2, 2] },
  ]);
  assert.equal(result.consumer_care.value, "9817669229");
});

test("an STD code and landline without a separator is recognized", () => {
  const result = extractDeclarations([
    { text: "Contact NIVEA CARE Executive at (022) 62487999", box: [1, 1, 2, 2] },
  ]);
  assert.match(result.consumer_care.value, /62487999/);
});

test("a slice of a longer licence number is not reported as a phone", () => {
  // The rusk pack returned "0017011004791" — part of its FSSAI licence — as a
  // consumer-care number, because the "Lic. No." label was in another block.
  const result = extractDeclarations([
    { text: "10017011004791 NET WEIGHT :60g", box: [1, 1, 2, 2] },
  ]);
  assert.equal(result.consumer_care.value, null);
  assert.equal(result.net_quantity.value, "60 g");
});

/* ---- Regressions from the second corpus batch ---- */

test("an offer price is never read as the retail price", () => {
  const result = extractDeclarations([
    { text: "OFFER PRICE: ₹ 99.00 (INCLUSIVE OF ALL TAXES)", box: [1, 1, 2, 2] },
  ]);
  assert.equal(result.mrp.value, null);
});

test("the retail price wins over a unit rate printed beside it", () => {
  const result = extractDeclarations([
    { text: "MRP ₹ :250.00(Unit Sale Price - ₹ 0.71 per g)", box: [1, 1, 2, 2] },
  ]);
  assert.equal(result.mrp.value, "₹250.00");
});

test("quantity declared as a set of items is read", () => {
  const result = extractDeclarations([
    { text: "NET QUANTITY: 1 SET OF SCOMBS", box: [1, 1, 2, 2] },
  ]);
  assert.equal(result.net_quantity.value, "1 unit");
});

test("a date run together with no separators is read", () => {
  const result = extractDeclarations([
    { text: "MFD/USE BY: 14JUL26/10NOV26", box: [1, 1, 2, 2] },
  ]);
  assert.equal(result.packing_date.value, "07/2026");
});

test("a net weight given as a sum reports the total", () => {
  const result = extractDeclarations([
    { text: "NET WT.: 40.6g (27.07 g + 13.53 g FREE)", box: [1, 1, 2, 2] },
  ]);
  assert.equal(result.net_quantity.value, "40.6 g");
});

test("a brand word ending in 'co' is not reported as the manufacturer", () => {
  // "Choco Delight" on a peanut butter jar was being reported as the maker of
  // a pack whose manufacturer was not in the frame at all.
  const result = extractDeclarations([
    { text: "Choco Delight Zero Trans Fat Source of Dietary Fibre", box: [1, 1, 9, 2] },
  ]);
  assert.equal(result.manufacturer.value, null);
});

test("the packer wins over the packaging film supplier", () => {
  // Rear panels name several companies. The one next to a maker label is the
  // one that answers Rule 6(1)(a).
  const result = extractDeclarations([
    { text: "Manufactured & Packed by: AWL Agri Business Limited", box: [1, 10, 9, 19], confidence: 0.8 },
    { text: "Pkg. Matl. Mfd. By: Vishakha Polyfab Pvt Ltd, Ahmedabad", box: [1, 90, 9, 99], confidence: 0.8 },
  ]);
  assert.match(result.manufacturer.value, /AWL Agri Business/);
});
