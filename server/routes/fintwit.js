import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL = process.env.MODEL || "claude-opus-4-8";
const MOCK = process.env.MOCK === "1";
const BEARER = process.env.X_BEARER_TOKEN; // paid X/Twitter API bearer token (recent search, 7-day window)
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

// Optional third-party historical provider. X's own /search/all (full archive)
// is Enterprise-only (~$42K/mo), so to reach back months we support a cheaper
// third-party search API behind env vars. Default request/response mapping
// targets a twitterapi.io-style advanced-search endpoint; adjust FINTWIT_ARCHIVE_*
// for a different provider. When unset, we fall back to X recent search (7 days).
const ARCHIVE_KEY = process.env.FINTWIT_ARCHIVE_KEY;
const ARCHIVE_URL = process.env.FINTWIT_ARCHIVE_URL || "https://api.twitterapi.io/twitter/tweet/advanced_search";
const ARCHIVE_ENABLED = !!ARCHIVE_KEY;
// How far back to consider a post "current". Archive provider defaults to 180
// days; plain X recent search is hard-capped at 7 by the API regardless.
const LOOKBACK_DAYS = Math.max(1, parseInt(process.env.FINTWIT_LOOKBACK_DAYS || (ARCHIVE_ENABLED ? "180" : "7"), 10));

export const fintwitEnabled = !!BEARER || ARCHIVE_ENABLED || MOCK;

// Curated accounts: env override, else the config file.
function curatedAccounts() {
  if (process.env.FINTWIT_ACCOUNTS) {
    return process.env.FINTWIT_ACCOUNTS.split(",").map((s) => s.trim().replace(/^@/, "")).filter(Boolean);
  }
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "../config/fintwit-accounts.json"), "utf8"));
    return cfg.accounts || [];
  } catch {
    return [];
  }
}

// Relevance clause: match the cashtag ($TSLA), the bare ticker, and the company
// name. Cashtags are how Fintwit accounts actually reference stocks, so matching
// only the plain name/ticker (the old behavior) missed most relevant posts.
function mentionClause(symbol, company) {
  const terms = [];
  if (symbol) terms.push(`$${symbol}`, symbol);
  if (company) terms.push(`"${company}"`);
  return terms.length ? ` (${terms.join(" OR ")})` : "";
}

function fromClause(accounts) {
  return `(${accounts.map((a) => `from:${a}`).join(" OR ")})`;
}

const sinceDate = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

// ---- X recent search (7-day window) ----
async function fetchRecent(accounts, symbol, company) {
  const query = `${fromClause(accounts)}${mentionClause(symbol, company)} -is:retweet`;
  const url = new URL("https://api.twitter.com/2/tweets/search/recent");
  url.searchParams.set("query", query);
  url.searchParams.set("max_results", "50");
  url.searchParams.set("tweet.fields", "author_id,created_at");
  url.searchParams.set("expansions", "author_id");
  url.searchParams.set("user.fields", "username,name");

  const res = await fetch(url, { headers: { Authorization: `Bearer ${BEARER}` } });
  if (!res.ok) throw new Error(`X API error (HTTP ${res.status}). ${res.status === 429 ? "Rate limit reached." : ""}`);
  const data = await res.json();
  const users = new Map((data.includes?.users || []).map((u) => [u.id, u]));
  return (data.data || [])
    .map((t) => {
      const u = users.get(t.author_id);
      return u ? { username: u.username, name: u.name, text: t.text } : null;
    })
    .filter(Boolean);
}

