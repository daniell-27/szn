import React, { useEffect, useMemo, useRef, useState } from "react";
import Sidebar from "./components/Sidebar.jsx";
import FormulaBuilder from "./components/FormulaBuilder.jsx";
import OutputView from "./components/OutputView.jsx";
import AuthScreen from "./components/AuthScreen.jsx";
import CompanySearch from "./components/CompanySearch.jsx";
import MetricPicker from "./components/MetricPicker.jsx";
import ScenarioSources from "./components/ScenarioSources.jsx";
import { makeDefaultModel } from "./lib/defaults.js";
import { migrateModel } from "./lib/migrate.js";
import { freeInputIds, modelToText, toRaw, UNITS } from "./lib/evaluate.js";
import { uid } from "./lib/util.js";
import Icon from "./components/Icon.jsx";
import * as api from "./lib/api.js";

// Fill defaults AND migrate old saved shapes (e.g. blocks -> variables) so a
// patched bug never re-enters through a stale saved model.
const withDefaults = (m) => ({ auxFormulas: [], units: {}, folders: [], inputOrder: [], variables: [], ...migrateModel(m) });

const DRAFT_KEY = (userId) => `szn:draft:${userId || "anon"}`;
const defaultScenarios = () => [
  { id: uid(), name: "Bull case", description: "" },
  { id: uid(), name: "Bear case", description: "" },
];

