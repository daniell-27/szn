// Build the RAG index from chunks.json (produced by extract.py).
//
//   1) pip install pypdf
//   2) python3 rag/extract.py "One Up on Wall Street=/path/one-up.pdf" "Beating the Street=/path/beating.pdf"
//   3) node rag/build-index.mjs            # writes rag/lynch-index.json (local dev)
//      node rag/build-index.mjs --mongo    # ALSO upserts into MongoDB (uses MONGODB_URI) for production
//
// The index contains copyrighted book text — it lives in your database / local
// machine, never in the public repo (see .gitignore).
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { embedBatch } from "./embed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const toMongo = process.argv.includes("--mongo");
  const uploadOnly = process.argv.includes("--upload-only");
  const filePath = path.join(__dirname, "lynch-index.json");

  let records;
  if (uploadOnly) {
    // Skip embedding — reuse the vectors already written to lynch-index.json.
    if (!fs.existsSync(filePath)) {
      console.error("--upload-only needs an existing lynch-index.json (run without it first).");
      process.exit(1);
    }
    records = JSON.parse(fs.readFileSync(filePath, "utf8"));
    console.log(`Reusing ${records.length} vectors from ${filePath}`);
  } else {
    const chunksPath = path.join(__dirname, "chunks.json");
    if (!fs.existsSync(chunksPath)) {
      console.error("chunks.json not found — run extract.py first.");
      process.exit(1);
    }
    const chunks = JSON.parse(fs.readFileSync(chunksPath, "utf8"));
    console.log(`Embedding ${chunks.length} chunks (first run downloads the model)…`);
    const vecs = await embedBatch(
      chunks.map((c) => c.text),
      (done, total) => process.stdout.write(`\r  ${done}/${total}`)
    );
    process.stdout.write("\n");
    records = chunks.map((c, i) => ({ source: c.source, idx: c.idx, text: c.text, vec: vecs[i] }));
    fs.writeFileSync(filePath, JSON.stringify(records));
    console.log(`Wrote ${records.length} vectors to ${filePath}`);
  }

  if (toMongo) {
    if (!process.env.MONGODB_URI) {
      console.error("--mongo requires MONGODB_URI in the environment/.env");
      process.exit(1);
    }
    const mongoose = (await import("mongoose")).default;
    const RagChunk = (await import("../models/RagChunk.js")).default;
    await mongoose.connect(process.env.MONGODB_URI, { dbName: "fermi" });
    await RagChunk.deleteMany({});
    // insert in batches to stay under document/BSON limits
    for (let i = 0; i < records.length; i += 200) {
      await RagChunk.insertMany(records.slice(i, i + 200));
      process.stdout.write(`\r  uploaded ${Math.min(i + 200, records.length)}/${records.length}`);
    }
    process.stdout.write("\n");
    await mongoose.disconnect();
    console.log("Uploaded index to MongoDB.");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
