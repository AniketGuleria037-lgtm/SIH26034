"use strict";

/**
 * Dependency-free checks, matching the style of extraction.test.js.
 *
 *   node ocr.test.js
 *
 * The pure-logic tests always run. Tests that need a real image are skipped
 * with a notice when no fixture is present, so the suite stays green on a
 * checkout without test data rather than failing for the wrong reason.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const lines = require("./lines.js");
const engine = require("./engine.js");
const ocr = require("./index.js");

const FIXTURE_DIR = path.join(__dirname, "..", "test-data", "images");
let passed = 0;
let skipped = 0;
const failures = [];

function test(name, fn) {
  try {
    const result = fn();
    if (result === "skip") {
      skipped += 1;
      console.log(`  SKIP  ${name}`);
      return;
    }
    passed += 1;
    console.log(`  ok    ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`  FAIL  ${name}\n        ${error.message}`);
  }
}

async function asyncTest(name, fn) {
  try {
    const result = await fn();
    if (result === "skip") {
      skipped += 1;
      console.log(`  SKIP  ${name}`);
      return;
    }
    passed += 1;
    console.log(`  ok    ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`  FAIL  ${name}\n        ${error.message}`);
  }
}

function fixtures() {
  if (!fs.existsSync(FIXTURE_DIR)) return [];
  return fs
    .readdirSync(FIXTURE_DIR)
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .map((f) => path.join(FIXTURE_DIR, f));
}

// ---------------------------------------------------------------------------
console.log("\ngeometry and contract shape");

test("toBox converts Tesseract bbox to [x1,y1,x2,y2]", () => {
  assert.deepStrictEqual(lines.toBox({ x0: 10, y0: 20, x1: 30, y1: 40 }), [10, 20, 30, 40]);
});

test("toBox applies the scale factor so boxes land in original pixel space", () => {
  // Internal resizing must be invisible to callers; the frontend draws these
  // boxes onto the image the inspector actually uploaded.
  assert.deepStrictEqual(lines.toBox({ x0: 10, y0: 20, x1: 30, y1: 40 }, 2), [20, 40, 60, 80]);
});

test("toBox returns null for a missing bbox rather than a malformed array", () => {
  assert.strictEqual(lines.toBox(null), null);
});

test("toUnit converts Tesseract 0-100 confidence to the contract's 0-1", () => {
  assert.strictEqual(lines.toUnit(94), 0.94);
  assert.strictEqual(lines.toUnit(0), 0);
  assert.strictEqual(lines.toUnit(100), 1);
  assert.strictEqual(lines.toUnit(undefined), null);
});

test("unionBox spans every input box", () => {
  assert.deepStrictEqual(
    lines.unionBox([[10, 10, 20, 20], [30, 5, 40, 25]]),
    [10, 5, 40, 25]
  );
});

// ---------------------------------------------------------------------------
console.log("\ndebris rejection");

test("real words count as substantive", () => {
  for (const word of ["MRP", "Foods", "20.00", "1800-233-4455", "Qty:"]) {
    assert.ok(lines.isSubstantive(word), `${word} should count`);
  }
});

test("recognition debris does not count", () => {
  // These are verbatim tokens a failed read produced on a blurred label. A raw
  // word count sees text here; that is why the test exists.
  for (const junk of ["a", "2.", "i AS", "r D", ""]) {
    assert.ok(!lines.isSubstantive(junk), `${junk} should not count`);
  }
});

// ---------------------------------------------------------------------------
console.log("\nline grouping");

function word(text, x0, y0, x1, y1, confidence = 90) {
  return { text, box: [x0, y0, x1, y1], confidence: confidence / 100, rawConfidence: confidence };
}

test("words on one baseline merge into a single line, left to right", () => {
  const grouped = lines.groupWordsIntoLines([
    word("Weight", 60, 100, 110, 120),
    word("Net", 10, 100, 50, 120),
    word("200", 120, 100, 150, 120),
    word("g", 160, 100, 170, 120),
  ]);
  assert.strictEqual(grouped.length, 1);
  assert.strictEqual(grouped[0].text, "Net Weight 200 g");
  assert.deepStrictEqual(grouped[0].box, [10, 100, 170, 120]);
});

test("markedly smaller type on the same row is kept separate", () => {
  // The crowded-label failure: a tiny promotional flash beside the declaration
  // shares its baseline. Merging corrupted the net quantity into
  // "Net et Ot Qty: 100 g FREE 10% EXTRA" and extraction returned null.
  const grouped = lines.groupWordsIntoLines([
    word("Net", 10, 100, 60, 140),
    word("Qty:", 70, 100, 120, 140),
    word("FREE", 200, 112, 230, 128),
  ]);
  assert.strictEqual(grouped.length, 2);
  assert.strictEqual(grouped[0].text, "Net Qty:");
});

test("separate rows stay separate", () => {
  const grouped = lines.groupWordsIntoLines([
    word("First", 10, 10, 60, 30),
    word("Second", 10, 100, 70, 120),
  ]);
  assert.strictEqual(grouped.length, 2);
});

test("line output is ordered top to bottom", () => {
  const grouped = lines.groupWordsIntoLines([
    word("Lower", 10, 200, 60, 220),
    word("Upper", 10, 10, 60, 30),
  ]);
  assert.deepStrictEqual(grouped.map((l) => l.text), ["Upper", "Lower"]);
});

// ---------------------------------------------------------------------------
console.log("\nwrapped declaration merging");

function line(text, x0, y0, x1, y1, confidence = 0.9) {
  return { text, box: [x0, y0, x1, y1], confidence, words: text.split(" ").length, source: "line" };
}

test("a caption and its value on the next line are merged", () => {
  // Without this, extraction's manufacturer pattern -- which needs the name to
  // follow "by" in the same string -- can never match Indian packaging layout.
  const merged = lines.mergeWrappedLines([
    line("Manufactured & Packed by:", 130, 660, 620, 700),
    line("Sunrise Foods Private Limited", 130, 718, 660, 745),
  ]);
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].text, "Manufactured & Packed by: Sunrise Foods Private Limited");
});

test("lines far apart are not merged", () => {
  const merged = lines.mergeWrappedLines([
    line("Packed on: 03/2026", 130, 530, 480, 561),
    line("Unrelated block", 130, 900, 400, 930),
  ]);
  assert.strictEqual(merged.length, 0);
});

test("lines in different columns are not merged", () => {
  const merged = lines.mergeWrappedLines([
    line("Left column", 100, 100, 300, 130),
    line("Right column", 900, 140, 1100, 170),
  ]);
  assert.strictEqual(merged.length, 0);
});

test("adaptive gap threshold separates real line spacing distributions", () => {
  // Measured from the test labels: wrapped continuations 0.25-0.74 line heights,
  // declaration breaks 1.03-1.78. The boundary must land between them.
  const observed = [1.78, 1.15, 0.25, 1.09, 1.13, 1.03, 0.56, 0.7, 0.59, 1.59, 0.7, 0.63, 0.69, 0.7, 0.56, 0.74];
  const threshold = lines.adaptiveGapThreshold(observed);
  assert.ok(threshold > 0.74 && threshold < 1.03, `threshold ${threshold} is not between the clusters`);
});

test("uniform spacing falls back rather than inventing a boundary", () => {
  assert.strictEqual(lines.adaptiveGapThreshold([0.6, 0.62, 0.58, 0.61, 0.6, 0.59]), 0.85);
});

test("too few samples falls back", () => {
  assert.strictEqual(lines.adaptiveGapThreshold([0.5, 0.6]), 0.85);
});

// ---------------------------------------------------------------------------
console.log("\nvariant scoring");

test("more confident real words beats a handful of high-confidence tokens", () => {
  // Mean confidence alone would pick the second, which is plainly the worse read.
  const many = Array.from({ length: 20 }, () => ({ text: "Manufactured", confidence: 0.88 }));
  const few = [
    { text: "Foods", confidence: 0.99 },
    { text: "Limited", confidence: 0.99 },
  ];
  assert.ok(lines.scoreWords(many) > lines.scoreWords(few));
});

test("debris scores near zero", () => {
  const junk = [
    { text: "r D", confidence: 0.7 },
    { text: "a", confidence: 0.8 },
    { text: "2.", confidence: 0.6 },
  ];
  assert.strictEqual(lines.scoreWords(junk), 0);
});

// ---------------------------------------------------------------------------
console.log("\noffline setup");

test("language data resolves to a local path, never a CDN", () => {
  const resolved = engine.resolveLangPath();
  assert.ok(fs.existsSync(path.join(resolved, "eng.traineddata")), `missing traineddata in ${resolved}`);
});

// ---------------------------------------------------------------------------
(async () => {
  console.log("\nrecognition (needs ../test-data/images)");
  const images = fixtures();

  await asyncTest("rejects a path that does not exist", async () => {
    await assert.rejects(() => ocr.recognize("/no/such/file.png"), /not found/i);
  });

  await asyncTest("produces blocks matching the extraction contract", async () => {
    if (!images.length) return "skip";
    const { blocks } = await ocr.recognize(images[0]);
    assert.ok(blocks.length > 0, "no blocks produced");
    for (const block of blocks) {
      assert.strictEqual(typeof block.text, "string");
      assert.ok(block.text.length > 0);
      assert.ok(Array.isArray(block.box) && block.box.length === 4);
      assert.ok(block.box.every((n) => Number.isFinite(n)));
      assert.ok(block.confidence === null || (block.confidence >= 0 && block.confidence <= 1));
    }
  });

  await asyncTest("boxes lie within the image bounds", async () => {
    if (!images.length) return "skip";
    const { blocks, meta } = await ocr.recognize(images[0]);
    for (const block of blocks) {
      assert.ok(block.box[0] >= 0 && block.box[1] >= 0, "negative coordinate");
      assert.ok(block.box[2] <= meta.imageWidth * 1.02, "box past right edge");
      assert.ok(block.box[3] <= meta.imageHeight * 1.02, "box past bottom edge");
    }
  });

  await asyncTest("repeated runs on one image give identical output", async () => {
    if (!images.length) return "skip";
    const first = await ocr.recognizeToBlocks(images[0]);
    const second = await ocr.recognizeToBlocks(images[0]);
    assert.deepStrictEqual(first, second);
  });

  await asyncTest("a blank image is reported as illegible, not as empty text", async () => {
    const sharp = require("sharp");
    const blank = await sharp({
      create: { width: 900, height: 600, channels: 3, background: { r: 245, g: 245, b: 245 } },
    })
      .png()
      .toBuffer();
    const { meta } = await ocr.recognize(blank, { detectOrientation: false });
    // This is the safety property: a photograph that could not be read must not
    // arrive downstream looking like a package with every declaration missing.
    assert.strictEqual(meta.legible, false);
  });

  await ocr.shutdown();

  console.log(`\n${passed} passed, ${skipped} skipped, ${failures.length} failed\n`);
  process.exit(failures.length ? 1 : 0);
})();
