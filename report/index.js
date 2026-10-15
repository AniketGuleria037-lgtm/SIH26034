"use strict";

/**
 * Compliance report generation.
 *
 * Two outputs, because they are used in different places:
 *
 *   buildReportHtml()  A self-contained HTML document. No external fonts, no
 *                      stylesheet, no script. Opens anywhere, prints to PDF from
 *                      any browser, and can be emailed as-is. This is the
 *                      offline-safe path and the one the demo should rely on.
 *
 *   buildReportPdf()   A real PDF via pdfkit, for when a file has to be filed
 *                      rather than read. Optional dependency: if pdfkit is not
 *                      installed the caller gets a clear error instead of a
 *                      stack trace, and the HTML path still works.
 *
 * Both carry the same standing advisory. A report produced by screening software
 * is a record of what the software saw, not a finding of law, and saying so on
 * the artefact itself is the difference between a useful tool and a liability.
 */

const STATUS_WORDS = {
  PASS: "Cleared",
  REVIEW: "Needs review",
  MISSING: "Not found",
  FAIL: "Does not meet format",
};

const VERDICT_WORDS = {
  COMPLIANT: "Declarations complete",
  NEEDS_REVIEW: "Needs human review",
  NON_COMPLIANT: "Non-compliant on screening",
  INCONCLUSIVE: "Inconclusive — evidence unusable",
};

