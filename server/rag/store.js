// Server-side retrieval over the Lynch RAG index. Loads the vectors once (from
// the local dev file if present, otherwise from MongoDB), then answers queries
// with in-memory cosine similarity (fast for a couple thousand chunks).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { embed, cosine } from "./embed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = process.env.RAG_INDEX_FILE || path.join(__dirname, "lynch-index.json");

let chunksPromise = null;

async function loadChunks() {
  // 1) local file (dev)
  if (fs.existsSync(FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
      console.log(`RAG: loaded ${data.length} chunks from file.`);
      return data;
    } catch (e) {
      console.warn("RAG: failed to read index file:", e.message);
    }
  }
  // 2) MongoDB (production)
  try {
    const RagChunk = (await import("../models/RagChunk.js")).default;
    const docs = await RagChunk.find({}, { source: 1, text: 1, vec: 1, _id: 0 }).lean();
    console.log(`RAG: loaded ${docs.length} chunks from MongoDB.`);
    return docs;
  } catch (e) {
    console.warn("RAG: no index available:", e.message);
    return [];
  }
}

export function ragAvailable() {
  return fs.existsSync(FILE) || !!process.env.MONGODB_URI;
}

// Retrieve the top-k most relevant passages for a query. Returns [] if the
// index isn't built yet, so callers degrade gracefully.
export async function retrieve(query, k = 6) {
  if (!query || !query.trim()) return [];
  if (!chunksPromise) chunksPromise = loadChunks();
  const chunks = await chunksPromise;
  if (!chunks.length) return [];

  const qv = await embed(query);
  const scored = chunks.map((c) => ({ source: c.source, text: c.text, score: cosine(qv, c.vec) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
