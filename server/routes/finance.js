import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

const KEY = process.env.FMP_API_KEY;
const MOCK = process.env.MOCK === "1";
const BASE = "https://financialmodelingprep.com/api/v3";

export const financeEnabled = !!KEY || MOCK;

async function fmp(path, params = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("apikey", KEY);
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Finance API error (${res.status})`);
  const data = await res.json();
  if (data && data["Error Message"]) throw new Error(data["Error Message"]);
  return data;
}

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
    if (!KEY) return res.status(400).json({ error: "No FMP_API_KEY configured." });
    const rows = await fmp("/search", { query: q, limit: 10 });
    res.json((rows || []).map((r) => ({ symbol: r.symbol, name: r.name, exchange: r.exchangeShortName || r.stockExchange })));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---- current metrics for a symbol ----
const pick = (obj, map) =>
  Object.entries(map)
    .map(([field, label]) => ({ label, value: obj?.[field] }))
    .filter((m) => typeof m.value === "number" && Number.isFinite(m.value));

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
    if (!KEY) return res.status(400).json({ error: "No FMP_API_KEY configured." });

    const [income, cash, balance, keym, profile] = await Promise.all([
      fmp(`/income-statement/${symbol}`, { limit: 1 }).catch(() => []),
      fmp(`/cash-flow-statement/${symbol}`, { limit: 1 }).catch(() => []),
      fmp(`/balance-sheet-statement/${symbol}`, { limit: 1 }).catch(() => []),
      fmp(`/key-metrics-ttm/${symbol}`).catch(() => []),
      fmp(`/profile/${symbol}`).catch(() => []),
    ]);
    const i = income?.[0] || {}, c = cash?.[0] || {}, b = balance?.[0] || {}, k = keym?.[0] || {}, p = profile?.[0] || {};

    const metrics = [
      ...pick(i, {
        revenue: "Revenue", grossProfit: "Gross Profit", operatingIncome: "Operating Income",
        netIncome: "Net Income", ebitda: "EBITDA", eps: "EPS",
        weightedAverageShsOutDil: "Diluted Shares Outstanding",
      }),
      ...pick(c, { freeCashFlow: "Free Cash Flow", operatingCashFlow: "Operating Cash Flow", capitalExpenditure: "CapEx" }),
      ...pick(b, { totalDebt: "Total Debt", cashAndCashEquivalents: "Cash & Equivalents", totalStockholdersEquity: "Total Equity" }),
      ...pick(k, { peRatioTTM: "P/E (TTM)", freeCashFlowPerShareTTM: "FCF / Share (TTM)", enterpriseValueTTM: "Enterprise Value" }),
      ...pick(p, { mktCap: "Market Cap", price: "Share Price" }),
    ];
    res.json({ symbol, metrics });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

export default router;
