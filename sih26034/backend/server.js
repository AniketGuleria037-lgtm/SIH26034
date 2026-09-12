"use strict";

const express = require("express");
const { extractDeclarations } = require("../extraction/index.js");
const { evaluateCompliance } = require("../rules/index.js");
const { recognizeToBlocks } = require("../ocr/index.js");

const app = express();

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "http://localhost:5173");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});
const port = process.env.PORT || 5000;

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post(
  "/analyze",
  express.raw({
    type: ["image/jpeg", "image/png", "image/webp"],
    limit: "10mb",
  }),
  async (req, res) => {
    try {
      // 1. Check that an image was actually sent
      if (!req.body || !Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({
          error: "No image provided",
        });
      }

      // 2. Run OCR on the uploaded image
      const ocrBlocks = await recognizeToBlocks(req.body);

      // 3. Convert OCR text into the five declarations
      const declarations = extractDeclarations(ocrBlocks);

      // 4. Run the rules engine
      const compliance = evaluateCompliance(declarations);

      // 5. Return the compliance result + OCR data
      return res.json({
        ...compliance,
        ocr: ocrBlocks,
      });
    } catch (error) {
      console.error("Analysis failed:", error);

      return res.status(500).json({
        error: "Analysis could not be completed",
      });
    }
  },
);

app.listen(port, () => {
  console.log(`Backend listening on port ${port}`);
});
