import { uid } from "./util.js";

// The starter model matches the worked example: the classic
//   Valuation = Free Cash Flow × Future Multiple ÷ Future Share Count
// Every block gets a stable id so the formula tokens can reference it.
export function makeDefaultModel() {
  const fcf = { id: uid(), name: "Free Cash Flow" };
  const mult = { id: uid(), name: "Future Multiple" };
  const shares = { id: uid(), name: "Future Share Count" };
  const val = { id: uid(), name: "Valuation" };

  return {
    id: null,
    name: "Free-cash-flow valuation",
    company: "",
    ticker: "",
    thesis: "",
    blocks: [fcf, mult, shares, val],
    formula: {
      output: val.id,
      rhs: [
        { id: uid(), type: "variable", blockId: fcf.id },
        { id: uid(), type: "op", op: "*" },
        { id: uid(), type: "variable", blockId: mult.id },
        { id: uid(), type: "op", op: "/" },
        { id: uid(), type: "variable", blockId: shares.id },
      ],
    },
    auxFormulas: [],
    units: { [fcf.id]: 1e9, [shares.id]: 1e6 },
  };
}

export function makeEmptyModel() {
  const val = { id: uid(), name: "Result" };
  return {
    id: null,
    name: "Untitled model",
    company: "",
    ticker: "",
    thesis: "",
    blocks: [val],
    formula: { output: val.id, rhs: [] },
    auxFormulas: [],
    units: {},
  };
}

export const OPERATORS = [
  { op: "*", label: "×" },
  { op: "/", label: "÷" },
  { op: "+", label: "+" },
  { op: "-", label: "−" },
  { op: "(", label: "(" },
  { op: ")", label: ")" },
];
