import { useRef, useState } from "react";
import { CameraIcon, ChevronIcon, InfoIcon, QueueIcon, ScanIcon } from "./Icons.jsx";
import { ACCEPTED_TYPES } from "../api.js";

/* =========================== new inspection =========================== */

/*
 * The dropzone.
 *
 * Copy here does real work. An inspector's first photograph is usually taken at
 * an angle in bad shop lighting, and that single fact accounts for most
 * unreadable frames. Telling them to shoot square-on with the panel filling the
 * frame, before they shoot, prevents more failures than any amount of
 * preprocessing recovers from afterwards.
 */
export function NewInspectionView({ onSelectFile, busy, error, onDismissError }) {
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);

  function handleFiles(fileList) {
    const file = fileList && fileList[0];
    if (file) onSelectFile(file);
  }

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-head-text">
          <p className="eyebrow">New inspection</p>
          <h2>Photograph the panel</h2>
          <p className="page-lede">
            The recogniser reads the declarations off a single frame, so the frame decides how
            much it can find.
          </p>
        </div>
      </div>

      {error && (
        <p className="alert" role="alert">
          <InfoIcon width={16} height={16} />
          <span>{error}</span>
          <button type="button" onClick={onDismissError}>
            Dismiss
          </button>
        </p>
      )}

      <div
        className="dropzone"
        data-over={over}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          handleFiles(event.dataTransfer.files);
        }}
      >
        <span className="dropzone-mark" aria-hidden="true">
          <CameraIcon width={26} height={26} />
        </span>

        <h3>Add the evidence frame</h3>
        <p>
          Shoot the declaration panel square-on, filling the frame, with even light and no
          glare across the printed text. Drop the photograph here or choose a file.
        </p>

        <button
          type="button"
          className="button button-primary"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          {busy ? "Reading the frame…" : "Choose a photograph"}
        </button>

        <small>JPEG, PNG or WebP · up to 12 MB</small>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(",")}
          hidden
          onChange={(event) => {
            handleFiles(event.target.files);
            // Clearing the value lets the same file be chosen twice, which
            // matters when the first attempt failed and nothing else changed.
            event.target.value = "";
          }}
        />
      </div>

      {busy && (
        <p className="reading" role="status" style={{ marginTop: "1.125rem" }}>
          <span className="spinner" />
          Reading the frame. A difficult photograph is retried at several
          exposures and rotations, which can take a few seconds.
        </p>
      )}
    </div>
  );
}

/* ============================ review queue ============================ */

function formatWhen(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const DECISION_WORDS = {
  cleared: "Cleared",
  flagged: "Flagged",
};

export function ReviewQueueView({ entries, onOpen, onStartInspection, onClear }) {
  return (
    <div className="page">
      <div className="page-head">
        <div className="page-head-text">
          <p className="eyebrow">Review queue</p>
          <h2>Recorded decisions</h2>
          <p className="page-lede">
            Every decision you record on this device, kept locally so a patchy connection
            never loses your morning's work.
          </p>
        </div>
        {entries.length > 0 && (
          <button type="button" className="button button-quiet" onClick={onClear}>
            Clear local history
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="empty">
          <span className="empty-mark" aria-hidden="true">
            <QueueIcon width={26} height={26} />
          </span>
          <h3>Nothing recorded yet</h3>
          <p>
            Decisions appear here once you record them on an inspection. Start with the
            active inspection to walk the whole evidence flow.
          </p>
          <button type="button" className="button button-primary" onClick={onStartInspection}>
            <ScanIcon />
            Open active inspection
          </button>
        </div>
      ) : (
        <section className="panel" aria-label="Recorded decisions">
          {entries.map((entry) => (
            <button
              type="button"
              className="queue-row"
              key={entry.recordedAt}
              onClick={() => onOpen(entry)}
            >
              <span className="queue-meta">{entry.inspection.id}</span>
              <span className="queue-product">
                {entry.inspection.product || entry.inspection.image?.name || "Unidentified package"}
              </span>
              <span className="queue-meta queue-when">{formatWhen(entry.recordedAt)}</span>
              <span className="outcome" data-outcome={entry.decision === "cleared" ? "PASS" : "REVIEW"}>
                {DECISION_WORDS[entry.decision] || entry.decision}
              </span>
              <ChevronIcon />
            </button>
          ))}
        </section>
      )}
    </div>
  );
}

/* =========================== reference rules =========================== */

export function ReferenceRulesView({ catalog, isFallback }) {
  return (
    <div className="page">
      <div className="page-head">
        <div className="page-head-text">
          <p className="eyebrow">Reference rules</p>
          <h2>What must be declared</h2>
          <p className="page-lede">
            The five declarations this workspace screens for, drawn from{" "}
            {catalog.regulation}.
          </p>
        </div>
      </div>

      <section className="panel" aria-label="Declaration catalogue">
        <header className="panel-head">
          <div className="panel-head-text">
            <p className="tag">Catalogue {catalog.version}</p>
            <h3>Mandatory declarations</h3>
          </div>
          <span className="pill-count">{catalog.declarations.length} declarations</span>
        </header>

        <div className="rules-list">
          {catalog.declarations.map((entry) => (
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
              </dl>
            </article>
          ))}
        </div>
      </section>

      <p className="note-panel">
        {catalog.citation_note}
        {isFallback &&
          " This list is the copy bundled with the interface: the backend is not reachable, so it could not be refreshed from the live catalogue."}
      </p>
    </div>
  );
}

/* =========================== record a decision =========================== */

export function DecisionBar({ isDemo, onRecord, recorded }) {
  if (recorded) {
    return (
      <div className="decision">
        <div className="decision-text">
          <strong>Decision recorded</strong>
          <p>
            This inspection has moved to the review queue. Start a new inspection to screen
            another pack.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="decision">
      <div className="decision-text">
        <strong>Record your decision</strong>
        <p>
          {isDemo
            ? "This is a demonstration inspection, so no decision can be recorded against it. Upload a real frame to record one."
            : "The screening above is a suggestion. What you record here is the decision of record, and it is yours."}
        </p>
      </div>
      <div className="decision-buttons">
        <button
          type="button"
          className="button button-quiet"
          onClick={() => onRecord("cleared")}
          disabled={isDemo}
        >
          Clear this pack
        </button>
        <button
          type="button"
          className="button button-primary"
          onClick={() => onRecord("flagged")}
          disabled={isDemo}
        >
          Flag for action
        </button>
      </div>
    </div>
  );
}
