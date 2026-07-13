import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

const KEY = process.env.FMP_API_KEY;
const MOCK = process.env.MOCK === "1";
const HOST = "https://financialmodelingprep.com";

export const financeEnabled = !!KEY || MOCK;

// One FMP GET. Throws the API's own error message (so it reaches the UI) rather
// than swallowing it. FMP signals errors as a JSON object with "Error Message".
async function fmpGet(pathWithQuery) {
  const sep = pathWithQuery.includes("?") ? "&" : "?";
  const url = `${HOST}${pathWithQuery}${sep}apikey=${encodeURIComponent(KEY)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`Finance API returned non-JSON (HTTP ${res.status}).`); }
  if (data && !Array.isArray(data) && data["Error Message"]) throw new Error(data["Error Message"]);
  if (!res.ok) throw new Error(`Finance API error (HTTP ${res.status}).`);
  return data;
}

// Try the modern /stable endpoints first, then the legacy /api/v3 form, so the
// integration works regardless of which the key is provisioned for.
async function tryEndpoints(attempts) {
  let lastErr;
  for (const a of attempts) {
    try {
      const rows = await fmpGet(a);
      if (Array.isArray(rows) ? rows.length : rows) return rows;
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  return null;
}

const normSearch = (r) => ({
  symbol: r.symbol,
  name: r.name || r.companyName,
  exchange: r.exchangeShortName || r.exchange || r.exchangeFullName || "",
});

// ---- company search (typeahead) ----
router.get("/finance/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.json([]);
  try {
    if (MOCK) {
      const demo = [
        { symbol: "COST", name: "Costco Wholesale Corporation", exchange: "NASDAQ" },
        { symbol: "WMT", name: "Walmart Inc.", exchange: "NYSE" },
        { symbol: "TGT", name: "Target Corporation", exchange: "NYSE" },
      ].filter((c) => (c.name + c.symbol).toLowerCase().includes(q.toLowerCase()));
      return res.json(demo.length ? demo : [{ symbol: q.toUpperCase().slice(0, 5), name: `${q} (demo)`, exchange: "DEMO" }]);
    }
    if (!KEY) return res.status(400).json({ error: "No FMP_API_KEY configured on the server." });

    const enc = encodeURIComponent(q);
    // Merge stable symbol + name search; dedupe by symbol.
    const seen = new Map();
    let err;
    for (const path of [`/stable/search-symbol?query=${enc}`, `/stable/search-name?query=${enc}`]) {
      try {
        const rows = await fmpGet(path);
        for (const r of rows || []) if (r.symbol && !seen.has(r.symbol)) seen.set(r.symbol, r);
      } catch (e) { err = e; }
    }
    if (seen.size) return res.json([...seen.values()].slice(0, 12).map(normSearch));

    // Legacy fallback.
    try {
      const rows = await fmpGet(`/api/v3/search?query=${enc}&limit=12`);
      if (rows?.length) return res.json(rows.map(normSearch));
    } catch (e) { err = e; }

    if (err) throw err;
    return res.json([]);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---- current metrics for a symbol ----
const pick = (obj, map) =>
  Object.entries(map)
    .map(([field, label]) => ({ label, value: obj?.[field] }))
    .filter((m) => typeof m.value === "number" && Number.isFinite(m.value));

async function statement(kind, symbol) {
  const enc = encodeURIComponent(symbol);
  const rows = await tryEndpoints([`/stable/${kind}?symbol=${enc}&limit=1`, `/api/v3/${kind}/${enc}?limit=1`]).catch(() => null);
  return (Array.isArray(rows) ? rows[0] : rows) || {};
}
async function single(kind, symbol) {
  const enc = encodeURIComponent(symbol);
  const rows = await tryEndpoints([`/stable/${kind}?symbol=${enc}`, `/api/v3/${kind}/${enc}`]).catch(() => null);
  return (Array.isArray(rows) ? rows[0] : rows) || {};
}

router.get("/finance/metrics", async (req, res) => {
  const symbol = String(req.query.symbol || "").trim().toUpperCase();
  if (!symbol) return res.status(400).json({ error: "symbol required" });
  try {
    if (MOCK) {
      return res.json({
        symbol,
        metrics: [
          { label: "Revenue (TTM)", value: 254453000000 },
          { label: "Net Income (TTM)", value: 7367000000 },
          { label: "Free Cash Flow (TTM)", value: 6002000000 },
          { label: "EBITDA (TTM)", value: 11556000000 },
          { label: "Diluted Shares Outstanding", value: 444000000 },
          { label: "Market Cap", value: 415000000000 },
          { label: "P/E (TTM)", value: 56.4 },
          { label: "Total Debt", value: 9089000000 },
          { label: "Cash & Equivalents", value: 10800000000 },
        ],
      });
    }
    if (!KEY) return res.status(400).json({ error: "No FMP_API_KEY configured on the server." });

    const [i, c, b, k, p] = await Promise.all([
      statement("income-statement", symbol),
      statement("cash-flow-statement", symbol),
      statement("balance-sheet-statement", symbol),
      single("key-metrics-ttm", symbol),
      single("profile", symbol),
    ]);

    const metrics = [
      ...pick(i, {
        revenue: "Revenue", grossProfit: "Gross Profit", operatingIncome: "Operating Income",
        netIncome: "Net Income", ebitda: "EBITDA", eps: "EPS",
        weightedAverageShsOutDil: "Diluted Shares Outstanding", weightedAverageShsOut: "Shares Outstanding",
      }),
      ...pick(c, { freeCashFlow: "Free Cash Flow", operatingCashFlow: "Operating Cash Flow", capitalExpenditure: "CapEx" }),
      ...pick(b, { totalDebt: "Total Debt", cashAndCashEquivalents: "Cash & Equivalents", totalStockholdersEquity: "Total Equity" }),
      ...pick(k, {
        peRatioTTM: "P/E (TTM)", priceToEarningsRatioTTM: "P/E (TTM)",
        freeCashFlowPerShareTTM: "FCF / Share (TTM)", enterpriseValueTTM: "Enterprise Value",
      }),
      ...pick(p, { mktCap: "Market Cap", marketCap: "Market Cap", price: "Share Price" }),
    ];
    // dedupe by label (in case stable + legacy both matched)
    const byLabel = new Map();
    for (const m of metrics) if (!byLabel.has(m.label)) byLabel.set(m.label, m);
    res.json({ symbol, metrics: [...byLabel.values()] });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

export default router;