// ---- third-party historical search (up to LOOKBACK_DAYS) ----
async function fetchArchive(accounts, symbol, company) {
  const query = `${fromClause(accounts)}${mentionClause(symbol, company)} -filter:retweets since:${sinceDate(LOOKBACK_DAYS)}`;
  const url = new URL(ARCHIVE_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("queryType", "Latest");

  const res = await fetch(url, { headers: { "X-API-Key": ARCHIVE_KEY, Accept: "application/json" } });
  if (!res.ok) throw new Error(`Fintwit archive provider error (HTTP ${res.status}).`);
  const data = await res.json();
  const tweets = data.tweets || data.data || [];
  return tweets
    .map((t) => {
      const username = t.author?.userName || t.author?.username || t.username;
      const name = t.author?.name || t.name || username;
      const text = t.text || t.full_text || "";
      return username && text ? { username, name, text } : null;
    })
    .filter(Boolean);
}

// Group flat tweets by author, most-active first, cap the payload size.
function groupByAuthor(tweets) {
  const byAuthor = new Map();
  for (const t of tweets) {
    if (!byAuthor.has(t.username)) byAuthor.set(t.username, { handle: t.username, name: t.name, tweets: [] });
    byAuthor.get(t.username).tweets.push(t.text);
  }
  return [...byAuthor.values()]
    .sort((a, b) => b.tweets.length - a.tweets.length)
    .slice(0, 5)
    .map((i) => ({ ...i, tweets: i.tweets.slice(0, 6) }));
}

// Query whichever source is configured (archive preferred for reach) for tweets
// from the curated accounts about the company, grouped by author.
async function fetchInfluencers(symbol, company) {
  const accounts = curatedAccounts().slice(0, 20);
  if (!accounts.length) return [];
  const tweets = ARCHIVE_ENABLED
    ? await fetchArchive(accounts, symbol, company)
    : await fetchRecent(accounts, symbol, company);
  return groupByAuthor(tweets);
}

function mockInfluencers(symbol) {
  return [
    { handle: "unusual_whales", name: "unusual_whales", tweets: [`Flow into ${symbol} calls has been heavy; someone's positioning for a beat.`, `${symbol} membership renewals look sticky per card data.`] },
    { handle: "awealthofcs", name: "A Wealth of Common Sense", tweets: [`${symbol} is the definition of a boring compounder — buy-and-hold quality.`] },
  ];
}

// ---- list relevant influencers ----
router.get("/fintwit", requireAuth, async (req, res) => {
  const symbol = String(req.query.symbol || "").trim().toUpperCase();
  const company = String(req.query.company || "").trim();
  try {
    if (MOCK) return res.json({ influencers: mockInfluencers(symbol || "COST") });
    if (!BEARER && !ARCHIVE_ENABLED)
      return res.status(400).json({ error: "No X_BEARER_TOKEN or FINTWIT_ARCHIVE_KEY configured for the Fintwit feature." });
    if (!symbol && !company) return res.json({ influencers: [] });
    res.json({ influencers: await fetchInfluencers(symbol, company), lookbackDays: LOOKBACK_DAYS });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---- summarize one influencer's stance into a scenario ----
const scenarioTool = {
  name: "submit_fintwit_scenario",
  description: "Summarize the influencer's implied view for this company into an alternative valuation scenario.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Short scenario name attributing the view (e.g. '@handle: sticky renewals')." },
      description: { type: "string", description: "2-4 sentences describing the future this influencer implies for the company's key inputs." },
    },
    required: ["name", "description"],
  },
};

router.post("/fintwit/scenario", requireAuth, async (req, res) => {
  const p = req.body || {};
  try {
    if (MOCK) {
      return res.json({
        name: `@${p.handle}: sticky quality compounder`,
        description: `${p.handle} frames ${p.company || "the company"} as a durable compounder with sticky demand — implying steady free-cash-flow growth and a premium multiple holding. (Demo — add X_BEARER_TOKEN + ANTHROPIC_API_KEY for real summaries.)`,
      });
    }
    if (!anthropic) return res.status(400).json({ error: "No Anthropic API key configured." });
    const tweets = (p.tweets || []).map((t, i) => `(${i + 1}) ${t}`).join("\n");
    const prompt = `The Fintwit account @${p.handle} recently posted the following about ${p.company || "a company"}${p.ticker ? ` (${p.ticker})` : ""}:\n${tweets || "(no tweets provided)"}\n\nThe analyst is valuing it with: ${p.formulaText || "(unspecified)"}. Summarize @${p.handle}'s implied view into ONE alternative scenario: how would this account expect the valuation inputs to differ from a neutral base case? Attribute it to the handle. Call submit_fintwit_scenario once.`;
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 800,
      tools: [scenarioTool],
      tool_choice: { type: "tool", name: "submit_fintwit_scenario" },
      messages: [{ role: "user", content: prompt }],
    });
    const tool = message.content.find((b) => b.type === "tool_use");
    if (!tool) return res.status(502).json({ error: "Could not summarize the influencer." });
    res.json(tool.input);
  } catch (e) {
    res.status(e?.status || 500).json({ error: e.message });
  }
});

export default router;
