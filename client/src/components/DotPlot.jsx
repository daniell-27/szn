import React, { useState } from "react";
import { formatNumber } from "../lib/evaluate.js";

// A 1-D dot (strip) plot of each scenario's output value, with hover labels.
export default function DotPlot({ points }) {
  const [hover, setHover] = useState(null);
  const pts = points.filter((p) => p.value !== null && p.value !== undefined && !Number.isNaN(p.value));
  if (pts.length === 0) return null;

  const W = 720, H = 96, padX = 40, axisY = 62;
  const vals = pts.map((p) => p.value);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (lo === hi) { lo -= 1; hi += 1; } // avoid divide-by-zero for identical values
  const x = (v) => padX + ((v - lo) / (hi - lo)) * (W - 2 * padX);

  const ticks = [lo, (lo + hi) / 2, hi];

  return (
    <div className="dotplot card">
      <div className="card-title">Valuation spread</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="dotplot-svg" preserveAspectRatio="xMidYMid meet">
        <line x1={padX} y1={axisY} x2={W - padX} y2={axisY} className="dp-axis" />
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={x(t)} y1={axisY - 4} x2={x(t)} y2={axisY + 4} className="dp-axis" />
            <text x={x(t)} y={axisY + 18} className="dp-tick" textAnchor="middle">{formatNumber(t)}</text>
          </g>
        ))}
        {pts.map((p, i) => (
          <circle
            key={i}
            cx={x(p.value)}
            cy={axisY}
            r={hover === i ? 8 : 6}
            className={"dp-dot" + (p.isMedian ? " dp-median" : "")}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover((h) => (h === i ? null : h))}
          >
            <title>{`${p.name}: ${formatNumber(p.value)}`}</title>
          </circle>
        ))}
        {hover !== null && pts[hover] && (
          <g className="dp-label" transform={`translate(${x(pts[hover].value)}, ${axisY - 16})`}>
            <text textAnchor="middle" className="dp-label-text">
              {pts[hover].name} · {formatNumber(pts[hover].value)}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
