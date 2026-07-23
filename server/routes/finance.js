import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { fundamentals as secFundamentals } from "../lib/sec.js";

const router = Router();
router.use(requireAuth);

const KEY = process.env.FMP_API_KEY;
const MOCK = process.env.MOCK === "1";
const HOST = "https://financialmodelingprep.com";

// Hybrid model: SEC EDGAR (free, primary-source filings) supplies fundamentals;
// FMP supplies company search + market data SEC has no access to (price, market
// cap, P/E, enterprise value). The metrics endpoint merges the two. Fundamentals
// still work if FMP is down; market metrics need FMP.
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
    // Fundamentals from SEC (primary source); market data from FMP (if keyed).
    // Both are best-effort so one source being down still returns the other.
    const [secRows, k, p] = await Promise.all([
      secFundamentals(symbol).catch(() => []),
      KEY ? single("key-metrics-ttm", symbol).catch(() => ({})) : Promise.resolve({}),
      KEY ? single("profile", symbol).catch(() => ({})) : Promise.resolve({}),
    ]);

    const marketMetrics = [
      ...pick(k, {
        peRatioTTM: "P/E (TTM)", priceToEarningsRatioTTM: "P/E (TTM)",
        enterpriseValueTTM: "Enterprise Value",
      }),
      ...pick(p, { mktCap: "Market Cap", marketCap: "Market Cap", price: "Share Price" }),
    ];

    // SEC fundamentals first (authoritative), then FMP market metrics; dedupe by label.
    const byLabel = new Map();
    for (const m of [...secRows, ...marketMetrics]) if (!byLabel.has(m.label)) byLabel.set(m.label, m);
    const metrics = [...byLabel.values()];
    if (!metrics.length) return res.status(502).json({ error: "No metrics found for this symbol (SEC + FMP both empty)." });
    res.json({ symbol, metrics });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

export default router;
