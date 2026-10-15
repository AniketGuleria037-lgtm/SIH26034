"use strict";

/**
 * Accuracy harness.
 *
 * Runs the real pipeline — OCR, extraction, screening — over the labelled
 * corpus in test-data/images and scores each declaration against
 * test-data/ground-truth.json.
 *
 * The scoring distinguishes four outcomes, because they are not equally bad:
 *
 *   correct    read, and it matches the pack
 *   wrong      read, but it does NOT match the pack        <- the worst outcome
 *   missed     not read, but it was legible in this frame
 *   n/a        not read, and it genuinely was not there    <- not a failure
 *
 * WRONG is tracked separately and reported first. A confidently wrong MRP is
 * more damaging than a missing one: a missing declaration sends the inspector
 * to look, a wrong one sends them away satisfied with a false number.
 *
 * Usage:
 *   node test-data/accuracy.js                 whole corpus
 *   node test-data/accuracy.js chips sugar     only files matching a substring
 *   node test-data/accuracy.js --verbose       show what OCR read for misses
 */

const fs = require("fs");
const path = require("path");

const ocr = require("../ocr/index.js");
const {
  extractAcrossReads,
  declarationsOutstanding,
  orientationSuspect,
} = require("../extraction/detailed.js");
const { screenPackage } = require("../rules/index.js");

const FIELDS = ["mrp", "net_quantity", "manufacturer", "packing_date", "consumer_care"];

// Manufacturer and consumer-care are scored loosely: any defensible crop of the
// name, or any one of the contact routes printed on the pack, counts.
const SUBSTRING_FIELDS = new Set(["manufacturer", "consumer_care"]);

const truthPath = path.join(__dirname, "ground-truth.json");
const imageDir = path.join(__dirname, "images");

