import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth } from "../middleware/auth.js";
import { retrieve } from "../rag/store.js";

const router = Router();

const MODEL = process.env.MODEL || "claude-opus-4-8";
const MOCK = process.env.MOCK === "1";
const hasKey = !!process.env.ANTHROPIC_API_KEY;
const anthropic = hasKey ? new Anthropic() : null;

export const runtimeInfo = { model: MODEL, hasKey, mock: MOCK };

// Force a single tool call whose schema IS the scenario grid, so the model must
// return one estimate + justification per input variable per scenario.
const submitTool = {
  name: "submit_scenarios",
  description:
    "Return an estimate for every input variable, for every alternative scenario. " +
    "Include one entry per input variable for each scenario — no more, no fewer — " +
    "using the exact variable names provided.",
  input_schema: {
    type: "object",
    properties: {
      scenarios: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "The scenario name, copied verbatim." },
            variables: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string", description: "The input variable name, copied verbatim." },
                  value: { type: "number", description: "Numeric estimate under this scenario." },
                  justification: { type: "string", description: "One or two sentences of reasoning." },
                },
                required: ["name", "value", "justification"],
              },
            },
          },
          required: ["name", "variables"],
        },
      },
    },
    required: ["scenarios"],
  },
};

function ragBlock(passages) {
  if (!passages || !passages.length) return "";
  const body = passages
    .map((h, i) => `[${i + 1}] (${h.source}) ${h.text}`)
    .join("\n\n");
  return `\nRELEVANT PRINCIPLES FROM PETER LYNCH (for grounding — apply the ideas, don't quote at length):\n${body}\n`;
}

function buildPrompt(p, passages) {
  const varLines = p.variables
    .map((v) => {
      const base = p.baseValues?.[v.id];
      const shown = base === undefined || base === null || base === "" ? "(not provided)" : base;
      return `  - ${v.name}: median/base estimate = ${shown}`;
    })
    .join("\n");
  const scenarioLines = p.scenarios
    .map((s, i) => `  ${i + 1}. ${s.name}${s.description ? ` — ${s.description}` : ""}`)
    .join("\n");

  return `You are a disciplined equity-valuation assistant helping an analyst run a "back-of-the-envelope" scenario analysis. Stay grounded — anchor every estimate to the analyst's own median case and adjust it for the scenario; do not invent precise figures you cannot support.

COMPANY: ${p.company || "(unspecified)"}${p.ticker ? ` (${p.ticker})` : ""}
${p.thesis ? `\nANALYST THESIS / CONTEXT:\n${p.thesis}\n` : ""}
THE VALUATION FORMULA (use this exact structure for every scenario):
  ${p.formulaText}

INPUT VARIABLES AND THE ANALYST'S MEDIAN/BASE ESTIMATES:
${varLines}

ALTERNATIVE SCENARIOS TO EVALUATE:
${scenarioLines}
${ragBlock(passages)}
For each scenario, provide your own estimate for EVERY input variable above, adjusting the median figures for that scenario's conditions and keeping units/magnitudes consistent. Then call submit_scenarios exactly once with all scenarios, including a short justification per variable.`;
}

function mockScenarios(payload) {
  const factor = { bull: 1.25, bear: 0.78 };
  return payload.scenarios.map((s) => {
    const key = /bear|down|reces|worst/i.test(s.name + s.description)
      ? "bear"
      : /bull|up|best|optimi/i.test(s.name + s.description)
      ? "bull"
      : "bull";
    const f = factor[key];
    const values = {};
    const notes = {};
    for (const v of payload.variables) {
      const base = parseFloat(payload.baseValues?.[v.id]);
      const b = Number.isNaN(base) ? 1 : base;
      const isShares = /share|count|dilut/i.test(v.name);
      values[v.id] = isShares ? +(b / f).toPrecision(4) : +(b * f).toPrecision(4);
      notes[v.id] = `Demo estimate: ${v.name} scaled ${key === "bull" ? "up" : "down"} for "${s.name}". Add a real ANTHROPIC_API_KEY for genuine reasoning.`;
    }
    return { name: s.name, values, notes };
  });
}

router.post("/run", requireAuth, async (req, res) => {
  try {
    const payload = req.body || {};
    if (!Array.isArray(payload.variables) || payload.variables.length === 0)
      return res.status(400).json({ error: "No input variables were provided." });
    if (!Array.isArray(payload.scenarios) || payload.scenarios.length === 0)
      return res.status(400).json({ error: "No alternative scenarios were provided." });

    if (MOCK) return res.json({ scenarios: mockScenarios(payload), model: "demo-mock", mock: true });

    if (!anthropic)
      return res.status(400).json({
        error: "No Anthropic API key configured. Add ANTHROPIC_API_KEY to server/.env (or set MOCK=1 for demo mode).",
      });

    // Ground the reasoning in relevant Lynch passages (best-effort).
    let passages = [];
    try {
      const q = [payload.thesis, ...payload.scenarios.map((s) => `${s.name} ${s.description}`)].join(" ");
      passages = await retrieve(q, 6);
    } catch (e) {
      console.warn("RAG retrieve failed (continuing without):", e.message);
    }

    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      tools: [submitTool],
      tool_choice: { type: "tool", name: "submit_scenarios" },
      messages: [{ role: "user", content: buildPrompt(payload, passages) }],
    });

    const toolUse = message.content.find((b) => b.type === "tool_use");
    if (!toolUse) return res.status(502).json({ error: "The model did not return a structured result." });

    const byName = new Map(payload.variables.map((v) => [v.name.trim().toLowerCase(), v.id]));
    const scenarios = (toolUse.input.scenarios || []).map((s) => {
      const values = {};
      const notes = {};
      for (const entry of s.variables || []) {
        const id = byName.get(String(entry.name || "").trim().toLowerCase());
        if (id) {
          values[id] = entry.value;
          notes[id] = entry.justification || "";
        }
      }
      return { name: s.name, values, notes };
    });

    res.json({ scenarios, model: MODEL, usage: message.usage });
  } catch (err) {
    console.error("Run failed:", err);
    res.status(err?.status || 500).json({ error: err?.message || "Unexpected server error." });
  }
});

export default router;
