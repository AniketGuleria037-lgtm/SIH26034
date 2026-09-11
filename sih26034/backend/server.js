const express = require("express");
const { extractDeclarations } = require("../extraction/index.js");
const { evaluateCompliance } = require("../rules/index.js");

const app = express();
const port = process.env.PORT || 5000;

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/analyze", (req, res) => {
  const fakeOcrData = [
    { text: "MRP Rs. 50", box: [120, 300, 250, 340], confidence: 0.94 },
    { text: "Net Weight 200 g", box: [110, 350, 290, 390], confidence: 0.88 },
    {
      text: "Manufactured by ABC Foods Pvt Ltd",
      box: [90, 400, 300, 430],
      confidence: 0.91,
    },
    { text: "Packed 08/2026", box: [90, 440, 200, 465], confidence: 0.89 },
  ];

  try {
    const declarations = extractDeclarations(fakeOcrData);
    const compliance = evaluateCompliance(declarations);
    res.json(compliance);
  } catch (error) {
    console.error("Analysis failed:", error.message);
    res.status(500).json({ error: "Analysis could not be completed" });
  }
});

app.listen(port, () => {
  console.log(`Backend listening on port ${port}`);
});
