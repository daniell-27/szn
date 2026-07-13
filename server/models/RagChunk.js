import mongoose from "mongoose";

// A retrievable passage from the Lynch books: text + its embedding vector.
// Populated by server/rag/build-index.mjs; queried by server/rag/store.js.
const ragChunkSchema = new mongoose.Schema({
  source: { type: String, required: true },
  idx: { type: Number, default: 0 },
  text: { type: String, required: true },
  vec: { type: [Number], required: true }, // 384-dim unit vector
});

export default mongoose.model("RagChunk", ragChunkSchema);
