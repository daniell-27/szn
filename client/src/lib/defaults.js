import { uid } from "./util.js";

// Models now start empty — the analyst creates their own blocks and folders.
export function makeDefaultModel() {
  return {
    id: null,
    name: "Untitled model",
    company: "",
    ticker: "",
    thesis: "",
    blocks: [],
    folders: [],
    formula: { output: null, rhs: [] },
    auxFormulas: [],
    units: {},
    inputOrder: [],
  };
}

export const makeEmptyModel = makeDefaultModel;

export const OPERATORS = [
  { op: "*", label: "×" },
  { op: "/", label: "÷" },
  { op: "+", label: "+" },
  { op: "-", label: "−" },
  { op: "^", label: "^" },
  { op: "%", label: "%" },
  { op: "(", label: "(" },
  { op: ")", label: ")" },
];

export const FUNCTION_NAMES = ["SQRT", "LN", "LOG", "EXP", "ABS", "ROUND"];
