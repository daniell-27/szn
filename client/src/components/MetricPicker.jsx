import React, { useEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import { formatNumber } from "../lib/evaluate.js";

// A dropdown to fill a median input from the company's current financial metrics.
export default function MetricPicker({ metrics, onPick }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const boxRef = useRef(null);

  useEffect(() => {
    function onDoc(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const shown = (metrics || []).filter((m) => m.label.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="metric-picker" ref={boxRef}>
      <button
        type="button"
        className="metric-btn"
        title="Fill from current financials"
        onClick={() => setOpen((o) => !o)}
        disabled={!metrics || metrics.length === 0}
      >
        <Icon name="search" size={14} />
      </button>
      {open && (
        <div className="metric-dropdown">
          <input
            className="input input-sm metric-filter"
            placeholder="Filter metrics…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            autoFocus
          />
          <div className="metric-list">
            {shown.length === 0 && <div className="company-empty">No metrics.</div>}
            {shown.map((m) => (
              <button
                key={m.label}
                className="metric-option"
                onClick={() => { onPick(m); setOpen(false); setFilter(""); }}
              >
                <span className="metric-option-label">{m.label}</span>
                <span className="metric-option-value">{formatNumber(m.value)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