// Signature of everything a run depends on — used to tell whether the inputs
// have changed since the last run (drives the Re-run button state).
const sigOf = (m, bv, sc) =>
  JSON.stringify({
    f: m.formula, v: m.variables, a: m.auxFormulas, u: m.units, t: m.thesis,
    b: bv, s: (sc || []).map((s) => ({ n: s.name, d: s.description })),
  });

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
  const [scenarios, setScenarios] = useState(defaultScenarios);

  const [view, setView] = useState("build"); // "build" | "output"
  const [result, setResult] = useState(null);
  const [activeRunId, setActiveRunId] = useState(null);
  const [runSig, setRunSig] = useState(null); // input signature at the last run
  const [confirmOutput, setConfirmOutput] = useState(false); // "view stale output?" modal
  const [updateAvailable, setUpdateAvailable] = useState(false); // new deploy detected
  const draftReady = useRef(false); // gate draft autosave until after restore

  const [savedModels, setSavedModels] = useState([]);
  const [history, setHistory] = useState([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [health, setHealth] = useState(null);

  const [metrics, setMetrics] = useState([]); // current financials for the selected company
  const [pickedMetric, setPickedMetric] = useState({}); // blockId -> metric label used
  const [medDrag, setMedDrag] = useState(null); // index being dragged in the median list

  const inputIds = useMemo(() => freeInputIds(model), [model.formula, model.auxFormulas]);
  const nameFor = (id) => (model.variables || []).find((b) => b.id === id)?.name ?? "?";

  // Have the inputs changed since the last run? Drives the Re-run button colour
  // and the "view stale output?" confirmation.
  const inputSig = sigOf(model, baseValues, scenarios);
  const inputsDirty = !!result && runSig !== null && inputSig !== runSig;

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
    // Restore an in-progress draft so a reload (e.g. after a new deploy) never
    // clears the user's un-run work.
    try {
      const raw = localStorage.getItem(DRAFT_KEY(user.id));
      const d = raw ? JSON.parse(raw) : null;
      if (d && d.model) {
        setModel(withDefaults(d.model));
        setBaseValues(d.baseValues || {});
        setScenarios(d.scenarios?.length ? d.scenarios : defaultScenarios());
        setResult(d.result || null);
        setActiveRunId(d.activeRunId || null);
        setRunSig(d.runSig ?? null);
        setView(d.view === "output" && d.result ? "output" : "build");
      }
    } catch { /* ignore malformed draft */ }
    draftReady.current = true;
  }, [user]);

  // ---- autosave the whole in-progress page to a local draft (debounced) ----
  useEffect(() => {
    if (!user || !draftReady.current) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(
          DRAFT_KEY(user.id),
          JSON.stringify({ model, baseValues, scenarios, view, result, activeRunId, runSig, savedAt: Date.now() })
        );
      } catch { /* quota / disabled — ignore */ }
    }, 400);
    return () => clearTimeout(t);
  }, [user, model, baseValues, scenarios, view, result, activeRunId, runSig]);

  // ---- detect a new deployment; offer a non-disruptive reload ----
  useEffect(() => {
    if (!health?.version) return;
    const seen = health.version;
    const check = async () => {
      const h = await api.checkHealth();
      if (h?.version && h.version !== seen) setUpdateAvailable(true);
    };
    window.addEventListener("focus", check);
    const iv = setInterval(check, 5 * 60 * 1000);
    return () => { window.removeEventListener("focus", check); clearInterval(iv); };
  }, [health?.version]);

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
    setScenarios(defaultScenarios());
    setResult(null);
    setActiveRunId(null);
    setRunSig(null);
    setError("");
    setPickedMetric({});
    setView("build");
  }

  // "Save model" now snapshots EVERYTHING on the page (variables, formula,
  // company/thesis, median estimates, and scenarios) — even before a run — so
  // nothing on the page is lost.
  async function onSaveModel() {
    try {
      const rec = await api.saveModel({
        id: model.id, name: model.name,
        company: model.company, ticker: model.ticker, thesis: model.thesis,
        variables: model.variables, folders: model.folders,
        formula: model.formula, auxFormulas: model.auxFormulas,
        units: model.units, inputOrder: model.inputOrder,
        baseValues, scenarios,
        schemaVersion: model.schemaVersion,
      });
      setModel((m) => ({ ...m, id: rec.id }));
      setSavedModels(await api.listModels());
    } catch (e) {
      setError(e.message);
    }
  }

  // Importing restores the full saved snapshot: structure + estimates + scenarios.
  function onImportModel(id) {
    const raw = savedModels.find((x) => x.id === id);
    if (!raw) return;
    const m = migrateModel(raw);
    setModel((cur) => ({
      ...cur,
      id: m.id, name: m.name,
      company: m.company ?? cur.company, ticker: m.ticker ?? cur.ticker,
      thesis: m.thesis ?? cur.thesis,
      variables: m.variables || [], folders: m.folders || [],
      formula: m.formula || { output: null, rhs: [] },
      auxFormulas: m.auxFormulas || [], units: m.units || {},
      inputOrder: m.inputOrder || [],
      schemaVersion: m.schemaVersion,
    }));
    if (m.baseValues) setBaseValues(m.baseValues);
    if (m.scenarios?.length) setScenarios(m.scenarios.map((s) => ({ id: s.id || uid(), ...s })));
    setResult(null);
    setRunSig(null);
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
      setError("Build a formula first: drop an output variable on the left and variables/operators on the right.");
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
      const outScenarios = data.scenarios.map((s, i) => {
        const values = {};
        for (const id of ids) {
          const v = s.values?.[id];
          if (v !== undefined && v !== null && !Number.isNaN(Number(v))) {
            values[id] = +(Number(v) / (units[id] || 1)).toPrecision(6);
          }
        }
        return { name: s.name, values, notes: s.notes, description: named[i]?.description || "" };
      });
      const runResult = { scenarios: outScenarios };
      setResult(runResult);
      setRunSig(sigOf(model, baseValues, scenarios)); // snapshot inputs at run time

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

  // After the first run, the primary button just re-opens the output (no re-run,
  // no cost). If the inputs changed since the run, viewing the (stale) output is
  // confirmed first, since those edits aren't reflected until a re-run.
  function onOutput() {
    if (inputsDirty) { setConfirmOutput(true); return; }
    setView("output");
  }
  function confirmViewOutput() {
    setConfirmOutput(false);
    setView("output");
  }

  // history
  function loadRun(run) {
    const m = withDefaults(run.model);
    const bv = run.baseValues || {};
    const sc = (run.result?.scenarios || []).map((s) => ({ id: uid(), name: s.name, description: s.description || "" }));
    setModel(m);
    setBaseValues(bv);
    setScenarios(sc.length ? sc : defaultScenarios());
    setResult(run.result);
    setActiveRunId(run.id);
    setRunSig(sigOf(m, bv, sc)); // a freshly loaded run is "clean"
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
    return <div className="splash">Loading SZN…</div>;
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
        {updateAvailable && (
          <div className="banner banner-update">
            A new version of SZN is available.{" "}
            <button className="link-btn" onClick={() => window.location.reload()}>Reload</button>{" "}
            to update — your inputs are saved and will be restored.
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
                <div className="empty">Add variables to the formula to see their input boxes here.</div>
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
              {!result ? (
                <button className="btn btn-run btn-icon" onClick={onRun} disabled={loading}>
                  <Icon name="run" size={15} /> {loading ? "Running…" : "Run"}
                </button>
              ) : (
                <>
                  <button
                    className={"btn btn-rerun btn-icon" + (inputsDirty ? " dirty" : "")}
                    onClick={onRun}
                    disabled={loading}
                    title={inputsDirty ? "Inputs changed — re-run to update the output" : "Re-run (inputs unchanged)"}
                  >
                    <Icon name="run" size={15} /> {loading ? "Running…" : "Re-run"}
                  </button>
                  <button className="btn btn-run btn-icon" onClick={onOutput} disabled={loading}>
                    Output <Icon name="output" size={15} />
                  </button>
                </>
              )}
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

        {confirmOutput && (
          <div className="modal-overlay" onClick={() => setConfirmOutput(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-title">View output?</div>
              <div className="modal-body">
                Your input changes haven't been re-run, so they won't be reflected in the output and
                won't be saved. View the last run's output anyway?
              </div>
              <div className="modal-actions">
                <button className="btn" onClick={() => setConfirmOutput(false)}>Cancel</button>
                <button className="btn btn-run" onClick={confirmViewOutput}>View output</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
