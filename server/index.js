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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, ...runtimeInfo, finance: financeEnabled });
});

app.use("/api/auth", authRoutes);
app.use("/api", dataRoutes); // /api/models, /api/runs (auth-gated)
app.use("/api", scenarioRoutes); // /api/run (auth-gated)
app.use("/api", feedbackRoutes); // /api/feedback (auth-gated)
app.use("/api", financeRoutes); // /api/finance/* (auth-gated)

// In production, serve the built React client from the same origin so the
// auth cookie is first-party and there is no CORS to configure.
if (process.env.NODE_ENV === "production") {
  const clientDist = path.resolve(__dirname, "../client/dist");
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
}

connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(
        `Fermi server on http://localhost:${PORT}  (model: ${runtimeInfo.model}, key: ${runtimeInfo.hasKey ? "set" : "MISSING"}${runtimeInfo.mock ? ", MOCK" : ""})`
      );
    });
  })
  .catch((err) => {
    console.error("Failed to start:", err);
    process.exit(1);
  });
