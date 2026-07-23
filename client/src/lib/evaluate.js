// One formula evaluator, used for the analyst's median case AND every scenario.
// The same code path runs for all of them, so the output is computed in the
// identical "format" for every column — which is the whole point.
//
// A model now has a MAIN formula plus optional AUXILIARY formulas. Each auxiliary
// formula defines one of the main formula's input variables in terms of other
// (leaf) variables. "Free" inputs are the leaf variables the user/AI supply.

const PRECEDENCE = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2, "^": 3 };
const RIGHT_ASSOC = { "^": true };
const OP_SYM = { "*": "×", "/": "÷", "+": "+", "-": "−", "^": "^", "%": "%", "(": "(", ")": ")" };

// Supported unary functions. (MIN/MAX need multiple args — a later addition.)
export const FUNCTIONS = {
  SQRT: (x) => Math.sqrt(x),
  LN: (x) => Math.log(x),
  LOG: (x) => Math.log10(x),
  EXP: (x) => Math.exp(x),
  ABS: (x) => Math.abs(x),
  ROUND: (x) => Math.round(x),
};

const nameOf = (id, variables) => variables.find((b) => b.id === id)?.name ?? "?";

function tokenText(t, variables) {
  if (t.type === "variable") return nameOf(t.variableId, variables);
  if (t.type === "const") return String(t.value);
  if (t.type === "func") return t.name;
  return OP_SYM[t.op] || t.op;
}

// A single formula's right-hand side as text, e.g. "Free Cash Flow × Future Multiple".
export function rhsToText(rhs, variables) {
  return (rhs || []).map((t) => tokenText(t, variables)).join(" ");
}

// The main formula as "Output = expression".
export function formulaToText(formula, variables) {
  const out = formula.output ? nameOf(formula.output, variables) : "Result";
  return `${out} = ${rhsToText(formula.rhs, variables) || "…"}`;
}

// Full multi-line description including auxiliary definitions (for the AI prompt).
export function modelToText(model) {
  const lines = [formulaToText(model.formula, model.variables)];
  for (const f of model.auxFormulas || []) {
    if (f.output && (f.rhs || []).length) {
      lines.push(`  where ${nameOf(f.output, model.variables)} = ${rhsToText(f.rhs, model.variables)}`);
    }
  }
  return lines.join("\n");
}

export function auxOutputIds(model) {
  return (model.auxFormulas || []).map((f) => f.output).filter(Boolean);
}

// The variables the user/AI must supply values for: every variable used anywhere
// that isn't the main output and isn't defined by an auxiliary formula.
export function freeInputIds(model) {
  const auxOut = new Set(auxOutputIds(model));
  const mainOut = model.formula.output;
  const ids = [];
  const consider = (rhs) => {
    for (const t of rhs || []) {
      if (t.type === "variable") {
        const b = t.variableId;
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

// Shunting-yard: token list -> RPN. null if malformed. Handles variables,
// constants, unary functions, parentheses, and the binary operators.
function toRPN(tokens) {
  const output = [];
  const ops = [];
  const top = () => ops[ops.length - 1];
  for (const t of tokens) {
    if (t.type === "variable" || t.type === "const") {
      output.push(t);
    } else if (t.type === "func") {
      ops.push(t);
    } else if (t.op === "(") {
      ops.push(t);
    } else if (t.op === ")") {
      let found = false;
      while (ops.length) {
        const o = ops.pop();
        if (o.op === "(") { found = true; break; }
        output.push(o);
      }
      if (!found) return null;
      if (top() && top().type === "func") output.push(ops.pop());
    } else {
      // binary operator
      while (
        ops.length && top().op !== "(" &&
        (top().type === "func" ||
          PRECEDENCE[top().op] > PRECEDENCE[t.op] ||
          (PRECEDENCE[top().op] === PRECEDENCE[t.op] && !RIGHT_ASSOC[t.op]))
      ) {
        output.push(ops.pop());
      }
      ops.push(t);
    }
  }
  while (ops.length) {
    const o = ops.pop();
    if (o.op === "(") return null;
    output.push(o);
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
    if (t.type === "const") {
      stack.push(Number(t.value));
    } else if (t.type === "variable") {
      const raw = values[t.variableId];
      const n = typeof raw === "number" ? raw : parseFloat(raw);
      if (raw === undefined || raw === null || raw === "" || Number.isNaN(n)) {
        return { value: null, error: "Missing input" };
      }
      stack.push(n);
    } else if (t.type === "func") {
      const fn = FUNCTIONS[t.name];
      const a = stack.pop();
      if (!fn || a === undefined) return { value: null, error: "Malformed formula" };
      const r = fn(a);
      if (Number.isNaN(r) || !Number.isFinite(r)) return { value: null, error: `${t.name} is undefined here` };
      stack.push(r);
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
        case "^": stack.push(Math.pow(a, b)); break;
        case "%":
          if (b === 0) return { value: null, error: "Modulo by zero" };
          stack.push(a % b);
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

// Parse a typed fragment (operators, numbers, function names) into partial
// tokens (no ids). Variables can't be typed (names have spaces) — drag those.
export function parseTyped(str) {
  const out = [];
  const re = /\s*(\d+\.?\d*|\.\d+|[A-Za-z]+|[+\-*/^%()])/g;
  let m;
  let ok = true;
  let consumed = 0;
  while ((m = re.exec(str))) {
    consumed += m[0].length;
    const tok = m[1];
    if (/^[\d.]/.test(tok)) out.push({ type: "const", value: Number(tok) });
    else if (/^[+\-*/^%()]$/.test(tok)) out.push({ type: "op", op: tok });
    else {
      const up = tok.toUpperCase();
      if (FUNCTIONS[up]) out.push({ type: "func", name: up });
      else ok = false;
    }
  }
  if (consumed < str.replace(/\s/g, "").length) ok = false;
  return { tokens: out, ok };
}

export const UNITS = [
  { label: "—", value: 1 },
  { label: "Thousand", value: 1e3 },
  { label: "Million", value: 1e6 },
  { label: "Billion", value: 1e9 },
  { label: "Trillion", value: 1e12 },
];
