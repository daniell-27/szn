import React, { useState } from "react";
import Icon from "./Icon.jsx";

// The model's justification for one estimate. Clicking opens a centered overlay
// so the full text is always readable (never clipped by the results table).
export default function StickyNote({ note, label }) {
  const [open, setOpen] = useState(false);
  if (!note) return null;
  return (
    <>
      <button type="button" className="sticky-icon" title="Why this estimate?" onClick={() => setOpen(true)}>
        <Icon name="note" size={15} />
      </button>
      {open && (
        <div className="sticky-overlay" onClick={() => setOpen(false)}>
          <div className="sticky-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sticky-modal-head">
              <span className="sticky-modal-label">{label || "Estimate reasoning"}</span>
              <button className="icon-btn" title="Close" onClick={() => setOpen(false)}><Icon name="close" /></button>
            </div>
            <div className="sticky-modal-body">{note}</div>
          </div>
        </div>
      )}
    </>
  );
}
