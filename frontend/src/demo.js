/*
 * The demo inspection.
 *
 * The workspace opens on a worked example rather than an empty dropzone,
 * because "here is what the tool tells you" is a much better first thirty
 * seconds than "here is a file picker". Two things make it honest:
 *
 *   - It is shaped EXACTLY like a real /api/analyze response. No demo-only
 *     fields, no different status vocabulary. Swapping in a real inspection
 *     changes nothing about how the UI renders it, which means the demo path
 *     cannot drift away from the real one.
 *   - It is flagged `is_demo`, labelled as a demo in the interface, and cannot
 *     be turned into a recorded decision.
 *
 * The declaration boxes are in the coordinate space of the drawn pack in
 * DemoPack.jsx, and both files import REGIONS so the overlay always lands on
 * the printed text.
 */

export const DEMO_IMAGE = { width: 1000, height: 1300 };

/** Printed declaration areas on the drawn pack, in image pixels. */
export const REGIONS = {
  mrp: [524, 470, 832, 546],
  net_quantity: [168, 470, 470, 546],
  manufacturer: [168, 652, 690, 784],
  packing_date: [524, 652, 832, 730],
  consumer_care: [168, 852, 706, 934],
};

export const DEMO_PRODUCT = "Grain Theory · Spiced Lentil Crisps";

export const demoInspection = {
  is_demo: true,
  inspection: {
    id: "042",
    created_at: "2025-02-14T09:41:00.000Z",
    product: DEMO_PRODUCT,
    image: {
      name: "IMG_0427.jpg",
      content_type: "image/jpeg",
      bytes: 5033164,
      width: DEMO_IMAGE.width,
      height: DEMO_IMAGE.height,
    },
  },
  regulation: "Legal Metrology (Packaged Commodities) Rules, 2011",
  catalog_version: "2026.09",
  verdict: {
    status: "NON_COMPLIANT",
    headline: "Needs human review",
    detail: "Two declaration checks need attention before this pack can be cleared.",
    checks_passed: 3,
    checks_total: 5,
    evidence_confidence: 0.921,
  },
  declarations: [
    {
      id: "DECL-01",
      field: "mrp",
      label: "MRP",
      short_label: "MRP",
      citation: "Rule 6(1)(e)",
      requirement: "Retail sale price declared as maximum retail price, inclusive of all taxes.",
      status: "REVIEW",
      code: "LEGIBILITY",
      value: "₹ 85.00",
      note: "Printed price is visible, but the currency mark is partially obscured.",
      box: REGIONS.mrp,
      confidence: 0.71,
    },
    {
      id: "DECL-02",
      field: "net_quantity",
      label: "Net quantity",
      short_label: "NET QTY",
      citation: "Rule 6(1)(c)",
      requirement: "Net quantity in standard units of weight, measure or number.",
      status: "PASS",
      code: null,
      value: "72 g",
      note: "Unit and quantity are readable on the front panel.",
      box: REGIONS.net_quantity,
      confidence: 0.96,
    },
    {
      id: "DECL-03",
      field: "manufacturer",
      label: "Manufacturer / packer",
      short_label: "MAKER",
      citation: "Rule 6(1)(a)",
      requirement: "Name and complete address of the manufacturer, packer or importer.",
      status: "PASS",
      code: null,
      value: "Kettle & Grain Foods",
      note: "Name and address block detected on the rear panel.",
      box: REGIONS.manufacturer,
      confidence: 0.93,
    },
    {
      id: "DECL-04",
      field: "packing_date",
      label: "Packing date",
      short_label: "PACKING DATE",
      citation: "Rule 6(1)(d)",
      requirement:
        "Month and year in which the commodity was pre-packed, manufactured or imported.",
      status: "MISSING",
      code: "MISSING FIELD",
      value: null,
      note: "No legible packing or manufacture date was detected. Capture the seal and batch area to confirm.",
      box: null,
      confidence: null,
    },
    {
      id: "DECL-05",
      field: "consumer_care",
      label: "Consumer-care details",
      short_label: "CARE",
      citation: "Rule 6(1)(f)",
      requirement:
        "Name, address, telephone number and email of the person to be contacted for consumer complaints.",
      status: "PASS",
      code: null,
      value: "1800 22 0417",
      note: "Consumer-care contact detected near the lower seal.",
      box: REGIONS.consumer_care,
      confidence: 0.89,
    },
  ],
  findings: [
    {
      id: "DECL-01",
      field: "mrp",
      code: "LEGIBILITY",
      severity: "review",
      title: "MRP needs a closer look",
      detail: "Printed price is visible, but the currency mark is partially obscured.",
      citation: "Rule 6(1)(e)",
    },
    {
      id: "DECL-04",
      field: "packing_date",
      code: "MISSING FIELD",
      severity: "blocking",
      title: "Packing date not found",
      detail: "No legible packing or manufacture date was detected. Capture the seal and batch area to confirm.",
      citation: "Rule 6(1)(d)",
    },
  ],
  advisory:
    "Suggested outcome only. Confirm against the physical pack and your applicable protocol before recording a decision.",
  ocr: {
    meta: {
      engine: "tesseract.js",
      variant: "sharpened",
      psm: "6",
      rotation: 0,
      legible: true,
      meanConfidence: 0.921,
      imageWidth: DEMO_IMAGE.width,
      imageHeight: DEMO_IMAGE.height,
      durationMs: 2140,
    },
  },
  timing_ms: 2140,
};

/**
 * The catalogue shown on the reference-rules screen when the backend is not
 * running. Kept in step with rules/catalog.json by hand; the live screen always
 * prefers /api/catalog when it can reach it.
 */
export const fallbackCatalog = {
  version: "2026.09",
  regulation: demoInspection.regulation,
  citation_note:
    "Clause references follow Rule 6(1) of the 2011 Rules. Verify each reference against the notified text and the latest amendment before using a generated report as evidence.",
  declarations: demoInspection.declarations.map((d) => ({
    id: d.id,
    field: d.field,
    label: d.label,
    short_label: d.short_label,
    citation: d.citation,
    requirement: d.requirement,
    required: true,
    format_hint:
      d.field === "mrp"
        ? "Declared price should read as a currency mark followed by an amount."
        : d.field === "net_quantity"
          ? "Net quantity must carry a numeric value and a standard unit."
          : d.field === "packing_date"
            ? "Packing date must give month and year as MM/YYYY."
            : d.field === "manufacturer"
              ? "Name and address block must be present."
              : "A contact route for complaints must be present.",
    min_confidence: { mrp: 0.75, net_quantity: 0.7, manufacturer: 0.6, packing_date: 0.65, consumer_care: 0.6 }[
      d.field
    ],
  })),
  thresholds: {
    evidence_confidence_review: 0.6,
    illegible_frame_note:
      "The frame did not read well enough to screen declarations. Re-shoot the panel square-on with even lighting before recording a decision.",
  },
};
