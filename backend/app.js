"use strict";

/**
 * Backend API.
 *
 * The orchestration itself is four calls deep — OCR, extraction, screening,
 * report — and that part is simple. What this file is mostly concerned with is
 * everything around those four calls that decides whether the demo survives
 * contact with a real inspector:
 *
 *   AN UNREADABLE PHOTOGRAPH IS NOT A VIOLATION. If OCR reports the frame was
 *   illegible, the response says so instead of reporting five absent
 *   declarations. This is the single most important behaviour in the service.
 *
 *   OCR IS SLOW AND BOUNDED. A difficult image climbs an escalation ladder of
 *   preprocessing variants and rotations. Without a timeout a single bad upload
 *   holds a request open indefinitely, so there is one.
 *
 *   ERRORS ARE TYPED. The UI needs to tell "your file was not an image" apart
 *   from "the recogniser fell over", because the first is the inspector's to fix
 *   and the second is ours. Every failure carries a machine-readable code.
 *
 *   THE WORKER IS WARMED. Starting a Tesseract worker costs a second or two.
 *   Paying that on the first inspection of a demo is a bad first impression, so
 *   it is paid at boot instead.
 */

const express = require("express");
const path = require("path");
const fs = require("fs");

const ocr = require("../ocr/index.js");
const {
  extractAcrossReads,
  declarationsOutstanding,
  orientationSuspect,
} = require("../extraction/detailed.js");
const { evaluateCompliance, screenPackage, loadCatalog } = require("../rules/index.js");
const { buildReportHtml, buildReportPdf, reportFilename } = require("../report/index.js");

const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/octet-stream",
];

const MAX_UPLOAD = "12mb";
/*
 * Ceiling on one recognition.
 *
 * Generous on purpose. A 4096px photograph of a cluttered pack climbs several
 * preprocessing recipes, two segmentation modes and a second finer scale, and
 * the hardest frames in test-data/images take close to a minute on a laptop.
 * Cutting them off at 45s turned a slow but correct read into a failed
 * inspection, which is the wrong trade: the inspector would rather wait than
 * re-shoot a frame that was fine.
 *
 * Lower it with OCR_TIMEOUT_MS if you are running somewhere faster.
 */
const OCR_TIMEOUT_MS = Number(process.env.OCR_TIMEOUT_MS || 120000);

const DEFAULT_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

function allowedOrigins() {
  const configured = process.env.CORS_ORIGINS;
  if (!configured) return DEFAULT_ORIGINS;
  if (configured.trim() === "*") return "*";
  return configured
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function fail(res, httpStatus, code, message, extra = {}) {
  return res.status(httpStatus).json({ error: { code, message, ...extra } });
}

/**
 * Reject a request that has run too long rather than letting it hang.
 *
 * Promise.race leaves the OCR work running in the background; that is
 * deliberate. Tesseract has no cancellation, and terminating the shared worker
 * mid-recognition would break the next request too. The abandoned pass finishes
 * quietly and its result is discarded.
 */
function withTimeout(promise, ms, code) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`Step exceeded ${ms}ms`);
      error.code = code;
      reject(error);
    }, ms);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Inspection numbering. Sequential within a process run; the demo needs it to
 *  look like a case file, not a UUID. */
function createInspectionCounter(start = 42) {
  let next = start;
  return () => String(next++).padStart(3, "0");
}

