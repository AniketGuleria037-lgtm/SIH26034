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
async function normalizeSize(buffer) {
  const image = sharp(buffer, { failOn: "none" });
  const meta = await image.metadata();
  const longEdge = Math.max(meta.width || 0, meta.height || 0);

  if (!longEdge) {
    return { base: buffer, scale: 1, width: meta.width, height: meta.height };
  }

  let factor = 1;
  if (longEdge < MIN_LONG_EDGE) factor = MIN_LONG_EDGE / longEdge;
  else if (longEdge > MAX_LONG_EDGE) factor = MAX_LONG_EDGE / longEdge;

  if (factor === 1) {
    return { base: buffer, scale: 1, width: meta.width, height: meta.height };
  }

  const width = Math.round((meta.width || longEdge) * factor);
  const base = await sharp(buffer, { failOn: "none" })
    .resize({ width, kernel: factor > 1 ? "lanczos3" : "lanczos2" })
    .toBuffer();

  // Coordinates come back in processed space; callers multiply by `scale` to
  // return to the caller's original pixel space. Highlighting on the frontend
  // depends on this being right.
  return { base, scale: 1 / factor, width, height: Math.round((meta.height || 0) * factor) };
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
async function buildVariants(buffer, only = null) {
  const { base, scale, width, height } = await normalizeSize(buffer);
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
  MIN_LONG_EDGE,
  MAX_LONG_EDGE,
};
