"use strict";

/**
 * OCR benchmark.
 *
 * Reports how many of the five locked declarations survive the full
 * OCR -> extraction chain, per image. This is the number that matters: OCR
 * accuracy measured in characters is not the deliverable, fields recovered is.
 *
 *   node benchmark.js                      # runs on ../test-data/images
 *   node benchmark.js img1.png img2.png    # runs on specific files
 *   node benchmark.js --json out.json
 */

const fs = require("fs");
const path = require("path");
const ocr = require("./index.js");

const FIELDS = ["mrp", "net_quantity", "manufacturer", "packing_date", "consumer_care"];

function loadExtractor() {
  try {
    return require("../extraction/index.js").extractDeclarations;
  } catch (_) {
    return null;
  }
}

function expectationsFor(file) {
  // Fixture naming convention: a file named *_missing_<field> is expected to be
  // missing that field, so a null there is a correct result rather than a miss.
  // Fixtures are named so the expected answer is readable from the filename:
  // "02_missing_mrp.png" and "05_no_consumer_care.png" both declare which field
  // is absent, so a null there scores as correct rather than as a miss.
  const name = path.basename(file, path.extname(file));
  const found = FIELDS.filter((field) =>
    new RegExp(`(?:missing|no|without)[_-]${field}\\b`, "i").test(name)
  );
  return found;
}

async function main() {
  const args = process.argv.slice(2);
  const jsonIndex = args.indexOf("--json");
  const jsonPath = jsonIndex >= 0 ? args[jsonIndex + 1] : null;
  if (jsonIndex >= 0) args.splice(jsonIndex, 2);

  let files = args.filter((a) => !a.startsWith("--"));
  if (!files.length) {
    const dir = path.join(__dirname, "..", "test-data", "images");
    if (!fs.existsSync(dir)) {
      console.error(`No images given and ${dir} does not exist.`);
      process.exit(1);
    }
    files = fs
      .readdirSync(dir)
      .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
      .map((f) => path.join(dir, f));
  }

  const extract = loadExtractor();
  const rows = [];
  let recovered = 0;
  let expected = 0;

  console.log(
    `\n${"image".padEnd(34)} ${"variant".padEnd(11)} ${"psm".padEnd(4)} ${"rot".padEnd(4)} ${"ms".padEnd(6)} fields`
  );
  console.log("-".repeat(92));

  for (const file of files) {
    let result;
    try {
      result = await ocr.recognize(file);
    } catch (error) {
      console.log(`${path.basename(file).padEnd(34)} ERROR ${error.message}`);
      continue;
    }

    const { blocks, meta } = result;
    const row = {
      file: path.basename(file),
      variant: meta.variant,
      psm: meta.psm,
      rotation: meta.rotation,
      ms: meta.durationMs,
      blocks: blocks.length,
      score: meta.score,
      legible: meta.legible,
    };

    if (extract) {
      const declarations = extract(
        blocks.map(({ text, box, confidence }) => ({ text, box, confidence }))
      );
      const absent = expectationsFor(file);
      const wanted = FIELDS.filter((f) => !absent.includes(f));
      const found = wanted.filter((f) => declarations[f].value !== null);
      const boxed = wanted.filter((f) => declarations[f].box !== null);

      recovered += found.length;
      expected += wanted.length;
      row.found = found.length;
      row.wanted = wanted.length;
      row.boxed = boxed.length;
      row.missing = wanted.filter((f) => declarations[f].value === null);
      row.values = Object.fromEntries(
        FIELDS.map((f) => [f, declarations[f].value])
      );
    }

    rows.push(row);
    const fieldNote = extract
      ? `${row.found}/${row.wanted}${row.missing.length ? "  missing: " + row.missing.join(", ") : ""}`
      : `${blocks.length} blocks`;
    console.log(
      `${row.file.slice(0, 33).padEnd(34)} ${meta.variant.padEnd(11)} ${String(meta.psm).padEnd(4)} ${String(meta.rotation).padEnd(4)} ${String(meta.durationMs).padEnd(6)} ${fieldNote}`
    );
  }

  if (extract && expected) {
    const boxedTotal = rows.reduce((n, r) => n + (r.boxed || 0), 0);
    console.log("-".repeat(92));
    console.log(
      `\nDeclaration recovery   ${recovered}/${expected}  (${((100 * recovered) / expected).toFixed(1)}%)`
    );
    console.log(
      `Boxes for highlighting ${boxedTotal}/${recovered}  (${((100 * boxedTotal) / Math.max(1, recovered)).toFixed(1)}% of recovered fields)`
    );
    const times = rows.map((r) => r.ms).sort((a, b) => a - b);
    console.log(
      `Latency                median ${times[Math.floor(times.length / 2)]} ms   max ${times[times.length - 1]} ms`
    );
    const illegible = rows.filter((r) => !r.legible).map((r) => r.file);
    if (illegible.length) console.log(`Refused as illegible   ${illegible.join(", ")}`);
    console.log();
  }

  if (jsonPath) {
    fs.writeFileSync(jsonPath, JSON.stringify(rows, null, 2));
    console.log(`wrote ${jsonPath}\n`);
  }

  await ocr.shutdown();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