function createApp(options = {}) {
  const app = express();
  const nextInspectionId = options.nextInspectionId || createInspectionCounter();
  const origins = allowedOrigins();

  app.disable("x-powered-by");

  app.use((req, res, next) => {
    const origin = req.headers.origin;

    if (origins === "*") {
      res.header("Access-Control-Allow-Origin", "*");
    } else if (origin && origins.includes(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header("Vary", "Origin");
    }

    res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    res.header("Access-Control-Max-Age", "600");

    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  /* ----------------------------- health ----------------------------- */

  app.get("/api/health", (req, res) => {
    let langdata = "missing";
    try {
      langdata = ocr.DEFAULTS ? "bundled" : "unknown";
      require("../ocr/engine.js").resolveLangPath(null);
      langdata = "bundled";
    } catch (_) {
      langdata = "missing";
    }

    res.json({
      status: "ok",
      service: "packcheck-backend",
      ocr: { engine: "tesseract.js", langdata, warm: options.warm === true },
      rules: { catalog_version: loadCatalog().version },
      uptime_s: Math.round(process.uptime()),
    });
  });

  // The original path, kept so anything already pointing at it keeps working.
  app.get("/health", (req, res) => res.json({ status: "ok" }));

  /* --------------------------- rules catalog --------------------------- */

  // Backs the "Reference rules" screen. The UI should never hardcode the
  // declaration list: if the catalogue changes, the screen changes with it.
  app.get("/api/catalog", (req, res) => {
    try {
      res.json(loadCatalog());
    } catch (error) {
      fail(res, 500, "CATALOG_UNREADABLE", "The rules catalogue could not be read.");
    }
  });

  /* ------------------------------ analyze ------------------------------ */

  const rawImage = express.raw({ type: ACCEPTED_IMAGE_TYPES, limit: MAX_UPLOAD });

  app.post("/api/analyze", rawImage, async (req, res) => {
    const startedAt = Date.now();

    if (!req.body || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      return fail(
        res,
        400,
        "NO_IMAGE",
        "Send the image bytes as the request body with a Content-Type of image/jpeg, image/png or image/webp.",
      );
    }

    try {
      const { blocks, meta, reads } = await withTimeout(
        ocr.recognize(req.body, {
          debug: req.query.debug === "1",
          // Skip the slower fine pass when the first read already found every
          // declaration.
          needsMore: declarationsOutstanding,
          // Fires the rotation search when the pack was lying sideways.
          orientationSuspect,
        }),
        OCR_TIMEOUT_MS,
        "OCR_TIMEOUT",
      );

      /*
       * Assembled from EVERY read, not just the best-scoring one.
       *
       * Measured on test-data/images, the same photograph gives up different
       * declarations at different scales and preprocessing recipes. Taking one
       * winning read discards correct values the losing reads had already
       * found — merging per declaration lifted corpus accuracy from 30% to 41%
       * at no extra recognition cost.
       */
      const { declarations, evidence, agreement } = extractAcrossReads(reads);
      const screening = screenPackage(declarations, { evidence, ocrMeta: meta });

      const inspection = {
        id: nextInspectionId(),
        created_at: new Date().toISOString(),
        image: {
          name: typeof req.query.name === "string" ? req.query.name : null,
          content_type: req.headers["content-type"] || null,
          bytes: req.body.length,
          width: meta.imageWidth || null,
          height: meta.imageHeight || null,
        },
        product: typeof req.query.product === "string" ? req.query.product : null,
      };

      return res.json({
        inspection,
        ...screening,
        ocr: {
          meta: { ...meta, reads: reads.length, agreement },
          // Full block list is large and only useful for debugging, so it is
          // opt-in rather than shipped on every response.
          blocks: req.query.blocks === "1" ? blocks : undefined,
        },
        // Original PASS/FAIL contract, kept alongside the screening result so
        // anything built against the first API still works.
        legacy: evaluateCompliance(declarations),
        timing_ms: Date.now() - startedAt,
      });
    } catch (error) {
      if (error && error.code === "OCR_TIMEOUT") {
        return fail(
          res,
          504,
          "OCR_TIMEOUT",
          "Reading this image took too long. Crop to the label panel and try again.",
        );
      }

      if (error && /could not be preprocessed|unsupported image/i.test(String(error.message))) {
        return fail(
          res,
          415,
          "UNREADABLE_FILE",
          "That file could not be opened as an image. Upload a JPEG, PNG or WebP photograph.",
        );
      }

      if (error && /traineddata/i.test(String(error.message))) {
        return fail(
          res,
          503,
          "OCR_LANGDATA_MISSING",
          "The recogniser has no language data installed. Place eng.traineddata in ocr/tessdata/.",
        );
      }

      console.error("[analyze] failed:", error);
      return fail(res, 500, "ANALYSIS_FAILED", "The inspection could not be completed.");
    }
  });

  // Original path, same handler.
  app.post("/analyze", rawImage, (req, res, next) => {
    req.url = "/api/analyze";
    app._router.handle(req, res, next);
  });

  /* ------------------------------- report ------------------------------- */

  app.post("/api/report", express.json({ limit: "2mb" }), async (req, res) => {
    const { screening, context, format } = req.body || {};

    if (!screening || !Array.isArray(screening.declarations)) {
      return fail(
        res,
        400,
        "NO_SCREENING",
        "Post the screening result you want turned into a report.",
      );
    }

    const wantsPdf = String(format || "pdf").toLowerCase() === "pdf";

    try {
      if (!wantsPdf) {
        const html = buildReportHtml(screening, context || {});
        res.type("html");
        res.setHeader(
          "Content-Disposition",
          `inline; filename="${reportFilename(context, "html")}"`,
        );
        return res.send(html);
      }

      const pdf = await buildReportPdf(screening, context || {});
      res.type("application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${reportFilename(context, "pdf")}"`,
      );
      return res.send(pdf);
    } catch (error) {
      if (/pdfkit/i.test(String(error.message))) {
        // Fall back rather than fail: an HTML report the inspector can print is
        // far more useful than an error about a missing dependency.
        try {
          const html = buildReportHtml(screening, context || {});
          res.type("html");
          res.setHeader("X-Report-Fallback", "html");
          return res.send(html);
        } catch (_) {
          /* fall through to the generic error */
        }
      }

      console.error("[report] failed:", error);
      return fail(res, 500, "REPORT_FAILED", "The report could not be generated.");
    }
  });

  /* --------------------------- built frontend --------------------------- */

  // Serving the built UI from the API means one process and one URL at demo
  // time, with no second terminal to forget about.
  const distPath = path.join(__dirname, "..", "frontend", "dist");
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get(/^\/(?!api\/).*/, (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.use((req, res) => fail(res, 404, "NOT_FOUND", `No route for ${req.method} ${req.path}.`));

  // Express surfaces body-parser limits here rather than in the route.
  app.use((error, req, res, next) => {
    if (error && error.type === "entity.too.large") {
      return fail(res, 413, "IMAGE_TOO_LARGE", `Images must be under ${MAX_UPLOAD}.`);
    }
    if (error && error.type === "entity.parse.failed") {
      return fail(res, 400, "BAD_JSON", "The request body was not valid JSON.");
    }
    console.error("[unhandled]", error);
    return fail(res, 500, "INTERNAL", "Something went wrong handling that request.");
  });

  return app;
}

module.exports = { createApp, createInspectionCounter, ACCEPTED_IMAGE_TYPES, MAX_UPLOAD };
