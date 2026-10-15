"use strict";

/**
 * API tests.
 *
 * The app is required rather than the server, so nothing here binds a fixed
 * port or depends on a running backend. Each test starts the app on port 0 and
 * lets the OS pick.
 *
 * The analyze tests run real OCR on generated images. That is slow — seconds,
 * not milliseconds — but stubbing the recogniser would test the plumbing while
 * skipping the one behaviour most worth protecting: that an unreadable frame is
 * reported as unreadable and NOT as five missing declarations.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");

const { createApp } = require("./app.js");
const ocr = require("../ocr/index.js");

/** Start the app on an ephemeral port and return a fetch helper. */
async function withServer(run) {
  const app = createApp();
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });

  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    await run((path, options) => fetch(`${base}${path}`, options));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/** A plain grey rectangle: a valid image with nothing legible on it. */
function blankImage() {
  return sharp({
    create: { width: 900, height: 700, channels: 3, background: "#8a8a8a" },
  })
    .jpeg()
    .toBuffer();
}

/** An image with the five declarations rendered as crisp black text. */
function labelImage() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1400" height="900">
      <rect width="1400" height="900" fill="#ffffff"/>
      <g font-family="DejaVu Sans, sans-serif" font-size="46" fill="#000000">
        <text x="70" y="150">MRP Rs. 85.00</text>
        <text x="70" y="260">Net Qty: 72 g</text>
        <text x="70" y="370">Packed by: Kettle and Grain Foods</text>
        <text x="70" y="480">MFD: 02/2025</text>
        <text x="70" y="590">Consumer care: 1800 22 0417</text>
      </g>
    </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

test.after(async () => {
  // The shared Tesseract worker keeps the process alive if it is not released.
  await ocr.shutdown();
});

/* ----------------------------- health ----------------------------- */

test("health reports the service and the catalogue in use", async () => {
  await withServer(async (get) => {
    const response = await get("/api/health");
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.status, "ok");
    assert.equal(body.service, "packcheck-backend");
    assert.equal(body.ocr.langdata, "bundled");
    assert.match(body.rules.catalog_version, /^\d{4}\.\d{2}$/);
  });
});

test("the original health path still answers", async () => {
  await withServer(async (get) => {
    const response = await get("/health");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
  });
});

/* ----------------------------- catalog ----------------------------- */

test("the catalogue exposes all five declarations with citations", async () => {
  await withServer(async (get) => {
    const body = await (await get("/api/catalog")).json();

    assert.equal(body.declarations.length, 5);
    assert.deepEqual(
      body.declarations.map((d) => d.field),
      ["mrp", "net_quantity", "manufacturer", "packing_date", "consumer_care"],
    );
    for (const declaration of body.declarations) {
      assert.match(declaration.citation, /^Rule 6\(1\)\([a-f]\)$/);
    }
  });
});

/* ----------------------------- analyze ----------------------------- */

test("analyze rejects a request with no image and names the fix", async () => {
  await withServer(async (get) => {
    const response = await get("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: Buffer.alloc(0),
    });

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error.code, "NO_IMAGE");
    assert.match(body.error.message, /Content-Type/);
  });
});

test("analyze rejects a content type that is not an image", async () => {
  await withServer(async (get) => {
    const response = await get("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "not an image",
    });

    // express.raw does not populate the body for an unmatched type, so this
    // surfaces as "no image" rather than a parse failure.
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "NO_IMAGE");
  });
});

test(
  "an unreadable frame is reported as inconclusive, not as five missing declarations",
  { timeout: 120000 },
  async () => {
    await withServer(async (get) => {
      const response = await get("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: await blankImage(),
      });

      assert.equal(response.status, 200);
      const body = await response.json();

      assert.equal(body.verdict.status, "INCONCLUSIVE");
      assert.match(body.verdict.detail, /re-shoot/i);

      // This is the assertion that matters: the frame failing must not read as
      // a compliance failure.
      assert.notEqual(body.verdict.status, "NON_COMPLIANT");
      assert.equal(body.findings[0].code, "FRAME QUALITY");
    });
  },
);

