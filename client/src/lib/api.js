// All requests are same-origin through the Vite proxy and rely on the httpOnly
// auth cookie, so we always send credentials.
async function req(path, options = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---- auth ----
export const signup = (email, password) =>
  req("/api/auth/signup", { method: "POST", body: JSON.stringify({ email, password }) });
export const login = (email, password) =>
  req("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
export const logout = () => req("/api/auth/logout", { method: "POST" });
export const me = () => req("/api/auth/me");

// ---- saved models ----
export const listModels = () => req("/api/models");
export const saveModel = (model) => req("/api/models", { method: "POST", body: JSON.stringify(model) });
export const deleteModel = (id) => req(`/api/models/${id}`, { method: "DELETE" });

// ---- run history ----
export const listRuns = () => req("/api/runs");
export const saveRun = (run) => req("/api/runs", { method: "POST", body: JSON.stringify(run) });
export const deleteRun = (id) => req(`/api/runs/${id}`, { method: "DELETE" });

// ---- scenario run (Anthropic proxy) ----
export const runScenarios = (payload) =>
  req("/api/run", { method: "POST", body: JSON.stringify(payload) });

// ---- reasoning feedback (RAG-grounded) ----
export const getFeedback = (payload) =>
  req("/api/feedback", { method: "POST", body: JSON.stringify(payload) });

// ---- finance data (FMP) ----
export const searchCompanies = (q) => req(`/api/finance/search?q=${encodeURIComponent(q)}`);
export const getMetrics = (symbol) => req(`/api/finance/metrics?symbol=${encodeURIComponent(symbol)}`);

export async function checkHealth() {
  try {
    return await req("/api/health");
  } catch {
    return { ok: false };
  }
}
