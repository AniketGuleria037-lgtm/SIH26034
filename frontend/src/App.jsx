import { useCallback, useEffect, useMemo, useState } from "react";

import Sidebar from "./components/Sidebar.jsx";
import TopBar from "./components/TopBar.jsx";
import EvidenceFrame from "./components/EvidenceFrame.jsx";
import VerdictPanel from "./components/VerdictPanel.jsx";
import { DeclarationTable, ThresholdTable } from "./components/DeclarationTable.jsx";
import {
  DecisionBar,
  NewInspectionView,
  ReferenceRulesView,
  ReviewQueueView,
} from "./components/Views.jsx";
import { InfoIcon } from "./components/Icons.jsx";

import { analyze, downloadReport, fetchCatalog, fetchHealth, validateFile } from "./api.js";
import { demoInspection, fallbackCatalog } from "./demo.js";

/*
 * The inspector is hardcoded for now.
 *
 * There is no auth in this build, and inventing a login screen would imply one
 * exists. The name is here because the generated report needs an attribution
 * line, and an unattributed compliance report is not worth much.
 */
const INSPECTOR = { name: "Asha Rao", role: "Field inspector · North zone" };

const QUEUE_KEY = "packcheck.queue.v1";

/*
 * Local decision history.
 *
 * Field work happens where the signal does not, so decisions are kept on the
 * device rather than posted to a server that may be unreachable. A corrupt or
 * absent store must never take the screen down with it, hence the guards.
 */
function loadQueue() {
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function saveQueue(entries) {
  try {
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(entries));
  } catch (_) {
    /* a full or blocked store is not worth interrupting the inspection for */
  }
}

const HELP_TEXT =
  "PackCheck reads one photograph, matches what it finds against the five declarations " +
  "required by the 2011 Rules, and tells you which ones need your eyes. It does not decide " +
  "compliance: a low-confidence reading is sent for review rather than failed, and an " +
  "unreadable frame is reported as unreadable rather than as five missing declarations.";

