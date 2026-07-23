import React, { useState } from "react";
import { OPERATORS, FUNCTION_NAMES } from "../lib/defaults.js";
import { uid } from "../lib/util.js";
import { auxOutputIds, parseTyped } from "../lib/evaluate.js";
import Icon from "./Icon.jsx";

const OP_SYMBOL = { "*": "×", "/": "÷", "+": "+", "-": "−", "^": "^", "%": "%", "(": "(", ")": ")" };

export default function FormulaBuilder({ model, setModel }) {
  const [over, setOver] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [auxOpen, setAuxOpen] = useState((model.auxFormulas || []).length > 0);

  const variables = model.variables || [];
  const folders = model.folders || [];
  const aux = model.auxFormulas || [];
  const derived = new Set(auxOutputIds(model));
  const nameFor = (id) => variables.find((b) => b.id === id)?.name ?? "?";

  // ---------- immutable helpers ----------
  const getRhs = (tgt, m = model) =>
    tgt === "main" ? m.formula.rhs || [] : (m.auxFormulas.find((f) => "aux:" + f.id === tgt)?.rhs || []);
  const withRhs = (m, tgt, rhs) =>
    tgt === "main"
      ? { ...m, formula: { ...m.formula, rhs } }
      : { ...m, auxFormulas: m.auxFormulas.map((f) => ("aux:" + f.id === tgt ? { ...f, rhs } : f)) };

  const startDrag = (payload) => (e) => {
    e.dataTransfer.setData("text/plain", JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "move";
  };
  const parseDrag = (e) => { try { return JSON.parse(e.dataTransfer.getData("text/plain")); } catch { return null; } };
  const tokenFromPayload = (d) =>
    d.kind === "variable" ? { id: uid(), type: "variable", variableId: d.variableId }
      : d.kind === "op" ? { id: uid(), type: "op", op: d.op }
      : d.kind === "func" ? { id: uid(), type: "func", name: d.name }
      : null;

  // insert / move into a formula at a gap index
  function dropAtGap(tgt, index, e) {
    e.preventDefault(); e.stopPropagation(); setOver(null);
    const d = parseDrag(e); if (!d) return;
    if (d.kind === "token") {
      setModel((prev) => {
        const fromRhs = getRhs(d.from, prev);
        const token = fromRhs.find((t) => t.id === d.tokenId);
        if (!token) return prev;
        const p = fromRhs.indexOf(token);
        let m = withRhs(prev, d.from, fromRhs.filter((t) => t.id !== d.tokenId));
        let ins = index;
        if (d.from === tgt && index > p) ins -= 1;
        const cur = getRhs(tgt, m);
        return withRhs(m, tgt, [...cur.slice(0, ins), token, ...cur.slice(ins)]);
      });
    } else {
      const token = tokenFromPayload(d); if (!token) return;
      setModel((prev) => {
        const cur = getRhs(tgt, prev);
        return withRhs(prev, tgt, [...cur.slice(0, index), token, ...cur.slice(index)]);
      });
    }
  }

  function removeTokenFrom(from, tokenId) {
    setModel((prev) => withRhs(prev, from, getRhs(from, prev).filter((t) => t.id !== tokenId)));
  }

  // ---------- variables ----------
  function createVariable() {
    const name = newName.trim(); if (!name) return;
    setModel({ ...model, variables: [...variables, { id: uid(), name, folderId: null }] });
    setNewName(""); setCreating(false);
  }
  function deleteVariable(variableId) {
    setModel((prev) => {
      const strip = (rhs) => rhs.filter((t) => !(t.type === "variable" && t.variableId === variableId));
      const units = { ...prev.units }; delete units[variableId];
      return {
        ...prev,
        variables: prev.variables.filter((b) => b.id !== variableId),
        formula: { output: prev.formula.output === variableId ? null : prev.formula.output, rhs: strip(prev.formula.rhs) },
        auxFormulas: prev.auxFormulas.map((f) => ({ ...f, output: f.output === variableId ? null : f.output, rhs: strip(f.rhs) })),
        units,
        inputOrder: (prev.inputOrder || []).filter((id) => id !== variableId),
      };
    });
  }
  const moveVariableToFolder = (variableId, folderId) =>
    setModel({ ...model, variables: variables.map((b) => (b.id === variableId ? { ...b, folderId } : b)) });

  // ---------- folders ----------
  const addFolder = () => setModel({ ...model, folders: [...folders, { id: uid(), name: "New folder" }] });
  const renameFolder = (id, name) => setModel({ ...model, folders: folders.map((f) => (f.id === id ? { ...f, name } : f)) });
  const deleteFolder = (id) =>
    setModel({ ...model, folders: folders.filter((f) => f.id !== id), variables: variables.map((b) => (b.folderId === id ? { ...b, folderId: null } : b)) });

  // ---------- aux ----------
  const updateAux = (auxId, fn) => setModel({ ...model, auxFormulas: aux.map((f) => (f.id === auxId ? fn(f) : f)) });
  const setOutput = (formula) => setModel({ ...model, formula });

  // ---------- render pieces ----------
  const VariableChip = ({ b }) => (
    <span className={"block block-variable chip" + (derived.has(b.id) ? " block-derived" : "")} draggable onDragStart={startDrag({ kind: "variable", variableId: b.id })}>
      {b.name}
      <button className="chip-x" title="Delete variable" onClick={() => deleteVariable(b.id)}><Icon name="close" size={12} /></button>
    </span>
  );

  const FolderGroup = ({ folder }) => {
    const list = variables.filter((b) => (folder ? b.folderId === folder.id : !b.folderId));
    const key = folder ? "fld-" + folder.id : "ungrouped";
    return (
      <div
        className={"folder" + (over === key ? " drag-over" : "")}
        onDragOver={(e) => { e.preventDefault(); setOver(key); }}
        onDragLeave={() => setOver((k) => (k === key ? null : k))}
        onDrop={(e) => { e.preventDefault(); setOver(null); const d = parseDrag(e); if (d?.kind === "variable") moveVariableToFolder(d.variableId, folder ? folder.id : null); }}
      >
        <div className="folder-head">
          {folder ? (
            <>
              <Icon name="chevron" size={13} />
              <input className="folder-name" value={folder.name} onChange={(e) => renameFolder(folder.id, e.target.value)} />
              <button className="chip-x" title="Delete folder" onClick={() => deleteFolder(folder.id)}><Icon name="close" size={12} /></button>
            </>
          ) : (
            <span className="folder-label">Ungrouped</span>
          )}
        </div>
        <div className="folder-blocks">
          {list.length === 0 && <span className="folder-empty">drop variables here</span>}
          {list.map((b) => <VariableChip key={b.id} b={b} />)}
        </div>
      </div>
    );
  };

  // A gap drop-target between tokens (for precise insertion). Stops propagation
  // so the surrounding drop-anywhere editor doesn't also handle the drop.
  const Gap = ({ tgt, index }) => {
    const key = `${tgt}:${index}`;
    return (
      <span
        className={"tok-gap" + (over === key ? " gap-over" : "")}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(key); }}
        onDragLeave={(e) => { e.stopPropagation(); setOver((k) => (k === key ? null : k)); }}
        onDrop={(e) => dropAtGap(tgt, index, e)}
      />
    );
  };

  const TokenChip = ({ t, tgt }) => (
    <span
      className={"token " + (t.type === "variable" ? "token-variable" + (derived.has(t.variableId) ? " token-derived" : "") : t.type === "const" ? "token-const" : t.type === "func" ? "token-func" : "token-op")}
      draggable
      onDragStart={startDrag({ kind: "token", from: tgt, tokenId: t.id })}
      onClick={() => removeTokenFrom(tgt, t.id)}
      title="Drag to move, or click to remove"
    >
      {t.type === "variable" ? nameFor(t.variableId) : t.type === "const" ? t.value : t.type === "func" ? t.name : OP_SYMBOL[t.op] || t.op}
    </span>
  );

  function TypedEntry({ tgt }) {
    const [val, setVal] = useState("");
    const [bad, setBad] = useState(false);
    function commit() {
      if (!val.trim()) return;
      const { tokens, ok } = parseTyped(val);
      if (!ok || tokens.length === 0) { setBad(true); return; }
      setModel((prev) => withRhs(prev, tgt, [...getRhs(tgt, prev), ...tokens.map((t) => ({ ...t, id: uid() }))]));
      setVal(""); setBad(false);
    }
    return (
      <input
        className={"tok-typed" + (bad ? " bad" : "")}
        placeholder="type: 1.5, +, ^, SQRT…"
        value={val}
        onChange={(e) => { setVal(e.target.value); setBad(false); }}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
        onBlur={commit}
      />
    );
  }

  // The whole RHS area is a drop target: dropping a variable/operator anywhere in
  // it appends to the end, so users don't have to hit a tiny gap. Gaps still
  // allow precise insertion between existing tokens.
  const RhsEditor = ({ tgt, rhs }) => {
    const key = `rhs:${tgt}`;
    return (
      <div
        className={"rhs-slot rhs-editor" + (over === key ? " drag-over" : "")}
        onDragOver={(e) => { e.preventDefault(); setOver(key); }}
        onDragLeave={() => setOver((k) => (k === key ? null : k))}
        onDrop={(e) => dropAtGap(tgt, rhs.length, e)}
      >
        {rhs.length === 0 && <span className="slot-hint">drag variables / operators anywhere here, or type</span>}
        <Gap tgt={tgt} index={0} />
        {rhs.map((t, i) => (
          <React.Fragment key={t.id}>
            <TokenChip t={t} tgt={tgt} />
            <Gap tgt={tgt} index={i + 1} />
          </React.Fragment>
        ))}
        <TypedEntry tgt={tgt} />
      </div>
    );
  };

  const OutputSlot = ({ value, onSet, onClear }) => {
    const key = "out-" + value;
    return (
      <div
        className={"drop-slot output-slot" + (over === key ? " drag-over" : "")}
        onDragOver={(e) => { e.preventDefault(); setOver(key); }}
        onDragLeave={() => setOver((k) => (k === key ? null : k))}
        onDrop={(e) => { e.preventDefault(); setOver(null); const d = parseDrag(e); if (d?.kind === "variable") onSet(d.variableId); }}
      >
        {value ? (
          <span className={"token token-variable" + (onClear ? " token-output" : " token-derived")} onClick={onClear} title="Click to clear">{nameFor(value)}</span>
        ) : (
          <span className="slot-hint">drop output</span>
        )}
      </div>
    );
  };

  return (
    <div className="card">
      <div className="card-title">Variables</div>
      {/* palette: variables are a drop target for removing formula tokens */}
      <div
        className="palette"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { const d = parseDrag(e); if (d?.kind === "token") removeTokenFrom(d.from, d.tokenId); }}
      >
        <div className="palette-folders">
          {folders.map((f) => <FolderGroup key={f.id} folder={f} />)}
          <FolderGroup folder={null} />
        </div>

        <div className="palette-ops-row">
          {OPERATORS.map((o) => (
            <div key={o.op} className="block block-op" draggable onDragStart={startDrag({ kind: "op", op: o.op })}>{o.label}</div>
          ))}
          <span className="palette-divider" />
          {FUNCTION_NAMES.map((n) => (
            <div key={n} className="block block-func" draggable onDragStart={startDrag({ kind: "func", name: n })}>{n}</div>
          ))}
        </div>

        <div className="palette-controls">
          {creating ? (
            <div className="add-block">
              <input className="input input-sm" autoFocus placeholder="Variable name…" value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") createVariable(); if (e.key === "Escape") { setCreating(false); setNewName(""); } }}
                onBlur={() => { if (!newName.trim()) setCreating(false); }} />
              <button className="btn btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={createVariable}>Add</button>
            </div>
          ) : (
            <button className="btn btn-sm btn-icon" onClick={() => setCreating(true)}><Icon name="plus" /> New variable</button>
          )}
          <button className="btn btn-sm btn-icon" onClick={addFolder}><Icon name="plus" /> New folder</button>
        </div>
        <div className="hint">Drag a variable onto a folder to sort it. Drag a formula token back here (or click it) to remove it.</div>
      </div>

      <div className="card-title" style={{ marginTop: 18 }}>Main formula</div>
      <div className="formula-bar">
        <OutputSlot value={model.formula.output} onSet={(id) => setOutput({ ...model.formula, output: id })} onClear={() => setOutput({ ...model.formula, output: null })} />
        <div className="equals">=</div>
        <RhsEditor tgt="main" rhs={model.formula.rhs || []} />
      </div>
      <div className="hint">Drop variables/operators anywhere in the formula bar. Type numbers, operators (+ − × ÷ ^ %), or functions (SQRT, LN, LOG, EXP, ABS, ROUND).</div>

      <div className="aux-panel">
        <button className="aux-toggle" onClick={() => setAuxOpen((o) => !o)}>
          <Icon name={auxOpen ? "minus" : "plus"} /><span>Auxiliary formulas</span><span className="aux-count">{aux.length ? `(${aux.length})` : ""}</span>
        </button>
        {auxOpen && (
          <div className="aux-body">
            <div className="aux-hint">Define a main-formula input from other variables. That input becomes computed — you'll fill its sub-variables instead.</div>
            {aux.map((f) => (
              <div key={f.id} className="formula-bar formula-bar-aux">
                <OutputSlot value={f.output} onSet={(id) => updateAux(f.id, (x) => ({ ...x, output: id }))} onClear={() => updateAux(f.id, (x) => ({ ...x, output: null }))} />
                <div className="equals">=</div>
                <RhsEditor tgt={"aux:" + f.id} rhs={f.rhs || []} />
                <button className="icon-btn" title="Remove auxiliary formula" onClick={() => setModel({ ...model, auxFormulas: aux.filter((x) => x.id !== f.id) })}><Icon name="close" /></button>
              </div>
            ))}
            <button className="btn btn-sm btn-icon" onClick={() => { setAuxOpen(true); setModel({ ...model, auxFormulas: [...aux, { id: uid(), output: null, rhs: [] }] }); }}><Icon name="plus" /> Add auxiliary formula</button>
          </div>
        )}
      </div>
    </div>
  );
}
