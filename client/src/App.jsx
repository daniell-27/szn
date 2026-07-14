import React, { useEffect, useMemo, useRef, useState } from "react";
import Sidebar from "./components/Sidebar.jsx";
import FormulaBuilder from "./components/FormulaBuilder.jsx";
import OutputView from "./components/OutputView.jsx";
import AuthScreen from "./components/AuthScreen.jsx";
import CompanySearch from "./components/CompanySearch.jsx";
import MetricPicker from "./components/MetricPicker.jsx";
import ScenarioSources from "./components/ScenarioSources.jsx";
import { makeDefaultModel } from "./lib/defaults.js";
import { freeInputIds, modelToText, toRaw, UNITS } from "./lib/evaluate.js";
import { uid } from "./lib/util.js";
import Icon from "./components/Icon.jsx";
import * as api from "./lib/api.js";

const withDefaults = (m) => ({ auxFormulas: [], units: {}, folders: [], inputOrder: [], blocks: [], ...m });

// Display order for median inputs: honor inputOrder, then any new inputs.
function orderInputs(inputIds, inputOrder) {
  const set = new Set(inputIds);
  const ordered = (inputOrder || []).filter((id) => set.has(id));
  const seen = new Set(ordered);
  return [...ordered, ...inputIds.filter((id) => !seen.has(id))];
}

