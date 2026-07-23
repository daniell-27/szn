import React from "react";
import Icon from "./Icon.jsx";

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function Sidebar({ user, history, activeRunId, onLoad, onDelete, onNew, onLogout }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="logo-mark" aria-hidden="true">szn<span className="logo-dot">.</span></div>
        <div>
          <div className="brand">SZN</div>
          <div className="brand-sub">back-of-the-envelope</div>
        </div>
      </div>

      <button className="btn btn-block btn-icon" onClick={onNew}><Icon name="plus" /> New analysis</button>

      <div className="sidebar-label">Run history</div>
      <div className="history-list">
        {history.length === 0 && <div className="empty">No runs yet.</div>}
        {history.map((run) => (
          <div
            key={run.id}
            className={"history-item" + (run.id === activeRunId ? " active" : "")}
            onClick={() => onLoad(run)}
          >
            <div className="history-main">
              <div className="history-title">
                {run.company || run.modelName || "Untitled"}
                {run.ticker ? <span className="ticker"> {run.ticker}</span> : null}
              </div>
              <div className="history-meta">
                {run.result?.scenarios?.length ?? 0} scenarios · {timeAgo(run.ranAt)}
              </div>
            </div>
            <button
              className="icon-btn"
              title="Delete run"
              onClick={(e) => { e.stopPropagation(); onDelete(run.id); }}
            >
              <Icon name="close" />
            </button>
          </div>
        ))}
      </div>

      <div className="sidebar-foot">
        <div className="account-email" title={user?.email}>{user?.email}</div>
        <button className="btn btn-sm btn-icon" onClick={onLogout}><Icon name="logout" /> Log out</button>
      </div>
    </aside>
  );
}
