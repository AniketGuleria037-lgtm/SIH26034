const OUTCOME_WORDS = {
  PASS: "Pass",
  REVIEW: "Review",
  MISSING: "Missing",
  FAIL: "Format",
};

/*
 * The declaration table.
 *
 * Each row is a button rather than a table row, because selecting it moves the
 * overlay on the evidence frame — it is a control, and it should announce
 * itself as one. The declaration number and the rule citation travel with every
 * row so a screenshot of this table is enough to justify a decision later.
 *
 * The read value is monospaced and right-aligned. Five values in a column with
 * their decimal points lined up are scannable in a way five values in prose are
 * not, and an inspector is comparing them against a pack in their other hand.
 */
export function DeclarationTable({ declarations, selectedField, onSelectField }) {
  const mapped = declarations.filter((d) => d.value !== null).length;

  return (
    <section className="panel" aria-label="Required declarations">
      <header className="panel-head">
        <div className="panel-head-text">
          <p className="tag">Required declarations</p>
          <h3>Detected on package</h3>
        </div>
        <span className="pill-count">
          {mapped} of {declarations.length} read
        </span>
      </header>

      <div>
        {declarations.map((declaration) => {
          const selected = declaration.field === selectedField;
          return (
            <button
              type="button"
              key={declaration.id}
              className="decl-row"
              data-outcome={declaration.status}
              data-selected={selected}
              aria-pressed={selected}
              onClick={() => onSelectField(declaration.field)}
            >
              <span className="decl-id">{declaration.id.replace("DECL-", "")}</span>

              <span>
                <span className="decl-name">{declaration.label}</span>
                <span className="decl-cite">{declaration.citation}</span>
              </span>

              <span className="decl-note">{declaration.note}</span>

              <span className="decl-value" data-empty={declaration.value === null}>
                {declaration.value === null ? "Not found" : declaration.value}
              </span>

              <span className="outcome" data-outcome={declaration.status}>
                {OUTCOME_WORDS[declaration.status] || declaration.status}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/*
 * Rules and thresholds.
 *
 * This tab exists so the inspector can answer "why did it say that" without
 * reading the source. Every number the screening engine used to reach an
 * outcome is shown here, including the confidence floor below which a reading is
 * sent for review rather than passed.
 */
export function ThresholdTable({ declarations, catalog }) {
  const entries = catalog?.declarations || declarations;

  return (
    <section className="panel" aria-label="Rules and thresholds">
      <header className="panel-head">
        <div className="panel-head-text">
          <p className="tag">Screening rules</p>
          <h3>What each check looks for</h3>
        </div>
        <span className="pill-count">Catalogue {catalog?.version || "—"}</span>
      </header>

      <div className="rules-list">
        {entries.map((entry) => {
          const live = declarations.find((d) => d.field === entry.field);

          return (
            <article className="rule-entry" key={entry.id}>
              <span className="decl-id">{entry.id.replace("DECL-", "")}</span>

              <div>
                <h4>{entry.label}</h4>
                <p className="requirement">{entry.requirement}</p>
                <p className="decl-cite">{entry.citation}</p>
              </div>

              <dl className="thresholds">
                <div className="threshold">
                  <dt>Expected form</dt>
                  <dd>{entry.format_hint || "Any legible text"}</dd>
                </div>
                <div className="threshold">
                  <dt>Review below</dt>
                  <dd>
                    {typeof entry.min_confidence === "number"
                      ? `${Math.round(entry.min_confidence * 100)}% confidence`
                      : "—"}
                  </dd>
                </div>
                {live && (
                  <div className="threshold">
                    <dt>This frame</dt>
                    <dd>
                      {typeof live.confidence === "number"
                        ? `${Math.round(live.confidence * 100)}% · ${live.status}`
                        : live.status}
                    </dd>
                  </div>
                )}
              </dl>
            </article>
          );
        })}
      </div>
    </section>
  );
}