export default function App() {
  const [user, setUser] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  const [model, setModel] = useState(makeDefaultModel);
  const [baseValues, setBaseValues] = useState({});
  const [scenarios, setScenarios] = useState([
    { id: uid(), name: "Bull case", description: "" },
    { id: uid(), name: "Bear case", description: "" },
  ]);

  const [view, setView] = useState("build"); // "build" | "output"
  const [result, setResult] = useState(null);
  const [activeRunId, setActiveRunId] = useState(null);

  const [savedModels, setSavedModels] = useState([]);
  const [history, setHistory] = useState([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [health, setHealth] = useState(null);

  const [metrics, setMetrics] = useState([]); // current financials for the selected company
  const [pickedMetric, setPickedMetric] = useState({}); // blockId -> metric label used
  const [medDrag, setMedDrag] = useState(null); // index being dragged in the median list

  const inputIds = useMemo(() => freeInputIds(model), [model.formula, model.auxFormulas]);
  const nameFor = (id) => model.blocks.find((b) => b.id === id)?.name ?? "?";

  // ---- initial auth check ----
  useEffect(() => {
    api.checkHealth().then(setHealth);
    api.me()
      .then(({ user }) => setUser(user))
      .catch(() => setUser(null))
      .finally(() => setCheckingAuth(false));
  }, []);

  // ---- load user data once signed in ----
  useEffect(() => {
    if (!user) return;
    api.listModels().then(setSavedModels).catch(() => {});
    api.listRuns().then(setHistory).catch(() => {});
  }, [user]);

  // ---- pull current financials whenever a company (ticker) is confirmed ----
  useEffect(() => {
    if (!health?.finance || !model.ticker) { setMetrics([]); return; }
    let cancelled = false;
    api.getMetrics(model.ticker)
      .then((d) => { if (!cancelled) setMetrics(d.metrics || []); })
      .catch(() => { if (!cancelled) setMetrics([]); });
    return () => { cancelled = true; };
  }, [model.ticker, health?.finance]);

  // ---- autosave edits made on the output page back to the server ----
  const saveTimer = useRef(null);
  useEffect(() => {
    if (!activeRunId || view !== "output" || !result) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api.saveRun({ id: activeRunId, modelName: model.name, company: model.company, ticker: model.ticker, model, baseValues, result })
        .then((rec) => setHistory((h) => h.map((r) => (r.id === rec.id ? rec : r))))
        .catch(() => {});
    }, 700);
    return () => clearTimeout(saveTimer.current);
  }, [result, baseValues, activeRunId, view]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- actions ----
  function newAnalysis() {
    setModel(makeDefaultModel());
    setBaseValues({});
    setScenarios([{ id: uid(), name: "Bull case", description: "" }, { id: uid(), name: "Bear case", description: "" }]);
    setResult(null);
    setActiveRunId(null);
    setError("");
    setPickedMetric({});
    setView("build");
  }

  // A saved model is a reusable TEMPLATE: blocks, folders, formulas, units —
  // not the company/thesis/values of a particular application.
  async function onSaveModel() {
    try {
      const rec = await api.saveModel({
        id: model.id, name: model.name,
        blocks: model.blocks, folders: model.folders,
        formula: model.formula, auxFormulas: model.auxFormulas,
        units: model.units, inputOrder: model.inputOrder,
      });
      setModel((m) => ({ ...m, id: rec.id }));
      setSavedModels(await api.listModels());
    } catch (e) {
      setError(e.message);
    }
  }

  // Importing loads the template structure but keeps the current company/thesis.
  function onImportModel(id) {
    const m = savedModels.find((x) => x.id === id);
    if (!m) return;
    setModel((cur) => ({
      ...cur,
      id: m.id, name: m.name,
      blocks: m.blocks || [], folders: m.folders || [],
      formula: m.formula || { output: null, rhs: [] },
      auxFormulas: m.auxFormulas || [], units: m.units || {},
      inputOrder: m.inputOrder || [],
    }));
    setView("build");
  }

  async function onDeleteSavedModel(id) {
    await api.deleteModel(id).catch(() => {});
    setSavedModels(await api.listModels());
  }

  // scenario rows
  function addScenarioAfter(index) {
    const next = [...scenarios];
    next.splice(index + 1, 0, { id: uid(), name: `Scenario ${scenarios.length + 1}`, description: "" });
    setScenarios(next);
  }
  const updateScenario = (id, patch) => setScenarios(scenarios.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const removeScenario = (id) => setScenarios(scenarios.filter((s) => s.id !== id));

  // Scenarios added from Fintwit / uploaded articles.
  const addScenarioFromSource = (sc) =>
    setScenarios((s) => [...s, { id: uid(), name: sc.name, description: sc.description, source: sc.source, handle: sc.handle }]);
  const removeScenarioByHandle = (handle) => setScenarios((s) => s.filter((x) => x.handle !== handle));
  const addedHandles = new Set(scenarios.filter((s) => s.handle).map((s) => s.handle));

  // run
  async function onRun() {
    setError("");
    if (health?.finance && !model.ticker) {
      setError("Search for the company and click the matching result to confirm it first.");
      return;
    }
    if (!model.formula.output || model.formula.rhs.length === 0) {
      setError("Build a formula first: drop an output block on the left and blocks/operators on the right.");
      return;
    }
    const named = scenarios.filter((s) => s.name.trim() || s.description.trim());
    if (named.length === 0) {
      setError("Add at least one alternative scenario with a name or description.");
      return;
    }
    setLoading(true);
    try {
      const ids = freeInputIds(model);
      const units = model.units || {};
      const data = await api.runScenarios({
        company: model.company, ticker: model.ticker, thesis: model.thesis,
        formulaText: modelToText(model),
        variables: ids.map((id) => ({ id, name: nameFor(id) })),
        baseValues: toRaw(baseValues, units, ids), // send true magnitudes
        scenarios: named.map((s) => ({ name: s.name.trim() || "Unnamed scenario", description: s.description })),
      });
      // The model reasons in raw numbers; convert back into each variable's unit for display.
      const scenarios = data.scenarios.map((s, i) => {
        const values = {};
        for (const id of ids) {
          const v = s.values?.[id];
          if (v !== undefined && v !== null && !Number.isNaN(Number(v))) {
            values[id] = +(Number(v) / (units[id] || 1)).toPrecision(6);
          }
        }
        return { name: s.name, values, notes: s.notes, description: named[i]?.description || "" };
      });
      const runResult = { scenarios };
      setResult(runResult);

      const rec = await api.saveRun({
        modelName: model.name, company: model.company, ticker: model.ticker,
        model, baseValues, result: runResult,
      });
      setActiveRunId(rec.id);
      setHistory((h) => [rec, ...h.filter((r) => r.id !== rec.id)]);
      setView("output");
    } catch (e) {
      setError(e.message || "Run failed.");
    } finally {
      setLoading(false);
    }
  }

  // history
  function loadRun(run) {
    setModel(withDefaults(run.model));
    setBaseValues(run.baseValues || {});
    setResult(run.result);
    setActiveRunId(run.id);
    setView("output");
  }
  async function onDeleteRun(id) {
    await api.deleteRun(id).catch(() => {});
    setHistory((h) => h.filter((r) => r.id !== id));
    if (id === activeRunId) newAnalysis();
  }

  async function onLogout() {
    await api.logout().catch(() => {});
    setUser(null);
    setSavedModels([]);
    setHistory([]);
    newAnalysis();
  }

  // ---- render ----
  if (checkingAuth) {
    return <div className="splash">Loading Fermi…</div>;
  }
  if (!user) {
    return <AuthScreen onAuthed={setUser} />;
  }

  return (
    <div className="app">
      <Sidebar
        user={user}
        history={history}
        activeRunId={activeRunId}
        onLoad={loadRun}
        onDelete={onDeleteRun}
        onNew={newAnalysis}
        onLogout={onLogout}
      />

      <main className="main">
        {health && !health.hasKey && !health.mock && (
          <div className="banner banner-warn">
            No Anthropic API key detected on the server. Add one to <code>server/.env</code> and restart the backend to run scenarios.
          </div>
        )}
        {health && health.mock && (
          <div className="banner banner-warn">
            Demo mode — scenarios use canned estimates. Add an <code>ANTHROPIC_API_KEY</code> and drop <code>MOCK=1</code> for real reasoning.
          </div>
        )}

        {view === "build" ? (
          <div className="build-view">
            <div className="card top-controls">
              <div className="tc-row">
                <label className="field">
                  <span>Model name</span>
                  <input className="input" value={model.name} onChange={(e) => setModel({ ...model, name: e.target.value })} />
                </label>
                {health?.finance ? (
                  <div className="field">
                    <span>Company <span className="req">*</span></span>
                    <CompanySearch
                      company={model.company}
                      ticker={model.ticker}
                      onSelect={({ name, symbol }) => { setModel({ ...model, company: name, ticker: symbol }); setPickedMetric({}); }}
                      onClear={() => { setModel({ ...model, company: "", ticker: "" }); setPickedMetric({}); }}
                    />
                  </div>
                ) : (
                  <>
                    <label className="field">
                      <span>Company</span>
                      <input className="input" placeholder="e.g. Costco" value={model.company} onChange={(e) => setModel({ ...model, company: e.target.value })} />
                    </label>
                    <label className="field field-sm">
                      <span>Ticker</span>
                      <input className="input" placeholder="COST" value={model.ticker} onChange={(e) => setModel({ ...model, ticker: e.target.value })} />
                    </label>
                  </>
                )}
              </div>
              <div className="tc-row tc-actions">
                <label className="field">
                  <span>Import saved model</span>
                  <select className="input" value="" onChange={(e) => e.target.value && onImportModel(e.target.value)}>
                    <option value="">Select a saved model…</option>
                    {savedModels.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}{m.company ? ` — ${m.company}` : ""}</option>
                    ))}
                  </select>
                </label>
                {model.id && (
                  <button className="btn btn-icon-only" title="Delete this saved model" onClick={() => onDeleteSavedModel(model.id)}><Icon name="trash" /></button>
                )}
                <button className="btn btn-icon" onClick={onSaveModel}><Icon name="save" /> Save model</button>
              </div>
            </div>

            <FormulaBuilder model={model} setModel={setModel} />

            <div className="card">
              <div className="card-title">Thesis / context <span className="optional">(optional — helps the model)</span></div>
              <textarea className="textarea" rows={3} placeholder="A few sentences on why you hold these median estimates…" value={model.thesis} onChange={(e) => setModel({ ...model, thesis: e.target.value })} />
            </div>

            <div className="card">
              <div className="card-title">Your median estimates</div>
              {inputIds.length === 0 ? (
                <div className="empty">Add variable blocks to the formula to see their input boxes here.</div>
              ) : (
                <div className="median-inputs">
                  {orderInputs(inputIds, model.inputOrder).map((id, i, arr) => (
                    <div
                      key={id}
                      className={"median-field" + (medDrag !== null && medDrag !== i ? "" : "")}
                      onDragOver={(e) => { if (medDrag !== null) e.preventDefault(); }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (medDrag === null || medDrag === i) return;
                        const next = [...arr];
                        const [moved] = next.splice(medDrag, 1);
                        next.splice(i, 0, moved);
                        setModel({ ...model, inputOrder: next });
                        setMedDrag(null);
                      }}
                    >
                      <span
                        className="median-grip"
                        draggable
                        onDragStart={() => setMedDrag(i)}
                        onDragEnd={() => setMedDrag(null)}
                        title="Drag to reorder"
                      >
                        <Icon name="grip" size={14} />
                      </span>
                    <label className="field">
                      <span>{nameFor(id)}</span>
                      <div className="input-with-unit">
                        <input className="input" inputMode="decimal" placeholder="0" value={baseValues[id] ?? ""} onChange={(e) => { setBaseValues({ ...baseValues, [id]: e.target.value }); if (pickedMetric[id]) setPickedMetric({ ...pickedMetric, [id]: null }); }} />
                        <select
                          className="unit-select"
                          value={model.units?.[id] ?? 1}
                          onChange={(e) => setModel({ ...model, units: { ...(model.units || {}), [id]: Number(e.target.value) } })}
                        >
                          {UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                        </select>
                        {health?.finance && metrics.length > 0 && (
                          <MetricPicker
                            metrics={metrics}
                            onPick={(m) => {
                              const unit = model.units?.[id] || 1;
                              setBaseValues({ ...baseValues, [id]: +(m.value / unit).toPrecision(6) });
                              setPickedMetric({ ...pickedMetric, [id]: m.label });
                            }}
                          />
                        )}
                      </div>
                      {pickedMetric[id] && <span className="picked-metric">from {pickedMetric[id]}</span>}
                    </label>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <div className="card-title">Alternative scenarios</div>
              <ScenarioSources
                health={health}
                context={{ company: model.company, ticker: model.ticker, thesis: model.thesis, formulaText: modelToText(model) }}
                addedHandles={addedHandles}
                onAddScenario={addScenarioFromSource}
                onRemoveByHandle={removeScenarioByHandle}
              />
              <div className="scenario-rows">
                {scenarios.map((s, i) => (
                  <div key={s.id} className="scenario-row">
                    <div className="scenario-row-top">
                      <input className="input scenario-name" placeholder="Scenario name" value={s.name} onChange={(e) => updateScenario(s.id, { name: e.target.value })} />
                      <div className="scenario-row-btns">
                        <button className="icon-btn add" title="Add a scenario below" onClick={() => addScenarioAfter(i)}><Icon name="plus" /></button>
                        {scenarios.length > 1 && (
                          <button className="icon-btn" title="Remove scenario" onClick={() => removeScenario(s.id)}><Icon name="close" /></button>
                        )}
                      </div>
                    </div>
                    <textarea className="textarea" rows={2} placeholder="Describe this future in plain language — the model adjusts your inputs to fit it." value={s.description} onChange={(e) => updateScenario(s.id, { description: e.target.value })} />
                  </div>
                ))}
              </div>
            </div>

            {error && <div className="banner banner-error">{error}</div>}

            <div className="run-bar">
              <button className="btn btn-run btn-icon" onClick={onRun} disabled={loading}>
                <Icon name="run" size={15} /> {loading ? "Running…" : "Run"}
              </button>
            </div>
          </div>
        ) : (
          result && (
            <OutputView
              model={model}
              baseValues={baseValues}
              setBaseValues={setBaseValues}
              result={result}
              setResult={setResult}
              onBack={() => setView("build")}
            />
          )
        )}
      </main>
    </div>
  );
}