function loose(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Did the extractor get this declaration right?
 *
 * Exact fields still tolerate trailing-zero differences, because "₹20" and
 * "₹20.00" are the same price and which one comes back depends on how the pack
 * printed it, not on whether the read was correct.
 */
function matches(field, expected, actual) {
  if (actual === null || expected === null) return false;

  // A declaration may list several lawful values — a phone and an email for
  // consumer care, a packer and a marketer for the maker. Any one of them
  // satisfies the Rules, so any one counts as correct.
  if (Array.isArray(expected)) {
    return expected.some((option) => matches(field, option, actual));
  }

  const a = loose(actual);
  const e = loose(expected);

  if (SUBSTRING_FIELDS.has(field)) {
    return a.includes(e) || e.includes(a);
  }

  if (a === e) return true;

  if (field === "mrp") {
    const num = (v) => parseFloat(String(v).replace(/[^0-9.]/g, ""));
    return Math.abs(num(expected) - num(actual)) < 0.005;
  }

  return false;
}

function blank() {
  return { correct: 0, wrong: 0, missed: 0, na: 0 };
}

async function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes("--verbose");
  const filters = args.filter((a) => !a.startsWith("--"));

  const truth = JSON.parse(fs.readFileSync(truthPath, "utf8"));
  const cases = truth.images.filter(
    (c) => !filters.length || filters.some((f) => c.file.toLowerCase().includes(f.toLowerCase())),
  );

  const perField = Object.fromEntries(FIELDS.map((f) => [f, blank()]));
  const rows = [];
  const problems = [];
  let totalMs = 0;

  for (const testCase of cases) {
    const imagePath = path.join(imageDir, testCase.file);

    if (!fs.existsSync(imagePath)) {
      console.log(`SKIP ${testCase.file} — not found in test-data/images`);
      continue;
    }

    const started = Date.now();
    const { blocks, meta, reads } = await ocr.recognize(imagePath, { needsMore: declarationsOutstanding, orientationSuspect });
    const { declarations, evidence } = extractAcrossReads(reads);
    const screening = screenPackage(declarations, { evidence, ocrMeta: meta });
    const ms = Date.now() - started;
    totalMs += ms;

    const uncertain = new Set(testCase.uncertain || []);
    const absent = testCase.absent_reason || {};
    const marks = {};

    for (const field of FIELDS) {
      const expected = testCase.expected[field];
      const actual = declarations[field].value;

      let mark;
      if (expected === null || (Array.isArray(expected) && expected.length === 0)) {
        // Nothing to find. Reading something anyway is a false positive, which
        // is worse than the correct silence.
        mark = actual === null ? "na" : "wrong";
      } else if (actual === null) {
        mark = "missed";
      } else {
        mark = matches(field, expected, actual) ? "correct" : "wrong";
      }

      marks[field] = mark;
      perField[field][mark === "na" ? "na" : mark]++;

      if (mark === "wrong" || mark === "missed") {
        problems.push({
          file: testCase.file,
          field,
          mark,
          expected: expected === null ? "(nothing)" : expected,
          actual: actual === null ? "(not read)" : actual,
          uncertain: uncertain.has(field),
          absentReason: absent[field] || null,
        });
      }
    }

    rows.push({
      file: testCase.file,
      rotation: meta.rotation,
      variant: meta.variant,
      legible: meta.legible,
      score: Math.round(meta.score),
      verdict: screening.verdict.status,
      ms,
      marks,
    });

    if (verbose) {
      console.log(`\n--- ${testCase.file} (${testCase.product}) ---`);
      console.log(`    ${blocks.length} blocks · variant ${meta.variant} · rotation ${meta.rotation}`);
      for (const field of FIELDS) {
        console.log(
          `    ${marks[field].toUpperCase().padEnd(8)} ${field.padEnd(14)} ` +
            `got ${String(declarations[field].value).padEnd(28)} want ${testCase.expected[field]}`,
        );
      }
    }
  }

  await ocr.shutdown();

  /* ------------------------------ report ------------------------------ */

  const symbol = { correct: "+", wrong: "X", missed: "-", na: "." };

  console.log("\n  + correct   X WRONG   - missed   . not present\n");
  console.log(
    "  " +
      "file".padEnd(34) +
      FIELDS.map((f) => f.slice(0, 6).padEnd(7)).join("") +
      "rot  legible  time",
  );
  console.log("  " + "-".repeat(34 + 7 * 5 + 20));

  for (const row of rows) {
    console.log(
      "  " +
        row.file.slice(0, 33).padEnd(34) +
        FIELDS.map((f) => symbol[row.marks[f]].padEnd(7)).join("") +
        String(row.rotation).padEnd(5) +
        (row.legible ? "yes" : "NO ").padEnd(9) +
        `${(row.ms / 1000).toFixed(1)}s`,
    );
  }

  console.log("\n  Per declaration\n");
  console.log(
    "  " + "field".padEnd(16) + "correct".padEnd(10) + "WRONG".padEnd(9) + "missed".padEnd(9) + "n/a",
  );
  console.log("  " + "-".repeat(52));

  let totalCorrect = 0;
  let totalWrong = 0;
  let totalScorable = 0;

  for (const field of FIELDS) {
    const s = perField[field];
    const scorable = s.correct + s.wrong + s.missed;
    totalCorrect += s.correct;
    totalWrong += s.wrong;
    totalScorable += scorable;

    const pct = scorable ? `${Math.round((s.correct / scorable) * 100)}%` : "—";
    console.log(
      "  " +
        field.padEnd(16) +
        `${s.correct}/${scorable} ${pct}`.padEnd(10) +
        String(s.wrong).padEnd(9) +
        String(s.missed).padEnd(9) +
        String(s.na),
    );
  }

  const overall = totalScorable ? Math.round((totalCorrect / totalScorable) * 100) : 0;
  console.log("  " + "-".repeat(52));
  console.log(
    "  " +
      "OVERALL".padEnd(16) +
      `${totalCorrect}/${totalScorable} ${overall}%`.padEnd(10) +
      String(totalWrong).padEnd(9),
  );
  console.log(`\n  ${(totalMs / 1000 / rows.length).toFixed(1)}s per image average`);

  if (problems.length) {
    console.log("\n  What went wrong\n");
    for (const p of problems) {
      const flags = [
        p.uncertain ? "ground truth uncertain" : null,
        p.absentReason ? `absent: ${p.absentReason}` : null,
      ]
        .filter(Boolean)
        .join(", ");

      console.log(
        `  ${p.mark === "wrong" ? "X" : "-"} ${p.file.slice(0, 30).padEnd(31)} ${p.field.padEnd(14)}` +
          ` want ${String(p.expected).padEnd(24)} got ${p.actual}${flags ? `   [${flags}]` : ""}`,
      );
    }
  }

  console.log("");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
