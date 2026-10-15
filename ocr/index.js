"use strict";

/**
 * OCR module for SIH26034.
 *
 * Contract with the rest of the system:
 *
 *   image bytes  ->  [ { text, box: [x1,y1,x2,y2], confidence }, ... ]
 *
 * That array is exactly what extraction/index.js consumes. Coordinates are in
 * the ORIGINAL image's pixel space regardless of any internal resizing, so the
 * frontend can draw highlight boxes straight onto the photograph the inspector
 * uploaded.
 *
 * What this module does beyond calling an OCR engine:
 *
 *   1. Runs several preprocessing recipes and keeps whichever measurably read
 *      best on this specific image, instead of guessing one in advance.
 *   2. Detects sideways and upside-down photographs and retries.
 *   3. Emits text at line AND paragraph granularity, because declarations wrap
 *      across lines and the extractor matches whole strings.
 *   4. Reports whether the image was legible at all, so the backend can ask for
 *      a re-shoot instead of reporting a blank read as five missing fields.
 *
 * Everything is offline. Nothing here makes a network call.
 */

const fs = require("fs");
const engine = require("./engine.js");
const preprocess = require("./preprocess.js");
const lines = require("./lines.js");

// Below this, a photograph is already being upscaled into the working band and
// a finer pass would only invent detail.
const MAX_WORKING_EDGE = 2600;

const DEFAULTS = {
  // Names from preprocess.VARIANT_NAMES, in the order they are tried.
  variants: ["normalized", "sharpened", "binarised"],
  granularity: "line+wrapped", // "line" | "wrapped" | "line+wrapped"
  minConfidence: 0.3,
  detectOrientation: true,
  lang: process.env.OCR_LANGS || "eng",
  langPath: null,
  // Segmentation modes to search, cheapest-first. 6 treats the label as one
  // uniform block and is right for most flat packaging; 11 finds sparse text
  // anywhere in the frame and is markedly better when promotional flashes sit
  // close to a declaration -- on the crowded test label it read "Net Qty: 100 g"
  // where mode 6 produced "Net Ot Qty: 100 g" and broke extraction.
  psmLadder: [engine.PSM_UNIFORM_BLOCK, engine.PSM_SPARSE],
  psm: null, // set to pin a single mode and skip the ladder
  // Below this score the read is treated as a failure worth retrying with a
  // different page-segmentation mode or rotation.
  weakScore: 40,
  /*
   * A SECOND PASS AT A FINER SCALE.
   *
   * Tesseract wants roughly 20px of x-height. On a 4096px phone photograph of a
   * whole pack, the declaration panel is a fraction of the frame, so after
   * downscaling to the 2600px working band that x-height falls below what the
   * recogniser can use — and the declaration is simply not read.
   *
   * Scale is not a setting with one right answer, though. Measured on
   * test-data/images, the SAME photograph gives up different declarations at
   * different scales: the sugar pack yields its net weight and care number at
   * 2600px and its price only at 3400px. Neither scale wins outright.
   *
   * So both are kept. This pass is a single normalised read rather than the
   * full variant search, because the extra pixels cost time and the point is
   * coverage, not another winner.
   */
  fineScale: 3600,
  debug: false,
};

/** Accept a file path, a Buffer, or a base64 data URL. */
async function toBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (typeof input !== "string") {
    throw new TypeError("Expected an image path, Buffer, or data URL");
  }
  if (input.startsWith("data:")) {
    const comma = input.indexOf(",");
    if (comma === -1) throw new Error("Malformed data URL");
    return Buffer.from(input.slice(comma + 1), "base64");
  }
  if (!fs.existsSync(input)) throw new Error(`Image not found: ${input}`);
  return fs.promises.readFile(input);
}

/** Run one variant and score the result. */
async function runVariant(variant, options) {
  const started = Date.now();
  const data = await engine.recognizeBuffer(variant.buffer, {
    psm: options.psm,
    lang: options.lang,
    langPath: options.langPath,
  });

  const words = lines.flattenWords(data, variant.scale);
  return {
    variant: variant.name,
    psm: options.psm,
    data,
    words,
    scale: variant.scale,
    score: lines.scoreWords(words),
    substantive: words.filter((w) => lines.isSubstantive(w.text)).length,
    ms: Date.now() - started,
  };
}

/**
 * Decide whether the image is the right way up.
 *
 * A package photographed sideways reads as near-total nonsense, and the symptom
 * is indistinguishable from a blurred image unless you actually try the other
 * orientations. This only runs when the upright read scored poorly, so the cost
 * is paid on the images that need it and not on the ones that do not.
 */
