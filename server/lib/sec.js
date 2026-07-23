// SEC EDGAR client. Free, no API key — SEC only requires a descriptive
// User-Agent with a contact address (set SEC_USER_AGENT). Used for two things:
//   1) Primary-source fundamentals (XBRL company facts) for /finance/metrics.
//   2) The last four quarterly earnings press releases, fed into the scenario
//      run as extra grounding (see routes/scenario.js).
//
// SEC only has FILINGS, not market data — so price, market cap, P/E and
// enterprise value still come from FMP (see routes/finance.js).

const UA = process.env.SEC_USER_AGENT || "SZN valuation app (admin@example.com)";
const HEADERS = { "User-Agent": UA, Accept: "application/json" };

// ---- ticker -> CIK (cached; the map is ~1MB and rarely changes) ----
let _tickerMap = null;
let _tickerMapAt = 0;
const TICKER_TTL = 24 * 60 * 60 * 1000;

async function tickerMap() {
  if (_tickerMap && Date.now() - _tickerMapAt < TICKER_TTL) return _tickerMap;
  const res = await fetch("https://www.sec.gov/files/company_tickers.json", { headers: HEADERS });
  if (!res.ok) throw new Error(`SEC ticker map error (HTTP ${res.status}).`);
  const data = await res.json();
  const map = new Map();
  for (const row of Object.values(data)) {
    if (row?.ticker) map.set(String(row.ticker).toUpperCase(), row);
  }
  _tickerMap = map;
  _tickerMapAt = Date.now();
  return map;
}

// Returns { cik: "0000320193", cik10, title } or null.
export async function cikForTicker(symbol) {
  const sym = String(symbol || "").trim().toUpperCase();
  if (!sym) return null;
  const row = (await tickerMap()).get(sym);
  if (!row) return null;
  const cik10 = String(row.cik_str).padStart(10, "0");
  return { cik: String(row.cik_str), cik10, title: row.title };
}

async function secJson(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`SEC error (HTTP ${res.status}) for ${url}`);
  return res.json();
}

// ---------- Fundamentals via XBRL company facts ----------
// Tag fallbacks: companies tag the same idea differently across filings.
const TAGS = {
  revenue: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"],
  grossProfit: ["GrossProfit"],
  operatingIncome: ["OperatingIncomeLoss"],
  netIncome: ["NetIncomeLoss"],
  eps: ["EarningsPerShareDiluted"],
  shares: ["WeightedAverageNumberOfDilutedSharesOutstanding"],
  operatingCashFlow: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"],
  capex: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
  dna: ["DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet", "DepreciationAndAmortization"],
  cash: ["CashAndCashEquivalentsAtCarryingValue"],
  equity: ["StockholdersEquity"],
  longTermDebt: ["LongTermDebtNoncurrent", "LongTermDebt"],
  shortTermDebt: ["LongTermDebtCurrent", "DebtCurrent"],
};

const daysBetween = (a, b) => Math.abs((new Date(b) - new Date(a)) / 86400000);

// Pull all USD (or shares) datapoints for the first tag that resolves.
async function conceptPoints(cik10, tags) {
  for (const tag of tags) {
    try {
      const data = await secJson(`https://data.sec.gov/api/xbrl/companyconcept/CIK${cik10}/us-gaap/${tag}.json`);
      const units = data.units || {};
      const key = Object.keys(units)[0]; // "USD", "USD/shares", or "shares"
      if (key && units[key]?.length) return units[key];
    } catch {
      /* try next tag */
    }
  }
  return [];
}

// Trailing-twelve-months for a flow metric: sum the 4 most recent distinct
// quarterly periods (~90-day spans). Falls back to the latest annual (~365-day)
// figure when quarterly detail isn't available.
function ttmFromPoints(points) {
  if (!points.length) return undefined;
  const quarters = points
    .filter((p) => p.start && p.end && daysBetween(p.start, p.end) <= 100 && daysBetween(p.start, p.end) >= 80)
    .filter((p) => typeof p.val === "number");
  const seen = new Set();
  const distinct = [];
  for (const p of quarters.sort((a, b) => new Date(b.end) - new Date(a.end))) {
    const k = `${p.start}|${p.end}`;
    if (!seen.has(k)) { seen.add(k); distinct.push(p); }
  }
  if (distinct.length >= 4) return distinct.slice(0, 4).reduce((s, p) => s + p.val, 0);

  const annual = points
    .filter((p) => p.start && p.end && daysBetween(p.start, p.end) >= 350 && typeof p.val === "number")
    .sort((a, b) => new Date(b.end) - new Date(a.end));
  return annual[0]?.val;
}

