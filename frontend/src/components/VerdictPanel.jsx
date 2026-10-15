import { FileIcon, InfoIcon } from "./Icons.jsx";

/*
 * The screening verdict.
 *
 * Everything here is arranged to stop the inspector reading it as a decision.
 * The pill states what the screening found, the heading states what the
 * inspector should do next, and the standing advisory sits between the findings
 * and the action rather than under it, so it cannot be scrolled past on the way
 * to the button.
 */

const PILL_WORDS = {
  COMPLIANT: "Compliant",
  NEEDS_REVIEW: "Needs review",
  NON_COMPLIANT: "Non-compliant",
  INCONCLUSIVE: "Inconclusive",
};

function confidenceLabel(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${(value * 100).toFixed(1)}%`
    : "n/a";
}

export default function VerdictPanel({
  verdict,
  findings,
  advisory,
  selectedField,
  onSelectField,
  onGenerateReport,
  reportState,
  isDemo,
}) {
  const allClear = verdict.checks_passed === verdict.checks_total;

  return (
    <section className="verdict" data-status={verdict.status} aria-label="Screening verdict">
      <header className="verdict-head">
        <div className="verdict-top">
          <p className="tag">Screening verdict</p>
          <span className="status-pill" data-status={verdict.status}>
            {PILL_WORDS[verdict.status] || verdict.status}
          </span>
        </div>
        <h3>{verdict.headline}</h3>
        <p>{verdict.detail}</p>
      </header>

      <div className="stats">
        <div className="stat" data-tone={allClear ? "pass" : "flag"}>
          <p className="tag">Checks cleared</p>
          <strong>
            {verdict.checks_passed} / {verdict.checks_total}
          </strong>
        </div>
        <div className="stat" data-tone="flag">
          <p className="tag">Evidence confidence</p>
          <strong>{confidenceLabel(verdict.evidence_confidence)}</strong>
        </div>
      </div>

      <div className="findings">
        <div className="findings-head">
          <h4>{findings.length ? "Why it was flagged" : "Nothing was flagged"}</h4>
          <span className="mono">
            {findings.length} {findings.length === 1 ? "finding" : "findings"}
          </span>
        </div>

        {findings.length === 0 ? (
          <p className="decl-note">
            All required declarations were read from this frame. Confirm them against the
            physical pack before clearing it.
          </p>
        ) : (
          <ol>
            {findings.map((finding) => (
              <li key={`${finding.id}-${finding.code}`}>
                {/* Clickable, because the next move is always to look at the
                    pixels the finding came from. */}
                <button
                  type="button"
                  className="finding"
                  data-severity={finding.severity}
                  data-selected={finding.field === selectedField}
                  onClick={() => finding.field && onSelectField(finding.field)}
                  disabled={!finding.field}
                >
                  <strong>{finding.title}</strong>
                  <p>{finding.detail}</p>
                  <span className="finding-ref">
                    <span className="tag">
                      {[finding.id, finding.code].filter(Boolean).join(" · ")}
                    </span>
                    {finding.citation && <span className="finding-cite">{finding.citation}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>

      <p className="advisory">
        <InfoIcon width={16} height={16} />
        <span>{advisory}</span>
      </p>

      <div className="verdict-actions">
        <button
          type="button"
          className="button button-primary button-block"
          onClick={onGenerateReport}
          disabled={reportState === "working"}
        >
          <FileIcon />
          {reportState === "working" ? "Generating report…" : "Generate review report"}
        </button>
        {isDemo && <p className="tag">Demo inspection · report is a worked example</p>}
      </div>
    </section>
  );
}