async function tryRotations(buffer, best, options) {
  const attempts = [];
  for (const degrees of [90, 180, 270]) {
    const rotated = await preprocess.rotate(buffer, degrees);
    const { variants } = await preprocess.buildVariants(rotated, ["normalized"]);
    if (!variants.length) continue;
    const result = await runVariant(variants[0], { ...options, psm: options.psm || options.psmLadder[0] });
    result.rotation = degrees;
    attempts.push(result);
    // A clearly better read means we have found the true orientation; stop.
    if (result.score > best.score * 1.6) break;
  }

  const winner = attempts.reduce((a, b) => (b.score > a.score ? b : a), best);
  return { winner, attempts };
}

/**
 * Recognise text in a package image.
 *
 * @param {string|Buffer} input image path, Buffer, or data URL
 * @param {object} [opts] see DEFAULTS
 * @returns {Promise<{blocks: Array, meta: object}>}
 */
async function recognize(input, opts = {}) {
  const options = { ...DEFAULTS, ...opts };
  const started = Date.now();
  const buffer = await toBuffer(input);

  const { variants, width, height } = await preprocess.buildVariants(
    buffer,
    options.variants
  );
  if (!variants.length) throw new Error("Image could not be preprocessed");

  // Search strategy: two stages, not a full grid.
  //
  // Stage 1 finds the best preprocessing at the primary segmentation mode.
  // Stage 2 re-runs only that winner through the remaining modes. A full
  // variants x modes grid would roughly double the runtime to test
  // combinations that almost never win, so we spend the extra passes on the
  // one variant that already proved itself on this image.
  const ladder = options.psm ? [options.psm] : options.psmLadder;
  const attempts = [];

  for (const variant of variants) {
    attempts.push(await runVariant(variant, { ...options, psm: ladder[0] }));
  }
  let best = attempts.reduce((a, b) => (b.score > a.score ? b : a));

  for (const psm of ladder.slice(1)) {
    const winningVariant = variants.find((v) => v.name === best.variant) || variants[0];
    const attempt = await runVariant(winningVariant, { ...options, psm });
    attempts.push(attempt);
    if (attempt.score > best.score) best = attempt;
  }

  // Escalation ladder. Each step is tried only if the previous read looked bad,
  // so a clean photograph costs one pass and a difficult one gets the effort it
  // actually needs.
  /*
   * Rotation search, triggered two ways.
   *
   * A low score catches a frame that read as noise. It does NOT catch the case
   * that actually matters most on real packs: the photograph is upright, but
   * the PACK is lying on its side, so the label runs vertically. Tesseract
   * still recognises a scattering of letters from sideways text, which is
   * enough to push the score above any sensible weakness threshold, so the
   * rotation search never fired and the read was quietly useless.
   *
   * EXIF orientation does not help here either. That flag describes how the
   * camera was held, not how the object was lying.
   *
   * The reliable signal is domain specific: if almost none of the five
   * declaration LABELS can be found, the text is probably not the right way up.
   * That judgement belongs to extraction, not here, so the caller supplies it.
   */
  let rotationAttempts = [];
  if (options.detectOrientation) {
    let suspect = best.score < options.weakScore;

    if (!suspect && typeof options.orientationSuspect === "function") {
      try {
        suspect = Boolean(options.orientationSuspect(assembleBlocks(best, options)));
      } catch (_) {
        suspect = false;
      }
    }

    if (suspect) {
      const rotated = await tryRotations(buffer, best, options);
      rotationAttempts = rotated.attempts;
      best = rotated.winner;
    }
  }

  /*
   * The fine pass, run only when it is likely to add something.
   *
   * It costs roughly twice a working-scale pass, and on a clean flat label it
   * finds nothing the first pass missed — so spending it every time made the
   * average image 40% slower for no gain, and a couple of hard frames took
   * nearly a minute.
   *
   * Whether anything is still missing is a question about DECLARATIONS, which
   * this module knows nothing about. So the caller supplies the predicate and
   * the layering stays intact: OCR decides how to read, extraction decides
   * what counts as read. With no predicate the pass runs, because a caller who
   * has not said otherwise is better served by coverage than by speed.
   */
  let fineAttempt = null;
  const hasPixelsToSpare =
    options.fineScale && width && height && Math.max(width, height) >= MAX_WORKING_EDGE;

  let wantsFine = true;
  if (hasPixelsToSpare && typeof options.needsMore === "function") {
    try {
      wantsFine = Boolean(options.needsMore(assembleBlocks(best, options)));
    } catch (_) {
      // A caller predicate that throws must not cost the inspection.
      wantsFine = true;
    }
  }

  if (hasPixelsToSpare && wantsFine) {
    try {
      const fine = await preprocess.buildVariants(buffer, ["normalized"], {
        min: options.fineScale,
        max: options.fineScale,
      });

      if (fine.variants.length) {
        fineAttempt = await runVariant(fine.variants[0], {
          ...options,
          psm: ladder[0],
        });
        fineAttempt.scaleName = "fine";
        attempts.push(fineAttempt);
      }
    } catch (_) {
      // Losing the fine pass costs coverage, never the inspection.
    }
  }

  const blocks = assembleBlocks(best, options);
  const substantive = blocks.filter((b) => lines.isSubstantive(b.text.split(/\s+/)[0] || "")).length;

  const meta = {
    engine: "tesseract.js",
    finePass: fineAttempt ? options.fineScale : null,
    lang: options.lang,
    variant: best.variant,
    psm: best.psm,
    rotation: best.rotation || 0,
    score: best.score,
    imageWidth: width,
    imageHeight: height,
    wordCount: best.words.length,
    substantiveWordCount: best.substantive,
    meanConfidence: meanOf(blocks.map((b) => b.confidence)),
    legible: isLegible(best),
    durationMs: Date.now() - started,
  };

  if (options.debug) {
    meta.attempts = [...attempts, ...rotationAttempts].map((a) => ({
      variant: a.variant,
      psm: a.psm,
      rotation: a.rotation || 0,
      score: a.score,
      words: a.words.length,
      substantive: a.substantive,
      ms: a.ms,
    }));
  }

  /*
   * Every read, not just the winner.
   *
   * Picking one global winner and discarding the rest throws away declarations
   * that only the losing reads found. The caller can merge across these per
   * field — see extractAcrossReads in extraction/detailed.js — which costs
   * nothing extra, because the passes have already been paid for.
   *
   * Boxes in every read are mapped back to the oriented source image, so
   * coordinates are directly comparable between them.
   */
  const reads = attempts
    .filter((attempt) => attempt.words.length)
    .map((attempt) => ({
      variant: attempt.variant,
      psm: attempt.psm,
      rotation: attempt.rotation || 0,
      scale: attempt.scaleName || "working",
      score: attempt.score,
      blocks: assembleBlocks(attempt, options),
    }))
    .filter((read) => read.blocks.length);

  return { blocks, meta, reads };
}

