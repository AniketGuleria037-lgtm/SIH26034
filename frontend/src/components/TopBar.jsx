import { BellIcon, DownloadIcon, HelpIcon } from "./Icons.jsx";

/*
 * The top bar carries the connection state, which is load-bearing rather than
 * decorative: the recogniser runs in the backend, so an inspector who does not
 * know the backend is down will read an error as a problem with the pack. The
 * three states are named in plain words for that reason.
 */

const CONNECTION = {
  connected: { state: "online", label: "Backend connected" },
  warming: { state: "busy", label: "Recogniser warming up" },
  offline: { state: "offline", label: "Backend not reachable" },
};

export default function TopBar({ leaf, connection, onGenerateReport, canReport, onShowHelp }) {
  const link = CONNECTION[connection] || CONNECTION.offline;

  return (
    <header className="topbar">
      <div className="crumbs">
        <span className="tag">Field workbench</span>
        <span className="tag sep">/</span>
        <span className="tag leaf">{leaf}</span>
      </div>

      <p className="local-state">
        <span className="dot" data-state={link.state} />
        {link.label}
      </p>

      <button type="button" className="icon-button" onClick={onShowHelp} aria-label="How screening works">
        <HelpIcon />
      </button>

      <button type="button" className="icon-button" aria-label="Notifications" disabled>
        <BellIcon />
      </button>

      <button
        type="button"
        className="button button-quiet"
        onClick={onGenerateReport}
        disabled={!canReport}
      >
        <DownloadIcon />
        Report
      </button>
    </header>
  );
}
