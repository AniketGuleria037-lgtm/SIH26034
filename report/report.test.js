"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { screenPackage } = require("../rules/index.js");
const { buildReportHtml, buildReportPdf, reportFilename } = require("./index.js");

function sampleScreening() {
  return screenPackage(
    {
      mrp: { value: "₹85.00", box: [10, 10, 100, 40] },
      net_quantity: { value: "72 g", box: [10, 50, 100, 80] },
      manufacturer: { value: "Kettle & Grain Foods", box: [10, 90, 200, 120] },
      packing_date: { value: null, box: null },
      consumer_care: { value: "1800 22 0417", box: [10, 170, 150, 200] },
    },
    {
      evidence: { mrp: { confidence: 0.95, currencyMark: false } },
      ocrMeta: { legible: true, meanConfidence: 0.921 },
    },
  );
}

const context = {
  inspectionId: "042",
  inspector: "Asha Rao",
  role: "Field inspector · North zone",
  product: "Grain Theory · Spiced Lentil Crisps",
  imageName: "IMG_0427.jpg",
};

test("html report includes the verdict, every declaration and the advisory", () => {
  const html = buildReportHtml(sampleScreening(), context);

  assert.match(html, /Needs human review/);
  assert.match(html, /DECL-01/);
  assert.match(html, /DECL-05/);
  assert.match(html, /Grain Theory/);
  assert.match(html, /Asha Rao/);
  assert.match(html, /Suggested outcome only/);
  assert.match(html, /Not a finding of law/);
});

test("html report escapes values rather than trusting them", () => {
  const screening = sampleScreening();
  screening.declarations[0].value = '<script>alert(1)</script>';

  const html = buildReportHtml(screening, context);
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.match(html, /&lt;script&gt;/);
});

test("a missing declaration is reported as not found, never as cleared", () => {
  const html = buildReportHtml(sampleScreening(), context);
  assert.match(html, /Not found/);
});

test("pdf report produces a real pdf buffer", async () => {
  const pdf = await buildReportPdf(sampleScreening(), context);

  assert.ok(Buffer.isBuffer(pdf));
  assert.ok(pdf.length > 1000);
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
});

test("report filenames are safe to write to disk", () => {
  assert.equal(reportFilename({ inspectionId: "042" }), "packcheck-042.pdf");
  assert.equal(reportFilename({ inspectionId: "../../etc" }, "html"), "packcheck--etc.html");
});

test("a screening result is required", () => {
  assert.throws(() => buildReportHtml(null, context), TypeError);
});