function assembleBlocks(best, options) {
  const out = [];
  const grouped = lines.groupWordsIntoLines(best.words);

  if (options.granularity !== "wrapped") out.push(...grouped);
  if (options.granularity !== "line") out.push(...lines.mergeWrappedLines(grouped));

  return out
    .filter((b) => b.text && b.box)
    .filter((b) => b.confidence === null || b.confidence >= options.minConfidence)
    // Deterministic order: top to bottom, then left to right, lines before the
    // paragraphs that contain them. Two runs on the same image must produce the
    // same array, or downstream tests become flaky for no reason.
    .sort(
      (a, b) =>
        a.box[1] - b.box[1] ||
        a.box[0] - b.box[0] ||
        (a.source === "line" ? -1 : 1)
    );
}

/**
 * Was anything actually read?
 *
 * A failed read does not come back empty -- it comes back as a handful of
 * confident fragments. Reporting that as "all five declarations missing" would
 * turn a bad photograph into a compliance violation, which is the worst mistake
 * this system could make. Two independent signals must both look like failure.
 */
function isLegible(best) {
  return !(best.substantive < 5 && best.score < 15);
}

function meanOf(values) {
  const nums = values.filter((v) => typeof v === "number");
  if (!nums.length) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 1000) / 1000;
}

/**
 * Convenience wrapper returning ONLY the contract array, ready to hand straight
 * to extractDeclarations().
 */
async function recognizeToBlocks(input, opts = {}) {
  const { blocks } = await recognize(input, opts);
  return blocks.map(({ text, box, confidence }) => ({ text, box, confidence }));
}

/** Pre-load the worker so the first real request is not slowed by startup. */
async function warmup(opts = {}) {
  await engine.getWorker({ lang: opts.lang || DEFAULTS.lang, langPath: opts.langPath });
}

module.exports = {
  recognize,
  recognizeToBlocks,
  warmup,
  shutdown: engine.shutdown,
  DEFAULTS,
  VARIANT_NAMES: preprocess.VARIANT_NAMES,
};
