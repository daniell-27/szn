import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth } from "../middleware/auth.js";
import { retrieve } from "../rag/store.js";

const router = Router();
const MODEL = process.env.MODEL || "claude-opus-4-8";
const MOCK = process.env.MOCK === "1";
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

function buildPrompt(p, passages) {
  const scenarioLines = (p.scenarios || [])
    .map((s, i) => `  ${i + 1}. ${s.name}${s.description ? `: ${s.description}` : " (no description)"}`)
    .join("\n");
  const ref = passages.length
    ? "\nRELEVANT PRINCIPLES FROM PETER LYNCH (ground your feedback in these ideas; you may cite a book by name, but do not quote at length):\n" +
      passages.map((h, i) => `[${i + 1}] (${h.source}) ${h.text}`).join("\n\n")
    : "";

  return `You are a sharp, constructive investing coach reviewing an analyst's reasoning through the lens of Peter Lynch's principles. Assess the THESIS and the SCENARIO DESCRIPTIONS below — not the numbers, the reasoning. Point out where the logic is sound, where it's thin or hand-wavy, what a Lynch-style investor would push back on, and what important considerations or risks are missing. Be specific and concise (a few short paragraphs or tight bullets). Where a Lynch idea applies, name it. Don't flatter; if the reasoning is weak, say so and say why.

COMPANY: ${p.company || "(unspecified)"}${p.ticker ? ` (${p.ticker})` : ""}

THESIS:
${p.thesis?.trim() || "(no thesis provided)"}

ALTERNATIVE SCENARIOS:
${scenarioLines || "(none)"}
${ref}

Write the feedback as plain prose/bullets (no preamble like "Here is my feedback").`;
}

function mockFeedback(p) {
  return {
    feedback:
      `Demo feedback (add an ANTHROPIC_API_KEY for the real thing):\n\n` +
      `• Your thesis for ${p.company || "this company"} leans on "reliable growth" — Lynch would ask you to pin down the category (stalwart vs. fast grower) and whether the P/E you're paying is justified by the actual growth rate (the PEG check).\n` +
      `• The bull case is optimistic on the multiple expanding; Lynch warns that multiple expansion is the least reliable driver — make sure the earnings growth alone supports the case.\n` +
      `• The bear case doesn't mention what would actually break the story (competition, debt, a stalling core business). Name the specific impediment you'd watch for.`,
    sources: ["One Up on Wall Street", "Beating the Street"],
  };
}

router.post("/feedback", requireAuth, async (req, res) => {
  try {
    const p = req.body || {};
    if (MOCK) return res.json(mockFeedback(p));
    if (!anthropic)
      return res.status(400).json({ error: "No Anthropic API key configured (or set MOCK=1 for demo mode)." });

    let passages = [];
    try {
      const q = [p.thesis, ...(p.scenarios || []).map((s) => `${s.name} ${s.description}`)].join(" ");
      passages = await retrieve(q, 6);
    } catch (e) {
      console.warn("RAG retrieve failed (continuing):", e.message);
    }

    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      messages: [{ role: "user", content: buildPrompt(p, passages) }],
    });
    const feedback = message.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    const sources = [...new Set(passages.map((h) => h.source))];
    res.json({ feedback, sources });
  } catch (err) {
    console.error("Feedback failed:", err);
    res.status(err?.status || 500).json({ error: err?.message || "Feedback failed." });
  }
});

export default router;
