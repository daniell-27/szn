import React, { useState } from "react";
import { OPERATORS } from "../lib/defaults.js";
import { uid } from "../lib/util.js";
import { auxOutputIds } from "../lib/evaluate.js";
import Icon from "./Icon.jsx";

const OP_SYMBOL = { "*": "×", "/": "÷", "+": "+", "-": "−", "(": "(", ")": ")" };

export default function FormulaBuilder({ model, setModel }) {
  const [overTarget, setOverTarget] = useState(null); // string key of hovered drop slot
  const [newBlockName, setNewBlockName] = useState("");
  const [auxOpen, setAuxOpen] = useState((model.auxFormulas || []).length > 0);

  const blocks = model.blocks;
  const aux = model.auxFormulas || [];
  const derived = new Set(auxOutputIds(model));
  const nameFor = (id) => blocks.find((b) => b.id === id)?.name ?? "?";

  // ---- block palette ----
  function addBlock() {
    const name = newBlockName.trim();
    if (!name) return;
    setModel({ ...model, blocks: [...blocks, { id: uid(), name }] });
    setNewBlockName("");
  }

  const startDrag = (payload) => (e) => {
    e.dataTransfer.setData("text/plain", JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "copy";
  };

  // ---- generic drop handling ----
  // target: {kind: "main-output"|"main-rhs"|"aux-output"|"aux-rhs", auxId?}
  function handleDrop(e, target) {
    e.preventDefault();
    setOverTarget(null);
    let data;
    try { data = JSON.parse(e.dataTransfer.getData("text/plain")); } catch { return; }

    if (target.kind === "main-output") {
      if (data.kind === "block") setFormula({ ...model.formula, output: data.blockId });
      return;
    }
    if (target.kind === "aux-output") {
      if (data.kind === "block") updateAux(target.auxId, (f) => ({ ...f, output: data.blockId }));
      return;
    }
    const token =
      data.kind === "block"
        ? { id: uid(), type: "variable", blockId: data.blockId }
        : data.kind === "op"
        ? { id: uid(), type: "op", op: data.op }
        : null;
    if (!token) return;
    if (target.kind === "main-rhs") setFormula({ ...model.formula, rhs: [...(model.formula.rhs || []), token] });
    else if (target.kind === "aux-rhs") updateAux(target.auxId, (f) => ({ ...f, rhs: [...(f.rhs || []), token] }));
  }

  const setFormula = (formula) => setModel({ ...model, formula });
  const updateAux = (auxId, fn) =>
    setModel({ ...model, auxFormulas: aux.map((f) => (f.id === auxId ? fn(f) : f)) });

  function removeMainToken(id) {
    setFormula({ ...model.formula, rhs: model.formula.rhs.filter((t) => t.id !== id) });
  }
  function removeAuxToken(auxId, id) {
    updateAux(auxId, (f) => ({ ...f, rhs: f.rhs.filter((t) => t.id !== id) }));
  }
  function addAux() {
    setAuxOpen(true);
    setModel({ ...model, auxFormulas: [...aux, { id: uid(), output: null, rhs: [] }] });
  }
  function removeAux(auxId) {
    setModel({ ...model, auxFormulas: aux.filter((f) => f.id !== auxId) });
  }

  const dropProps = (target, key) => ({
    onDragOver: (e) => { e.preventDefault(); setOverTarget(key); },
    onDragLeave: () => setOverTarget((k) => (k === key ? null : k)),
    onDrop: (e) => handleDrop(e, target),
    className: "drop-slot" + (overTarget === key ? " drag-over" : ""),
  });

  const Token = ({ t, onRemove, tinted }) => (
    <span
      className={
        "token " +
        (t.type === "variable"
          ? "token-var" + (tinted && derived.has(t.blockId) ? " token-derived" : "")
          : "token-op")
      }
      onClick={onRemove}
      title="Click to remove"
    >
      {t.type === "variable" ? nameFor(t.blockId) : OP_SYMBOL[t.op] || t.op}
    </span>
  );

  return (
    <div className="card">
      <div className="card-title">Blocks</div>
      <div className="palette">
        {blocks.map((b) => (
          <div
            key={b.id}
            className={"block block-var" + (derived.has(b.id) ? " block-derived" : "")}
            draggable
            onDragStart={startDrag({ kind: "block", blockId: b.id })}
          >
            {b.name}
          </div>
        ))}
        <div className="palette-ops">
          {OPERATORS.map((o) => (
            <div key={o.op} className="block block-op" draggable onDragStart={startDrag({ kind: "op", op: o.op })}>
              {o.label}
            </div>
          ))}
        </div>
        <div className="add-block">
          <input
            className="input input-sm"
            placeholder="New block name…"
            value={newBlockName}
            onChange={(e) => setNewBlockName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addBlock()}
          />
          <button className="btn btn-sm btn-icon" onClick={addBlock}><Icon name="plus" /> Add block</button>
        </div>
      </div>

      <div className="card-title" style={{ marginTop: 18 }}>Main formula</div>
      <div className="formula-bar">
        <div {...dropProps({ kind: "main-output" }, "main-output")}>
          {model.formula.output ? (
            <span
              className={"token token-var token-output"}
              onClick={() => setFormula({ ...model.formula, output: null })}
              title="Click to clear"
            >
              {nameFor(model.formula.output)}
            </span>
          ) : (
            <span className="slot-hint">drop output</span>
          )}
        </div>
        <div className="equals">=</div>
        <div {...dropProps({ kind: "main-rhs" }, "main-rhs")} style={{ flex: 1 }}>
          {(model.formula.rhs || []).length === 0 && <span className="slot-hint">drag blocks and operators here</span>}
          {(model.formula.rhs || []).map((t) => (
            <Token key={t.id} t={t} tinted onRemove={() => removeMainToken(t.id)} />
          ))}
        </div>
      </div>
      <div className="hint">
        Drag from Blocks into the formula. Click a token to remove it.
        {derived.size > 0 && <> Tinted blocks are defined by an auxiliary formula.</>}
      </div>

      {/* Auxiliary formulas */}
      <div className="aux-panel">
        <button className="aux-toggle" onClick={() => setAuxOpen((o) => !o)}>
          <Icon name={auxOpen ? "minus" : "plus"} />
          <span>Auxiliary formulas</span>
          <span className="aux-count">{aux.length ? `(${aux.length})` : ""}</span>
        </button>

        {auxOpen && (
          <div className="aux-body">
            <div className="aux-hint">
              Define a main-formula input from other blocks. That input then becomes computed —
              you'll fill in its sub-variables instead.
            </div>
            {aux.map((f) => (
              <div key={f.id} className="formula-bar formula-bar-aux">
                <div {...dropProps({ kind: "aux-output", auxId: f.id }, `aux-out-${f.id}`)}>
                  {f.output ? (
                    <span className="token token-derived" onClick={() => updateAux(f.id, (x) => ({ ...x, output: null }))} title="Click to clear">
                      {nameFor(f.output)}
                    </span>
                  ) : (
                    <span className="slot-hint">drop variable</span>
                  )}
                </div>
                <div className="equals">=</div>
                <div {...dropProps({ kind: "aux-rhs", auxId: f.id }, `aux-rhs-${f.id}`)} style={{ flex: 1 }}>
                  {(f.rhs || []).length === 0 && <span className="slot-hint">drag blocks and operators here</span>}
                  {(f.rhs || []).map((t) => (
                    <Token key={t.id} t={t} onRemove={() => removeAuxToken(f.id, t.id)} />
                  ))}
                </div>
                <button className="icon-btn" title="Remove auxiliary formula" onClick={() => removeAux(f.id)}>
                  <Icon name="close" />
                </button>
              </div>
            ))}
            <button className="btn btn-sm btn-icon" onClick={addAux}><Icon name="plus" /> Add auxiliary formula</button>
          </div>
        )}
      </div>
    </div>
  );
}
