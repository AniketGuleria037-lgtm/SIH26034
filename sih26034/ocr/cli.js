#!/usr/bin/env node
"use strict";

/**
 * Standalone OCR command line.
 *
 * Lets the OCR module be proved on its own, before the backend exists and
 * without touching anyone else's code -- which is what the team workflow asks
 * for in Phase 1.
 *
 *   node cli.js package.jpg                 human-readable blocks
 *   node cli.js package.jpg --json          the contract array, for piping
 *   node cli.js package.jpg --debug         per-variant scores and timings
 *   node cli.js package.jpg --extract       run extraction too, if present
 *   node cli.js package.jpg --granularity line
 */

const ocr = require("./index.js");

function parseArgs(argv) {
  const options = { files: [], flags: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      options.files.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      options.flags[key] = next;
      i += 1;
    } else {
      options.flags[key] = true;
    }
  }
  return options;
}

function usage() {
  console.log(`
SIH26034 OCR

  node cli.js <image> [options]

  --json              print the contract array only
  --debug             include per-variant scores
  --extract           also run ../extraction on the result
  --granularity <g>   line | wrapped | line+wrapped   (default line+wrapped)
  --psm <mode>        pin a Tesseract page segmentation mode
  --lang <code>       eng, or eng+hin once Hindi data is installed
`);
}

async function main() {
  const { files, flags } = parseArgs(process.argv.slice(2));
  if (!files.length || flags.help) {
    usage();
    process.exit(files.length ? 0 : 1);
  }

  const options = { debug: Boolean(flags.debug) };
  if (flags.granularity) options.granularity = flags.granularity;
  if (flags.psm) options.psm = String(flags.psm);
  if (flags.lang) options.lang = flags.lang;

  for (const file of files) {
    const { blocks, meta } = await ocr.recognize(file, options);
    const contract = blocks.map(({ text, box, confidence }) => ({ text, box, confidence }));

    if (flags.json) {
      console.log(JSON.stringify(contract, null, 2));
      continue;
    }

    console.log(`\n${file}`);
    console.log(
      `  ${meta.variant} · psm ${meta.psm} · rotation ${meta.rotation}° · ` +
        `score ${meta.score} · ${meta.durationMs} ms · legible: ${meta.legible}`
    );
    if (!meta.legible) {
      console.log("  WARNING: too little text recovered. Re-shoot with more light.");
    }
    console.log();

    for (const block of blocks) {
      const conf = block.confidence == null ? " -- " : block.confidence.toFixed(2);
      const tag = block.source === "wrapped" ? "wrap" : "line";
      console.log(`  [${tag}] ${conf}  ${JSON.stringify(block.text)}`);
    }

    if (flags.debug && meta.attempts) {
      console.log("\n  attempts:");
      for (const attempt of meta.attempts) {
        console.log(
          `    ${attempt.variant.padEnd(11)} psm ${String(attempt.psm).padEnd(3)} ` +
            `rot ${String(attempt.rotation).padEnd(4)} score ${String(attempt.score).padEnd(8)} ${attempt.ms} ms`
        );
      }
    }

    if (flags.extract) {
      try {
        const { extractDeclarations } = require("../extraction/index.js");
        console.log("\n  extraction:");
        const declarations = extractDeclarations(contract);
        for (const [field, value] of Object.entries(declarations)) {
          console.log(
            `    ${field.padEnd(15)} ${value.value === null ? "(not found)" : JSON.stringify(value.value)}`
          );
        }
      } catch (error) {
        console.log(`\n  extraction unavailable: ${error.message}`);
      }
    }
  }

  await ocr.shutdown();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
