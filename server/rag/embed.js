// Free local text embeddings via transformers.js (no API key). The model is
// lazy-loaded on first use and cached; used both by the offline index builder
// and by the server at query time.
let extractorPromise = null;

async function getExtractor() {
  if (!extractorPromise) {
    const { pipeline } = await import("@xenova/transformers");
    extractorPromise = pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { quantized: true });
  }
  return extractorPromise;
}

export async function embed(text) {
  const extractor = await getExtractor();
  const out = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(out.data);
}

export async function embedBatch(texts, onProgress) {
  const out = [];
  for (let i = 0; i < texts.length; i++) {
    out.push(await embed(texts[i]));
    if (onProgress && (i % 50 === 0 || i === texts.length - 1)) onProgress(i + 1, texts.length);
  }
  return out;
}

// Cosine similarity for unit vectors is just the dot product.
export function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
