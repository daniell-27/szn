// One formula evaluator, used for the analyst's median case AND every scenario.
// The same code path runs for all of them, so the output is computed in the
// identical "format" for every column — which is the whole point.
//
// A model now has a MAIN formula plus optional AUXILIARY formulas. Each auxiliary
// formula defines one of the main formula's input blocks in terms of other
// (leaf) blocks. "Free" inputs are the leaf blocks the user/AI actually supply.

const PRECEDENCE = { "+": 1, "-": 1, "*": 2, "/": 2 };
const OP_SYM = { "*": "×", "/": "÷", "+": "+", "-": "−", "(": "(", ")": ")" };

const nameOf = (id, blocks) => blocks.find((b) => b.id === id)?.name ?? "?";

// A single formula's right-hand side as text, e.g. "Free Cash Flow × Future Multiple".
export function rhsToText(rhs, blocks) {
  return (rhs || [])
    .map((t) => (t.type === "variable" ? nameOf(t.blockId, blocks) : OP_SYM[t.op] || t.op))
    .join(" ");
}

// The main formula as "Output = expression".
export function formulaToText(formula, blocks) {
  const out = formula.output ? nameOf(formula.output, blocks) : "Result";
  return `${out} = ${rhsToText(formula.rhs, blocks) || "…"}`;
}

// Full multi-line description including auxiliary definitions (for the AI prompt).
export function modelToText(model) {
  const lines = [formulaToText(model.formula, model.blocks)];
  for (const f of model.auxFormulas || []) {
    if (f.output && (f.rhs || []).length) {
      lines.push(`  where ${nameOf(f.output, model.blocks)} = ${rhsToText(f.rhs, model.blocks)}`);
    }
  }
  return lines.join("\n");
}

export function auxOutputIds(model) {
  return (model.auxFormulas || []).map((f) => f.output).filter(Boolean);
}

// The blocks the user/AI must supply values for: every variable used anywhere
// that isn't the main output and isn't defined by an auxiliary formula.
export function freeInputIds(model) {
  const auxOut = new Set(auxOutputIds(model));
  const mainOut = model.formula.output;
  const ids = [];
  const consider = (rhs) => {
    for (const t of rhs || []) {
      if (t.type === "variable") {
        const b = t.blockId;
        if (b !== mainOut && !auxOut.has(b) && !ids.includes(b)) ids.push(b);
      }
    }
  };
  consider(model.formula.rhs);
  for (const f of model.auxFormulas || []) consider(f.rhs);
  return ids;
}

// Back-compat alias (older code called this).
export const inputVariableIds = (formula) =>
  freeInputIds({ formula, auxFormulas: [] });

// Shunting-yard: token list -> RPN. null if malformed.
function toRPN(tokens) {
  const output = [];
  const ops = [];
  for (const t of tokens) {
    if (t.type === "variable") {
      output.push(t);
    } else if (t.op === "(") {
      ops.push(t);
    } else if (t.op === ")") {
      let found = false;
      while (ops.length) {
        const top = ops.pop();
        if (top.op === "(") { found = true; break; }
        output.push(top);
      }
      if (!found) return null;
    } else {
      while (
        ops.length &&
        ops[ops.length - 1].op !== "(" &&
        PRECEDENCE[ops[ops.length - 1].op] >= PRECEDENCE[t.op]
      ) {
        output.push(ops.pop());
      }
      ops.push(t);
    }
  }
  while (ops.length) {
    const top = ops.pop();
    if (top.op === "(") return null;
    output.push(top);
  }
  return output;
}

// Evaluate one formula's right-hand side given a map of blockId -> number.
export function evaluateFormula(formula, values) {
  const tokens = formula.rhs || [];
  if (tokens.length === 0) return { value: null, error: "Empty formula" };
  const rpn = toRPN(tokens);
  if (!rpn) return { value: null, error: "Unbalanced parentheses" };

  const stack = [];
  for (const t of rpn) {
    if (t.type === "variable") {
      const raw = values[t.blockId];
      const n = typeof raw === "number" ? raw : parseFloat(raw);
      if (raw === undefined || raw === null || raw === "" || Number.isNaN(n)) {
        return { value: null, error: "Missing input" };
      }
      stack.push(n);
    } else {
      const b = stack.pop();
      const a = stack.pop();
      if (a === undefined || b === undefined) return { value: null, error: "Malformed formula" };
      switch (t.op) {
        case "+": stack.push(a + b); break;
        case "-": stack.push(a - b); break;
        case "*": stack.push(a * b); break;
        case "/":
          if (b === 0) return { value: null, error: "Division by zero" };
          stack.push(a / b);
          break;
        default: return { value: null, error: "Unknown operator" };
      }
    }
  }
  if (stack.length !== 1) return { value: null, error: "Malformed formula" };
  return { value: stack[0], error: null };
}

// Convert typed input values (in each variable's unit) to raw numbers.
export function toRaw(typedMap, units, ids) {
  const out = {};
  for (const id of ids) {
    const raw = typedMap?.[id];
    const n = typeof raw === "number" ? raw : parseFloat(raw);
    if (raw === undefined || raw === null || raw === "" || Number.isNaN(n)) continue;
    out[id] = n * (units?.[id] || 1);
  }
  return out;
}

// Resolve auxiliary formulas (in dependency order) then the main formula.
// rawFree: { blockId -> raw number } for the free inputs.
export function resolveModel(model, rawFree) {
  const values = { ...rawFree };
  let remaining = (model.auxFormulas || []).filter((f) => f.output && (f.rhs || []).length);
  let progress = true;
  while (remaining.length && progress) {
    progress = false;
    const still = [];
    for (const f of remaining) {
      const r = evaluateFormula(f, values);
      if (r.value !== null && !r.error) { values[f.output] = r.value; progress = true; }
      else still.push(f);
    }
    remaining = still;
  }
  const main = evaluateFormula(model.formula, values);
  return { value: main.value, error: main.error, derived: values };
}

// Convenience: resolve straight from typed values + units.
export function resolveTyped(model, typedFree) {
  const ids = freeInputIds(model);
  return resolveModel(model, toRaw(typedFree, model.units, ids));
}

// Compact human formatting for output values (e.g. 12300000000 -> "12.3B").
export function formatNumber(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(2)}K`;
  if (abs >= 1) return `${sign}${abs.toFixed(2)}`;
  return `${sign}${abs.toPrecision(3)}`;
}

export const UNITS = [
  { label: "—", value: 1 },
  { label: "Thousand", value: 1e3 },
  { label: "Million", value: 1e6 },
  { label: "Billion", value: 1e9 },
  { label: "Trillion", value: 1e12 },
];
