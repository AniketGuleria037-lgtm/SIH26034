"use strict";

/**
 * Tesseract worker lifecycle.
 *
 * Two things here are deliberate.
 *
 * OFFLINE BY DEFAULT. tesseract.js fetches language data from a CDN unless you
 * point it somewhere local. A demo that needs the internet to read an image is
 * a demo that fails on venue wifi, so the traineddata is committed under
 * ./tessdata and loaded from disk. Nothing in this module touches the network.
 *
 * WORKERS ARE REUSED. Spinning up a worker costs one to two seconds. Doing that
 * per request, across five preprocessing variants, would dominate the runtime.
 * The pool is created once, reused, and released on shutdown().
 */

const path = require("path");
const fs = require("fs");
const { createWorker } = require("tesseract.js");

const LOCAL_TESSDATA = path.join(__dirname, "tessdata");

// Tesseract page segmentation modes. 6 assumes a uniform block of text and is
// the right default for a flat label; 11 finds sparse text anywhere in the
// frame and rescues declarations scattered around packaging artwork.
const PSM_UNIFORM_BLOCK = "6";
const PSM_SPARSE = "11";

let pool = null;

function resolveLangPath(explicit) {
  if (explicit) return explicit;
  if (fs.existsSync(path.join(LOCAL_TESSDATA, "eng.traineddata"))) return LOCAL_TESSDATA;
  // Fall back to a system install if the bundled data is absent. If neither is
  // present tesseract.js would reach for the CDN, so we fail loudly instead --
  // a silent network dependency is worse than an error message.
  const system = "/usr/share/tesseract-ocr/5/tessdata";
  if (fs.existsSync(path.join(system, "eng.traineddata"))) return system;
  throw new Error(
    "No local traineddata found. Expected ocr/tessdata/eng.traineddata. " +
      "Run: npm run fetch-langdata (or copy eng.traineddata into ocr/tessdata/)."
  );
}

/**
 * Create (or return) the shared worker.
 * @param {{lang?: string, langPath?: string}} options
 */
async function getWorker(options = {}) {
  const lang = options.lang || process.env.OCR_LANGS || "eng";
  if (pool && pool.lang === lang) return pool.worker;
  if (pool) await shutdown();

  const langPath = resolveLangPath(options.langPath);
  const worker = await createWorker(lang, 1, {
    langPath,
    gzip: false,
    cacheMethod: "none",
    logger: () => {},
    errorHandler: () => {},
  });

  pool = { worker, lang, langPath };
  return worker;
}

/**
 * Recognise one prepared image buffer.
 * @param {Buffer} buffer preprocessed image
 * @param {{psm?: string, lang?: string, langPath?: string}} options
 */
async function recognizeBuffer(buffer, options = {}) {
  const worker = await getWorker(options);
  const psm = options.psm || PSM_UNIFORM_BLOCK;

  await worker.setParameters({
    tessedit_pageseg_mode: psm,
    // Preserve inter-word spacing so a declaration and the text crowding it stay
    // distinguishable rather than being run together into one token.
    preserve_interword_spaces: "1",
  });

  const { data } = await worker.recognize(buffer, {}, { blocks: true, text: true });
  return data;
}

async function shutdown() {
  if (!pool) return;
  try {
    await pool.worker.terminate();
  } catch (_) {
    // Termination failure is not worth propagating; the process is ending.
  }
  pool = null;
}

function isReady() {
  return pool !== null;
}

module.exports = {
  getWorker,
  recognizeBuffer,
  shutdown,
  isReady,
  resolveLangPath,
  PSM_UNIFORM_BLOCK,
  PSM_SPARSE,
  LOCAL_TESSDATA,
};