test(
  "a legible label is screened into declarations with ids and boxes",
  { timeout: 120000 },
  async () => {
    await withServer(async (get) => {
      const response = await get("/api/analyze?name=label.png&product=Test%20pack", {
        method: "POST",
        headers: { "Content-Type": "image/png" },
        body: await labelImage(),
      });

      assert.equal(response.status, 200);
      const body = await response.json();

      assert.match(body.inspection.id, /^\d{3}$/);
      assert.equal(body.inspection.image.name, "label.png");
      assert.equal(body.inspection.product, "Test pack");
      assert.ok(body.inspection.image.width > 0);

      assert.equal(body.declarations.length, 5);
      assert.equal(body.verdict.checks_total, 5);
      assert.ok(body.ocr.meta.legible, "the generated label should be legible");

      // Whatever the recogniser managed to read, the contract holds: five
      // declarations, each with an id, a citation and a defined status.
      for (const declaration of body.declarations) {
        assert.match(declaration.id, /^DECL-0\d$/);
        assert.ok(declaration.citation);
        assert.ok(["PASS", "REVIEW", "MISSING", "FAIL"].includes(declaration.status));
      }

      // The original PASS/FAIL result travels alongside for anything built
      // against the first API.
      assert.ok(body.legacy.fields.mrp);
      assert.ok(["COMPLIANT", "NON_COMPLIANT"].includes(body.legacy.overall_status));

      // Block lists are opt-in, so an ordinary response stays small.
      assert.equal(body.ocr.blocks, undefined);
    });
  },
);

test("inspection ids advance between inspections", async () => {
  const app = createApp();
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const image = await blankImage();

  try {
    const first = await (
      await fetch(`${base}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: image,
      })
    ).json();

    const second = await (
      await fetch(`${base}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: image,
      })
    ).json();

    assert.notEqual(first.inspection.id, second.inspection.id);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

/* ------------------------------ report ------------------------------ */

function screeningFixture() {
  const { screenPackage } = require("../rules/index.js");
  return screenPackage(
    {
      mrp: { value: "₹85.00", box: [10, 10, 100, 40] },
      net_quantity: { value: "72 g", box: [10, 50, 100, 80] },
      manufacturer: { value: "Kettle & Grain Foods", box: [10, 90, 200, 120] },
      packing_date: { value: null, box: null },
      consumer_care: { value: "1800 22 0417", box: [10, 170, 150, 200] },
    },
    { ocrMeta: { legible: true, meanConfidence: 0.92 } },
  );
}

test("report returns a pdf with a download filename", async () => {
  await withServer(async (get) => {
    const response = await get("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        screening: screeningFixture(),
        context: { inspectionId: "042", inspector: "Asha Rao" },
        format: "pdf",
      }),
    });

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /pdf/);
    assert.match(response.headers.get("content-disposition"), /packcheck-042\.pdf/);

    const buffer = Buffer.from(await response.arrayBuffer());
    assert.equal(buffer.subarray(0, 5).toString(), "%PDF-");
  });
});

test("report can return printable html instead", async () => {
  await withServer(async (get) => {
    const response = await get("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        screening: screeningFixture(),
        context: { inspectionId: "042" },
        format: "html",
      }),
    });

    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Not a finding of law/);
    assert.match(html, /DECL-04/);
  });
});

test("report refuses a request with no screening result", async () => {
  await withServer(async (get) => {
    const response = await get("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: {} }),
    });

    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "NO_SCREENING");
  });
});

test("malformed json is reported as malformed json", async () => {
  await withServer(async (get) => {
    const response = await get("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not json",
    });

    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "BAD_JSON");
  });
});

/* ------------------------------ plumbing ------------------------------ */

test("an unknown api route returns a typed 404", async () => {
  await withServer(async (get) => {
    const response = await get("/api/nope");
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, "NOT_FOUND");
  });
});

test("preflight is answered for the dev frontend origin", async () => {
  await withServer(async (get) => {
    const response = await get("/api/analyze", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
      },
    });

    assert.equal(response.status, 204);
    assert.equal(
      response.headers.get("access-control-allow-origin"),
      "http://localhost:5173",
    );
  });
});

test("an unlisted origin is not granted access", async () => {
  await withServer(async (get) => {
    const response = await get("/api/health", {
      headers: { Origin: "https://not-ours.example" },
    });

    assert.equal(response.headers.get("access-control-allow-origin"), null);
  });
});
