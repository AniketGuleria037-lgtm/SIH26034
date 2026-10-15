"use strict";

/**
 * Server entry point.
 *
 * Kept separate from app.js so the API can be required and exercised in tests
 * without binding a port.
 */

const { createApp } = require("./app.js");
const ocr = require("../ocr/index.js");

const port = Number(process.env.PORT || 5000);
const state = { warm: false };
const app = createApp(state);

const server = app.listen(port, () => {
  console.log(`PackCheck backend listening on http://localhost:${port}`);
  console.log(`  health   GET  /api/health`);
  console.log(`  catalog  GET  /api/catalog`);
  console.log(`  analyze  POST /api/analyze   (raw image bytes)`);
  console.log(`  report   POST /api/report    (screening JSON -> PDF)`);

  // Warm the recogniser after the port is open. Doing it before would delay
  // startup, and doing it lazily would put the one-off worker cost on the first
  // inspection of the demo.
  ocr
    .warmup()
    .then(() => {
      state.warm = true;
      console.log("  recogniser warm");
    })
    .catch((error) => {
      console.warn(`  recogniser not warm: ${error.message}`);
    });
});

/**
 * Shut the Tesseract worker down on the way out. A leaked worker keeps the
 * process alive and makes `npm start` look hung after Ctrl-C.
 */
function shutdown(signal) {
  console.log(`\n${signal} received, shutting down`);
  server.close(() => {
    ocr
      .shutdown()
      .catch(() => {})
      .finally(() => process.exit(0));
  });

  // Do not wait forever for in-flight OCR to finish.
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
