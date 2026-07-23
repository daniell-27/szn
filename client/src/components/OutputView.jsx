import React, { useState } from "react";
import { resolveTyped, freeInputIds, formulaToText, formatNumber, UNITS } from "../lib/evaluate.js";
import StickyNote from "./StickyNote.jsx";
import DotPlot from "./DotPlot.jsx";
import Icon from "./Icon.jsx";
import * as api from "../lib/api.js";

const unitLabel = (mult) => UNITS.find((u) => u.value === mult)?.label || "";

export default function OutputView({ model, baseValues, setBaseValues, result, setResult, onBack }) {
  const inputIds = freeInputIds(model);
  const units = model.units || {};
  const nameFor = (id) => (model.variables || []).find((b) => b.id === id)?.name ?? "?";
  const outName = model.formula.output ? nameFor(model.formula.output) : "Result";

  const baseOut = resolveTyped(model, baseValues);

  function editBase(id, v) {
    setBaseValues({ ...baseValues, [id]: v });
  }
  function editScenario(idx, id, v) {
    const scenarios = result.scenarios.map((s, i) =>
      i === idx ? { ...s, values: { ...s.values, [id]: v } } : s
    );
    setResult({ ...result, scenarios });
  }

  const scenarioOut = (s) => resolveTyped(model, s.values);

  // ---- RAG-grounded feedback on the analyst's reasoning ----
  const [fbOpen, setFbOpen] = useState(false);
  const [fbLoading, setFbLoading] = useState(false);
  const [fbError, setFbError] = useState("");
  const feedback = result.feedback;
  const sources = result.feedbackSources || [];

  async function toggleFeedback() {
    const next = !fbOpen;
    setFbOpen(next);
    if (next && !feedback && !fbLoading) {
      setFbLoading(true);
      setFbError("");
      try {
        const data = await api.getFeedback({
          company: model.company,
          ticker: model.ticker,
          thesis: model.thesis,
          scenarios: result.scenarios.map((s) => ({ name: s.name, description: s.description || "" })),
        });
        setResult({ ...result, feedback: data.feedback, feedbackSources: data.sources });
      } catch (e) {
        setFbError(e.message);
      } finally {
        setFbLoading(false);
      }
    }
  }

  const dotPoints = [
    { name: "Median", value: baseOut.value, isMedian: true },
    ...result.scenarios.map((s) => ({ name: s.name, value: scenarioOut(s).value })),
  ];

  const outs = dotPoints.map((p) => p.value).filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
  const low = outs.length ? Math.min(...outs) : null;
  const high = outs.length ? Math.max(...outs) : null;

  const colHeader = (id) => {
    const u = unitLabel(units[id] || 1);
    return u ? `${nameFor(id)} (${u})` : nameFor(id);
  };

  return (
    <div className="output-view">
      <div className="output-head">
        <button className="btn btn-icon" onClick={onBack}><Icon name="back" /> Back to inputs</button>
        <div className="formula-readout">{formulaToText(model.formula, model.variables)}</div>
      </div>

      {low !== null && (
        <div className="range-banner">
          Valuation range across {outs.length} scenarios:&nbsp;
          <strong>{formatNumber(low)}</strong> — <strong>{formatNumber(high)}</strong>
        </div>
      )}

      <DotPlot points={dotPoints} />

      <div className="grid-scroll">
        <table className="grid">
          <thead>
            <tr>
              <th className="col-scenario">Scenario</th>
              <th className="col-output">{outName}</th>
              <th className="col-eq"></th>
              {inputIds.map((id) => (
                <th key={id} className="col-var">{colHeader(id)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="row-median">
              <td className="col-scenario"><span className="badge badge-median">Median</span> your estimate</td>
              <td className="col-output"><span className="output-value">{formatNumber(baseOut.value)}</span></td>
              <td className="col-eq">=</td>
              {inputIds.map((id) => (
                <td key={id} className="col-var">
                  <input className="cell-input" value={baseValues[id] ?? ""} onChange={(e) => editBase(id, e.target.value)} />
                </td>
              ))}
            </tr>

            <tr className="row-feedback">
              <td colSpan={3 + inputIds.length}>
                <div className="feedback-block">
                  <button className="feedback-toggle" onClick={toggleFeedback}>
                    <Icon name={fbOpen ? "minus" : "plus"} />
                    <span>Model feedback on your reasoning</span>
                  </button>
                  {fbOpen && (
                    <div className="feedback-body">
                      {fbLoading && <div className="feedback-loading">Reviewing your thesis against Peter Lynch's principles…</div>}
                      {fbError && <div className="banner banner-error">{fbError}</div>}
                      {feedback && <div className="feedback-text">{feedback}</div>}
                      {feedback && sources.length > 0 && (
                        <div className="feedback-sources">Grounded in: {sources.join(", ")}</div>
                      )}
                    </div>
                  )}
                </div>
              </td>
            </tr>

            {result.scenarios.map((s, idx) => {
              const out = scenarioOut(s);
              return (
                <tr key={idx}>
                  <td className="col-scenario">{s.name}</td>
                  <td className="col-output"><span className="output-value">{formatNumber(out.value)}</span></td>
                  <td className="col-eq">=</td>
                  {inputIds.map((id) => (
                    <td key={id} className="col-var">
                      <div className="cell-wrap">
                        <input className="cell-input" value={s.values[id] ?? ""} onChange={(e) => editScenario(idx, id, e.target.value)} />
                        <StickyNote note={s.notes?.[id]} label={`${nameFor(id)} · ${s.name}`} />
                      </div>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="hint">Edit any estimate to see its scenario's output recalculate. The note icon opens the model's reasoning.</div>
    </div>
  );
}
