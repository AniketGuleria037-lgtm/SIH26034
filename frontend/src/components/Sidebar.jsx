import { BookIcon, PlusIcon, QueueIcon, ScanIcon } from "./Icons.jsx";

const NAV = [
  { id: "inspection", label: "Active inspection", Icon: ScanIcon },
  { id: "queue", label: "Review queue", Icon: QueueIcon },
  { id: "rules", label: "Reference rules", Icon: BookIcon },
];

function initials(name) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || "")
    .join("")
    .toUpperCase();
}

export default function Sidebar({ view, onChangeView, counts, inspector, onNewInspection }) {
  return (
    <nav className="sidebar" aria-label="Workspace">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <ScanIcon width={21} height={21} />
        </span>
        <div>
          <h1>PackCheck</h1>
          <p className="tag">Inspector workspace</p>
        </div>
      </div>

      <div className="nav">
        <p className="tag" id="nav-heading">
          Workspace
        </p>
        {NAV.map(({ id, label, Icon }) => (
          <button
            type="button"
            key={id}
            className="nav-item"
            aria-current={view === id ? "page" : undefined}
            onClick={() => onChangeView(id)}
          >
            <Icon />
            <span>{label}</span>
            {counts[id] !== undefined && (
              <span className="nav-count" aria-hidden="true">
                {String(counts[id]).padStart(2, "0")}
              </span>
            )}
            {counts[id] !== undefined && (
              <span className="visually-hidden">{counts[id]} items</span>
            )}
          </button>
        ))}
      </div>

      <div className="sidebar-foot">
        <hr />
        <p className="tag">Signed in as</p>
        <div className="who">
          <span className="who-avatar" aria-hidden="true">
            {initials(inspector.name)}
          </span>
          <div>
            <p className="who-name">{inspector.name}</p>
            <p className="who-role">{inspector.role}</p>
          </div>
        </div>
        <button type="button" className="sidebar-action" onClick={onNewInspection}>
          <PlusIcon />
          <span>New inspection</span>
        </button>
      </div>
    </nav>
  );
}
