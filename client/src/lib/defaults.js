import { uid } from "./util.js";
import { CURRENT_SCHEMA } from "./migrate.js";

// Models now start empty — the analyst creates their own variables and folders.
export function makeDefaultModel() {
  return {
    id: null,
    name: "Untitled model",
    company: "",
    ticker: "",
    thesis: "",
    variables: [],
    folders: [],
    formula: { output: null, rhs: [] },
    auxFormulas: [],
    units: {},
    inputOrder: [],
    schemaVersion: CURRENT_SCHEMA,
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