function escapeHtml(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function percent(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${(value * 100).toFixed(1)}%`
    : "n/a";
}

function formatTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function normalizeContext(context = {}) {
  return {
    inspectionId: context.inspectionId || "UNASSIGNED",
    inspector: context.inspector || "Unattributed",
    role: context.role || "Field inspector",
    product: context.product || "Unidentified package",
    imageName: context.imageName || null,
    imageBytes: typeof context.imageBytes === "number" ? context.imageBytes : null,
    generatedAt: formatTimestamp(context.generatedAt),
  };
}

/* ------------------------------- HTML ------------------------------- */

function buildReportHtml(screening, context = {}) {
  if (!screening || !Array.isArray(screening.declarations)) {
    throw new TypeError("buildReportHtml expects a screening result");
  }

  const ctx = normalizeContext(context);
  const verdict = screening.verdict || {};

  const rows = screening.declarations
    .map(
      (d) => `
        <tr>
          <td class="mono">${escapeHtml(d.id)}</td>
          <td>
            <strong>${escapeHtml(d.label)}</strong>
            <div class="muted">${escapeHtml(d.requirement || "")}</div>
          </td>
          <td class="mono">${escapeHtml(d.value === null ? "—" : d.value)}</td>
          <td class="mono">${escapeHtml(d.citation || "—")}</td>
          <td><span class="pill pill-${escapeHtml(String(d.status).toLowerCase())}">${escapeHtml(
            STATUS_WORDS[d.status] || d.status,
          )}</span></td>
        </tr>`,
    )
    .join("");

  const findings = screening.findings.length
    ? screening.findings
        .map(
          (f) => `
          <li>
            <div class="finding-head">
              <strong>${escapeHtml(f.title)}</strong>
              <span class="mono muted">${escapeHtml(f.id)}${
                f.code ? ` &middot; ${escapeHtml(f.code)}` : ""
              }</span>
            </div>
            <p>${escapeHtml(f.detail)}</p>
          </li>`,
        )
        .join("")
    : `<li><p>No findings were raised on screening.</p></li>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Screening report ${escapeHtml(ctx.inspectionId)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 40px;
    font: 15px/1.55 "Helvetica Neue", Helvetica, Arial, sans-serif;
    color: #1c2724; background: #fff;
  }
  .sheet { max-width: 820px; margin: 0 auto; }
  .mono { font-family: "SFMono-Regular", Menlo, Consolas, monospace; font-size: 13px; }
  .muted { color: #6b756f; font-size: 13px; }
  header { border-bottom: 2px solid #1c2724; padding-bottom: 18px; }
  h1 { margin: 4px 0 6px; font-size: 26px; letter-spacing: -0.01em; }
  h2 { font-size: 15px; text-transform: uppercase; letter-spacing: 0.09em;
       margin: 34px 0 12px; color: #6b756f; }
  .meta { display: flex; flex-wrap: wrap; gap: 10px 34px; margin-top: 14px; }
  .meta div { min-width: 150px; }
  .meta dt { font-size: 11px; text-transform: uppercase; letter-spacing: 0.09em; color: #6b756f; }
  .meta dd { margin: 2px 0 0; font-weight: 600; }
  .verdict { border: 1px solid #e3ddd0; background: #fcf3e1; padding: 18px 20px; margin-top: 24px; }
  .verdict h3 { margin: 6px 0 8px; font-size: 21px; }
  .stats { display: flex; gap: 28px; margin-top: 14px; }
  .stats div { border-left: 3px solid #d5552a; padding-left: 12px; }
  .stats strong { display: block; font-size: 20px; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em;
       color: #6b756f; border-bottom: 1px solid #1c2724; padding: 0 8px 8px 0; }
  td { padding: 12px 8px 12px 0; border-bottom: 1px solid #ece7dc; vertical-align: top; }
  .pill { display: inline-block; padding: 3px 10px; border-radius: 999px;
          font-size: 12px; font-weight: 600; white-space: nowrap; }
  .pill-pass { background: #dcede0; color: #2e6b4c; }
  .pill-review { background: #f8d9cc; color: #a83a19; }
  .pill-missing { background: #f3e4a9; color: #7a5d10; }
  .pill-fail { background: #f8d9cc; color: #a83a19; }
  ol { padding-left: 0; list-style: none; margin: 0; }
  ol li { border-left: 3px solid #d5552a; padding: 0 0 0 14px; margin-bottom: 16px; }
  .finding-head { display: flex; justify-content: space-between; gap: 16px; align-items: baseline; }
  ol li p { margin: 4px 0 0; color: #38423e; }
  footer { margin-top: 38px; padding-top: 16px; border-top: 1px solid #e3ddd0; }
  .advisory { background: #f3f0e8; border-left: 3px solid #1c2724; padding: 12px 16px; margin-top: 22px; }
  @media print { body { padding: 0; } .sheet { max-width: none; } }
</style>
</head>
<body>
<div class="sheet">
  <header>
    <div class="mono muted">SCREENING REPORT &middot; ${escapeHtml(ctx.inspectionId)}</div>
    <h1>${escapeHtml(ctx.product)}</h1>
    <div class="muted">${escapeHtml(screening.regulation || "")}</div>
    <dl class="meta">
      <div><dt>Inspector</dt><dd>${escapeHtml(ctx.inspector)}</dd></div>
      <div><dt>Role</dt><dd>${escapeHtml(ctx.role)}</dd></div>
      <div><dt>Generated</dt><dd class="mono">${escapeHtml(ctx.generatedAt)}</dd></div>
      <div><dt>Evidence</dt><dd class="mono">${escapeHtml(ctx.imageName || "—")}</dd></div>
    </dl>
  </header>

  <div class="verdict">
    <div class="mono muted">SCREENING VERDICT &middot; ${escapeHtml(
      VERDICT_WORDS[verdict.status] || verdict.status || "—",
    )}</div>
    <h3>${escapeHtml(verdict.headline || "")}</h3>
    <p style="margin:0">${escapeHtml(verdict.detail || "")}</p>
    <div class="stats">
      <div>
        <strong>${escapeHtml(verdict.checks_passed)} / ${escapeHtml(verdict.checks_total)}</strong>
        <span class="muted">Checks cleared</span>
      </div>
      <div>
        <strong>${escapeHtml(percent(verdict.evidence_confidence))}</strong>
        <span class="muted">Evidence confidence</span>
      </div>
    </div>
  </div>

  <h2>Required declarations</h2>
  <table>
    <thead>
      <tr><th>ID</th><th>Declaration</th><th>Read value</th><th>Reference</th><th>Outcome</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <h2>Findings</h2>
  <ol>${findings}</ol>

  <div class="advisory">
    <strong>Advisory.</strong> ${escapeHtml(screening.advisory || "")}
    Reference clauses are screening aids and must be verified against the
    notified text of the ${escapeHtml(screening.regulation || "applicable rules")}
    before this report is relied on.
  </div>

  <footer class="mono muted">
    Rules catalogue ${escapeHtml(screening.catalog_version || "—")} &middot;
    Generated by PackCheck screening software &middot; Not a finding of law
  </footer>
</div>
</body>
</html>`;
}

/* -------------------------------- PDF -------------------------------- */

function loadPdfKit() {
  try {
    return require("pdfkit");
  } catch (_) {
    throw new Error(
      "PDF output needs pdfkit. Run `npm install` in report/, or use buildReportHtml() and print to PDF.",
    );
  }
}

/**
 * @returns {Promise<Buffer>} the finished PDF
 */
function buildReportPdf(screening, context = {}) {
  if (!screening || !Array.isArray(screening.declarations)) {
    throw new TypeError("buildReportPdf expects a screening result");
  }

  const PDFDocument = loadPdfKit();
  const ctx = normalizeContext(context);
  const verdict = screening.verdict || {};

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 54 });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const ink = "#1c2724";
    const muted = "#6b756f";
    const flag = "#d5552a";
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    doc.font("Courier").fontSize(9).fillColor(muted);
    doc.text(`SCREENING REPORT  ${ctx.inspectionId}`);
    doc.moveDown(0.4);
    doc.font("Helvetica-Bold").fontSize(20).fillColor(ink).text(ctx.product);
    doc.font("Helvetica").fontSize(9).fillColor(muted).text(screening.regulation || "");
    doc.moveDown(0.7);

    doc
      .moveTo(doc.x, doc.y)
      .lineTo(doc.x + width, doc.y)
      .lineWidth(1.4)
      .strokeColor(ink)
      .stroke();
    doc.moveDown(0.9);

    const metaLine = [
      `Inspector: ${ctx.inspector} (${ctx.role})`,
      `Generated: ${ctx.generatedAt}`,
      `Evidence: ${ctx.imageName || "—"}`,
    ].join("    ");
    doc.font("Courier").fontSize(8.5).fillColor(muted).text(metaLine, { width });
    doc.moveDown(1.1);

    // Verdict block
    doc.font("Courier").fontSize(8.5).fillColor(flag);
    doc.text(`SCREENING VERDICT — ${VERDICT_WORDS[verdict.status] || verdict.status || "—"}`);
    doc.moveDown(0.3);
    doc.font("Helvetica-Bold").fontSize(15).fillColor(ink).text(verdict.headline || "");
    doc.moveDown(0.2);
    doc.font("Helvetica").fontSize(10).fillColor("#38423e").text(verdict.detail || "", { width });
    doc.moveDown(0.5);
    doc
      .font("Courier")
      .fontSize(9)
      .fillColor(ink)
      .text(
        `Checks cleared ${verdict.checks_passed}/${verdict.checks_total}     ` +
          `Evidence confidence ${percent(verdict.evidence_confidence)}`,
      );
    doc.moveDown(1.2);

    // Declarations
    doc.font("Helvetica-Bold").fontSize(9).fillColor(muted).text("REQUIRED DECLARATIONS");
    doc.moveDown(0.5);

    for (const d of screening.declarations) {
      const top = doc.y;
      doc.font("Courier").fontSize(8.5).fillColor(muted).text(d.id, { continued: false });
      doc.font("Helvetica-Bold").fontSize(11).fillColor(ink).text(d.label, doc.x + 8, top + 11, {
        width: width - 140,
      });
      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor("#38423e")
        .text(d.note || "", { width: width - 140 });
      doc
        .font("Courier")
        .fontSize(9)
        .fillColor(ink)
        .text(
          `${d.value === null ? "—" : d.value}    ${STATUS_WORDS[d.status] || d.status}    ${
            d.citation || ""
          }`,
        );
      doc.x = doc.page.margins.left;
      doc.moveDown(0.35);
      doc
        .moveTo(doc.x, doc.y)
        .lineTo(doc.x + width, doc.y)
        .lineWidth(0.5)
        .strokeColor("#ece7dc")
        .stroke();
      doc.moveDown(0.6);
    }

    // Findings
    if (screening.findings.length) {
      doc.moveDown(0.4);
      doc.font("Helvetica-Bold").fontSize(9).fillColor(muted).text("FINDINGS");
      doc.moveDown(0.5);

      for (const f of screening.findings) {
        doc.font("Helvetica-Bold").fontSize(10.5).fillColor(ink).text(f.title);
        doc.font("Helvetica").fontSize(9.5).fillColor("#38423e").text(f.detail, { width });
        doc
          .font("Courier")
          .fontSize(8)
          .fillColor(muted)
          .text([f.id, f.code, f.citation].filter(Boolean).join("  ·  "));
        doc.moveDown(0.65);
      }
    }

    doc.moveDown(0.6);
    doc.font("Helvetica-Oblique").fontSize(9).fillColor(ink);
    doc.text(
      `${screening.advisory || ""} Reference clauses are screening aids and must be ` +
        `verified against the notified text before this report is relied on.`,
      { width },
    );
    doc.moveDown(0.7);
    doc
      .font("Courier")
      .fontSize(7.5)
      .fillColor(muted)
      .text(
        `Rules catalogue ${screening.catalog_version || "—"}  ·  ` +
          `Generated by PackCheck screening software  ·  Not a finding of law`,
      );

    doc.end();
  });
}

function reportFilename(context = {}, extension = "pdf") {
  const id = String(context.inspectionId || "report").replace(/[^\w-]+/g, "-");
  return `packcheck-${id.toLowerCase()}.${extension}`;
}

module.exports = { buildReportHtml, buildReportPdf, reportFilename };
