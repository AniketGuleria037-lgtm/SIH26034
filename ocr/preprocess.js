"use strict";

/**
 * Image preprocessing variants.
 *
 * A single preprocessing recipe cannot serve every package photograph. A glossy
 * wrapper under shop lighting needs glare suppression; a faded thermal label
 * needs contrast stretching; a small crop needs upscaling. Applying the wrong
 * one makes recognition worse than doing nothing at all.
 *
 * So this module does not try to pick a recipe. It produces several, and
 * index.js runs recognition on each and keeps whichever actually scored best on
 * that specific image. Choosing by measured outcome instead of by guesswork is
 * the single largest accuracy lever in this module.
 */

const sharp = require("sharp");

// Tesseract is trained on roughly 300 DPI print. Below about 1200px on the long
// edge, small declaration text falls under the ~20px x-height it needs; above
// about 2600px we pay processing time for detail the recogniser cannot use.
const MIN_LONG_EDGE = 1200;
const MAX_LONG_EDGE = 2600;

/**
 * Bring an image into the resolution band where recognition works well.
 * @returns {{pipeline: import("sharp").Sharp, scale: number}} scale maps
 *   processed coordinates back to original coordinates (originalPx = px * scale)
 */
/**
 * Apply the EXIF orientation flag before anything else looks at the pixels.
 *
 * THIS IS THE MOST IMPORTANT LINE IN THE MODULE. Phone cameras almost always
 * store the sensor image in landscape and record "rotate me" as an EXIF tag
 * rather than rotating the pixels. Eight of the twelve photographs in
 * test-data/images carry orientation 6 or 8 — a quarter turn.
 *
 * Nothing warns you about this. sharp hands back the unrotated pixels unless
 * asked, so Tesseract was reading three quarters of the corpus sideways and
 * returning just enough plausible fragments to look like a bad photograph
 * rather than a bug. The rotation ladder in index.js would then burn several
 * seconds per image rediscovering an angle the file had stated all along.
 *
 * Browsers DO honour the tag, so this also makes what the recogniser sees match
 * what the inspector sees, which is what keeps the overlay boxes landing on the
 * right text.
 */
async function autoOrient(buffer) {
  try {
    return await sharp(buffer, { failOn: "none" }).rotate().toBuffer();
  } catch (_) {
    // A file with malformed EXIF is still a usable photograph.
    return buffer;
  }
}

async function normalizeSize(input, band = {}) {
  const minEdge = band.min || MIN_LONG_EDGE;
  const maxEdge = band.max || MAX_LONG_EDGE;
  const buffer = await autoOrient(input);
  const image = sharp(buffer, { failOn: "none" });
  const meta = await image.metadata();
  const longEdge = Math.max(meta.width || 0, meta.height || 0);

  if (!longEdge) {
    return { base: buffer, scale: 1, width: meta.width, height: meta.height };
  }

  let factor = 1;
  if (longEdge < minEdge) factor = minEdge / longEdge;
  else if (longEdge > maxEdge) factor = maxEdge / longEdge;

  if (factor === 1) {
    return { base: buffer, scale: 1, width: meta.width, height: meta.height };
  }

  const resizedWidth = Math.round((meta.width || longEdge) * factor);
  const base = await sharp(buffer, { failOn: "none" })
    .resize({ width: resizedWidth, kernel: factor > 1 ? "lanczos3" : "lanczos2" })
    .toBuffer();

  /*
   * Coordinates come back in processed space; callers multiply by `scale` to
   * return to the ORIENTED SOURCE pixel space. Highlighting on the frontend
   * depends on this being right.
   *
   * So `width`/`height` report the oriented source size, not the resized
   * working size. Reporting the working size was a quiet mismatch: boxes were
   * already being scaled back to source coordinates, so a box on the right-hand
   * edge of a downscaled image landed outside the dimensions the caller had
   * been told about. It surfaced only once the recognition tests in
   * ocr/ocr.test.js had images to run against.
   */
  return {
    base,
    scale: 1 / factor,
    width: meta.width,
    height: meta.height,
  };
}

/** Plain greyscale. The baseline every other variant is compared against. */
async function plain(base) {
  return sharp(base, { failOn: "none" }).greyscale().toBuffer();
}

/**
 * Histogram stretch. Recovers faded, low-ink and thermal-printed declarations
 * where the text is present but sits in a narrow band of greys.
 */
async function normalized(base) {
  return sharp(base, { failOn: "none" }).greyscale().normalise().toBuffer();
}

/**
 * Sharpened. Counteracts the softness of a handheld phone capture, which is how
 * most field photographs arrive.
 */
async function sharpened(base) {
  return sharp(base, { failOn: "none" })
    .greyscale()
    .normalise()
    .sharpen({ sigma: 1.2 })
    .toBuffer();
}

/**
 * Hard binarisation. The remedy for glossy wrappers and direct flash, where
 * specular highlights leave grey-on-grey text that greyscale alone cannot
 * separate. Destructive when the print is faint, which is exactly why it is
 * offered as one candidate rather than applied unconditionally.
 */
async function binarised(base) {
  return sharp(base, { failOn: "none" })
    .greyscale()
    .normalise()
    .median(1)
    .threshold(128)
    .toBuffer();
}

/**
 * Gamma lift plus mild blur. Helps dark packaging and underexposed shots, and
 * suppresses the sensor noise that low light produces.
 */
async function liftedShadows(base) {
  return sharp(base, { failOn: "none" })
    .greyscale()
    .gamma(2.2)
    .normalise()
    .median(1)
    .toBuffer();
}

const VARIANTS = [
  { name: "normalized", build: normalized },
  { name: "sharpened", build: sharpened },
  { name: "binarised", build: binarised },
  { name: "plain", build: plain },
  { name: "lifted", build: liftedShadows },
];

/**
 * Build preprocessing candidates for an image.
 * @param {Buffer} buffer original image bytes
 * @param {string[]|null} only restrict to these variant names
 */
async function buildVariants(buffer, only = null, band = {}) {
  const { base, scale, width, height } = await normalizeSize(buffer, band);
  const wanted = only ? VARIANTS.filter((v) => only.includes(v.name)) : VARIANTS;

  const built = [];
  for (const variant of wanted) {
    try {
      built.push({ name: variant.name, buffer: await variant.build(base), scale });
    } catch (error) {
      // A variant that cannot be produced is skipped, never fatal: losing one
      // candidate costs a little accuracy, losing the whole request costs the
      // inspection.
      built.push({ name: variant.name, buffer: null, scale, error: error.message });
    }
  }

  return { variants: built.filter((v) => v.buffer), scale, width, height };
}

/** Rotate by a multiple of 90 degrees, for pages photographed sideways. */
async function rotate(buffer, degrees) {
  if (!degrees) return buffer;
  return sharp(buffer, { failOn: "none" }).rotate(degrees).toBuffer();
}

module.exports = {
  buildVariants,
  normalizeSize,
  rotate,
  VARIANT_NAMES: VARIANTS.map((v) => v.name),
  normalizeSize,
  autoOrient,
  MIN_LONG_EDGE,
  MAX_LONG_EDGE,
  MIN_LONG_EDGE,
  MAX_LONG_EDGE,
};