export default function App() {
  const [view, setView] = useState("inspection");
  const [result, setResult] = useState(demoInspection);
  const [selectedField, setSelectedField] = useState("mrp");
  const [tab, setTab] = useState("overview");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [reportState, setReportState] = useState("idle");

  const [connection, setConnection] = useState("offline");
  const [catalog, setCatalog] = useState(null);
  const [queue, setQueue] = useState(loadQueue);
  const [recordedIds, setRecordedIds] = useState(() => new Set());

  const isDemo = result?.is_demo === true;

  /* Backend state, polled gently. The indicator is only useful if it keeps up
     with a backend that was started after the page was opened. */
  useEffect(() => {
    let live = true;

    async function probe() {
      const health = await fetchHealth();
      if (!live) return;
      if (!health) setConnection("offline");
      else setConnection(health.ocr?.warm ? "connected" : "warming");
    }

    probe();
    const timer = setInterval(probe, 15000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  /* The catalogue is fetched once the backend answers, so the reference screen
     shows the rules the engine is actually applying rather than a stale copy. */
  useEffect(() => {
    if (connection === "offline" || catalog) return;
    let live = true;
    fetchCatalog()
      .then((data) => live && setCatalog(data))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [connection, catalog]);

  useEffect(() => saveQueue(queue), [queue]);

  /* Release the object URL for an uploaded frame when it is replaced, or the
     page leaks a full-resolution photograph per inspection. */
  useEffect(() => {
    const url = result?.inspection?.image?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [result?.inspection?.image?.url]);

  const reportContext = useMemo(
    () => ({
      inspectionId: result?.inspection?.id,
      inspector: INSPECTOR.name,
      role: INSPECTOR.role,
      product: result?.inspection?.product || result?.inspection?.image?.name,
      imageName: result?.inspection?.image?.name,
      imageBytes: result?.inspection?.image?.bytes,
      generatedAt: new Date().toISOString(),
    }),
    [result],
  );

  const handleUpload = useCallback(async (file) => {
    const invalid = validateFile(file);
    if (invalid) {
      setError(invalid);
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const data = await analyze(file, { product: file.name.replace(/\.[^.]+$/, "") });

      // The API returns dimensions and a name but obviously not the pixels, so
      // a local object URL is attached for the evidence frame to render.
      data.inspection.image.url = URL.createObjectURL(file);
      data.inspection.product = data.inspection.product || file.name;

      setResult(data);
      setSelectedField(
        (data.findings.find((f) => f.field) || data.declarations[0] || {}).field || null,
      );
      setTab("overview");
      setView("inspection");

      if (data.verdict.status === "INCONCLUSIVE") {
        setNotice(
          "The recogniser could not read this frame well enough to screen it. Nothing below should be read as a missing declaration.",
        );
      }
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setBusy(false);
    }
  }, []);

  const handleReport = useCallback(async () => {
    if (!result) return;
    setReportState("working");
    setError(null);

    try {
      const kind = await downloadReport(
        {
          regulation: result.regulation,
          catalog_version: result.catalog_version,
          verdict: result.verdict,
          declarations: result.declarations,
          findings: result.findings,
          advisory: result.advisory,
        },
        reportContext,
      );

      setNotice(
        kind === "pdf"
          ? "Report downloaded."
          : "pdfkit is not installed in report/, so the report opened as printable HTML instead.",
      );
    } catch (reportError) {
      setError(reportError.message);
    } finally {
      setReportState("idle");
    }
  }, [result, reportContext]);

  const handleRecord = useCallback(
    (decision) => {
      if (!result || isDemo) return;

      const entry = {
        recordedAt: new Date().toISOString(),
        decision,
        inspection: result.inspection,
        verdict: result.verdict,
        declarations: result.declarations,
        findings: result.findings,
        regulation: result.regulation,
        catalog_version: result.catalog_version,
        advisory: result.advisory,
      };

      setQueue((current) => [entry, ...current].slice(0, 100));
      setRecordedIds((current) => new Set(current).add(result.inspection.id));
      setNotice(
        decision === "cleared"
          ? "Recorded as cleared and added to the review queue."
          : "Flagged for action and added to the review queue.",
      );
    },
    [result, isDemo],
  );

  const startNewInspection = useCallback(() => {
    setResult(null);
    setError(null);
    setNotice(null);
    setView("inspection");
  }, []);

  const openQueueEntry = useCallback((entry) => {
    // A recorded entry has no pixels: the photograph was never uploaded
    // anywhere. The evidence frame handles a missing image, and the boxes are
    // still meaningful against the stored coordinates.
    setResult({ ...entry, ocr: { meta: {} } });
    setSelectedField((entry.declarations[0] || {}).field || null);
    setRecordedIds((current) => new Set(current).add(entry.inspection.id));
    setTab("overview");
    setView("inspection");
  }, []);

  const activeCatalog = catalog || fallbackCatalog;
  const recorded = result ? recordedIds.has(result.inspection?.id) : false;

  const crumb =
    view === "queue"
      ? "Review queue"
      : view === "rules"
        ? "Reference rules"
        : result
          ? `Inspection ${result.inspection.id}`
          : "New inspection";

  return (
    <div className="shell">
      <Sidebar
        view={view}
        onChangeView={setView}
        counts={{ inspection: result ? 1 : 0, queue: queue.length }}
        inspector={INSPECTOR}
        onNewInspection={startNewInspection}
      />

      <div className="workspace">
        <TopBar
          leaf={crumb}
          connection={connection}
          onGenerateReport={handleReport}
          canReport={Boolean(result) && reportState !== "working"}
          onShowHelp={() => setNotice(HELP_TEXT)}
        />

        {view === "queue" && (
          <ReviewQueueView
            entries={queue}
            onOpen={openQueueEntry}
            onStartInspection={() => setView("inspection")}
            onClear={() => setQueue([])}
          />
        )}

        {view === "rules" && <ReferenceRulesView catalog={activeCatalog} isFallback={!catalog} />}

        {view === "inspection" && !result && (
          <NewInspectionView
            onSelectFile={handleUpload}
            busy={busy}
            error={error}
            onDismissError={() => setError(null)}
          />
        )}

        {view === "inspection" && result && (
          <div className="page">
            <div className="page-head">
              <div className="page-head-text">
                <p className="eyebrow">
                  Inspection {result.inspection.id} ·{" "}
                  {new Date(result.inspection.created_at).toLocaleDateString(undefined, {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })}
                  {isDemo && " · demo"}
                </p>
                <h2>Package assessment</h2>
                <p className="page-lede">
                  A focused read of the declarations on one packaged commodity. Scan the
                  evidence, understand the flags, then make the call.
                </p>
              </div>
              <button type="button" className="button button-primary" onClick={startNewInspection}>
                New inspection
              </button>
            </div>

            {(error || notice) && (
              <p className="alert" role="status">
                <InfoIcon width={16} height={16} />
                <span>{error || notice}</span>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setNotice(null);
                  }}
                >
                  Dismiss
                </button>
              </p>
            )}

            <div className="assessment">
              <EvidenceFrame
                inspection={result.inspection}
                declarations={result.declarations}
                selectedField={selectedField}
                onSelectField={setSelectedField}
                isDemo={isDemo}
              />

              <VerdictPanel
                verdict={result.verdict}
                findings={result.findings}
                advisory={result.advisory}
                selectedField={selectedField}
                onSelectField={setSelectedField}
                onGenerateReport={handleReport}
                reportState={reportState}
                isDemo={isDemo}
              />
            </div>

            <div className="tabs-row" role="tablist" aria-label="Assessment detail">
              <button
                type="button"
                role="tab"
                className="tab"
                aria-selected={tab === "overview"}
                onClick={() => setTab("overview")}
              >
                Overview
              </button>
              <button
                type="button"
                role="tab"
                className="tab"
                aria-selected={tab === "rules"}
                onClick={() => setTab("rules")}
              >
                Rules &amp; thresholds
              </button>
              <span className="mono">
                {selectedField
                  ? `Selected: ${
                      result.declarations.find((d) => d.field === selectedField)?.short_label ||
                      selectedField
                    }`
                  : "Nothing selected"}
              </span>
            </div>

            {tab === "overview" ? (
              <DeclarationTable
                declarations={result.declarations}
                selectedField={selectedField}
                onSelectField={setSelectedField}
              />
            ) : (
              <ThresholdTable declarations={result.declarations} catalog={activeCatalog} />
            )}

            <DecisionBar isDemo={isDemo} onRecord={handleRecord} recorded={recorded} />
          </div>
        )}
      </div>
    </div>
  );
}