// Latest point-in-time value (balance-sheet items have no start span).
function latestInstant(points) {
  const pts = points.filter((p) => typeof p.val === "number" && p.end).sort((a, b) => new Date(b.end) - new Date(a.end));
  return pts[0]?.val;
}

// Returns [{ label, value }] of SEC-derived fundamentals, best-effort.
export async function fundamentals(symbol) {
  const id = await cikForTicker(symbol);
  if (!id) return [];
  const points = {};
  for (const [k, tags] of Object.entries(TAGS)) points[k] = await conceptPoints(id.cik10, tags);

  const ttm = (k) => ttmFromPoints(points[k]);
  const inst = (k) => latestInstant(points[k]);

  const revenue = ttm("revenue");
  const grossProfit = ttm("grossProfit");
  const operatingIncome = ttm("operatingIncome");
  const netIncome = ttm("netIncome");
  const ocf = ttm("operatingCashFlow");
  const capex = ttm("capex");
  const dna = ttm("dna");
  const ltd = inst("longTermDebt");
  const std = inst("shortTermDebt");

  const fcf = ocf !== undefined && capex !== undefined ? ocf - Math.abs(capex) : undefined;
  const ebitda = operatingIncome !== undefined && dna !== undefined ? operatingIncome + dna : undefined;
  const totalDebt = ltd !== undefined || std !== undefined ? (ltd || 0) + (std || 0) : undefined;

  const rows = [
    ["Revenue (TTM)", revenue],
    ["Gross Profit (TTM)", grossProfit],
    ["Operating Income (TTM)", operatingIncome],
    ["Net Income (TTM)", netIncome],
    ["EBITDA (TTM)", ebitda],
    ["EPS Diluted (TTM)", ttm("eps")],
    ["Diluted Shares Outstanding", inst("shares")],
    ["Operating Cash Flow (TTM)", ocf],
    ["CapEx (TTM)", capex !== undefined ? -Math.abs(capex) : undefined],
    ["Free Cash Flow (TTM)", fcf],
    ["Cash & Equivalents", inst("cash")],
    ["Total Debt", totalDebt],
    ["Total Equity", inst("equity")],
  ];
  return rows
    .filter(([, v]) => typeof v === "number" && Number.isFinite(v))
    .map(([label, value]) => ({ label, value }));
}

// ---------- Earnings press releases ----------
const stripHtml = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

async function secText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`SEC doc error (HTTP ${res.status}).`);
  return res.text();
}

// The last `n` quarterly earnings press releases. Strategy: find recent 8-K
// filings reporting item 2.02 ("Results of Operations"), then pull the EX-99.1
// exhibit (the press release itself) from each filing's directory. Best-effort:
// returns [] on any failure so the caller can continue ungrounded.
export async function earningsReleases(symbol, n = 4, maxCharsEach = 3500) {
  try {
    const id = await cikForTicker(symbol);
    if (!id) return [];
    const sub = await secJson(`https://data.sec.gov/submissions/CIK${id.cik10}.json`);
    const r = sub.filings?.recent;
    if (!r) return [];

    const candidates = [];
    for (let i = 0; i < r.accessionNumber.length && candidates.length < n * 3; i++) {
      const form = r.form[i];
      const items = r.items?.[i] || "";
      const isEarnings8K = form === "8-K" && items.includes("2.02");
      if (isEarnings8K) {
        candidates.push({ accession: r.accessionNumber[i], date: r.filingDate[i] });
      }
    }

    const out = [];
    for (const c of candidates) {
      if (out.length >= n) break;
      const accNo = c.accession.replace(/-/g, "");
      try {
        const dir = await secJson(`https://www.sec.gov/Archives/edgar/data/${id.cik}/${accNo}/index.json`);
        const items = dir.directory?.item || [];
        // Prefer an EX-99.1 press-release exhibit; else the largest .htm.
        const ex = items.find((it) => /ex[-_]?99/i.test(it.name) && /\.htm/i.test(it.name));
        const htmls = items.filter((it) => /\.htm[l]?$/i.test(it.name) && !/index/i.test(it.name));
        const doc = ex || htmls.sort((a, b) => (Number(b.size) || 0) - (Number(a.size) || 0))[0];
        if (!doc) continue;
        const url = `https://www.sec.gov/Archives/edgar/data/${id.cik}/${accNo}/${doc.name}`;
        const html = await secText(url);
        const text = stripHtml(html).slice(0, maxCharsEach);
        if (text.length > 200) out.push({ date: c.date, text, url });
      } catch {
        /* skip this filing */
      }
    }
    return out;
  } catch {
    return [];
  }
}
