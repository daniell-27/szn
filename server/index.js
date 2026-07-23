import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { connectDB } from "./db.js";
import authRoutes from "./routes/auth.js";
import dataRoutes from "./routes/data.js";
import scenarioRoutes, { runtimeInfo } from "./routes/scenario.js";
import feedbackRoutes from "./routes/feedback.js";
import financeRoutes, { financeEnabled } from "./routes/finance.js";
import ingestRoutes from "./routes/ingest.js";
import fintwitRoutes, { fintwitEnabled } from "./routes/fintwit.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5001;

// A per-deploy identifier so the client can detect when a new version has been
// deployed and offer a non-disruptive reload. Prefer the git commit (stable per
// deploy on Render); fall back to process start time.
const VERSION = process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || String(Date.now());

// Production serves the client from the same origin, so no CORS is needed.
// In dev the Vite proxy is also same-origin, but allow localhost for flexibility.
if (process.env.NODE_ENV !== "production") {
  app.use(cors({ origin: [/^http:\/\/localhost:\d+$/], credentials: true }));
}
// Article uploads (base64 PDF) need a bigger body; mount before the global 1mb
// parser so only this route gets the larger limit.
app.use("/api/ingest", express.json({ limit: "25mb" }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, version: VERSION, ...runtimeInfo, finance: financeEnabled, fintwit: fintwitEnabled });
});

app.use("/api/auth", authRoutes);
app.use("/api", dataRoutes); // /api/models, /api/runs (auth-gated)
app.use("/api", scenarioRoutes); // /api/run (auth-gated)
app.use("/api", feedbackRoutes); // /api/feedback (auth-gated)
app.use("/api", financeRoutes); // /api/finance/* (auth-gated)
app.use("/api", ingestRoutes); // /api/ingest/article (auth-gated)
app.use("/api", fintwitRoutes); // /api/fintwit* (auth-gated)

// In production, serve the built React client from the same origin so the
// auth cookie is first-party and there is no CORS to configure.
if (process.env.NODE_ENV === "production") {
  const clientDist = path.resolve(__dirname, "../client/dist");
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
}

// Catch-all error handler so an uncaught route error returns JSON, never hangs.
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err?.message);
  if (res.headersSent) return;
  res.status(500).json({ error: "Something went wrong." });
});

connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(
        `SZN server on http://localhost:${PORT}  (model: ${runtimeInfo.model}, key: ${runtimeInfo.hasKey ? "set" : "MISSING"}${runtimeInfo.mock ? ", MOCK" : ""})`
      );
    });
  })
  .catch((err) => {
    console.error("Failed to start:", err);
    process.exit(1);
  });
