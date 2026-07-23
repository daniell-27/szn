import mongoose from "mongoose";

// A saved valuation model. Now a full snapshot of the build page — the named
// variables + formula, plus company/thesis context AND the in-progress median
// estimates and scenarios — so "Save model" preserves everything on the page,
// even before a run. `schemaVersion` drives client-side migrations. `blocks`
// is kept only to read pre-rename documents. Flexible sub-shapes are Mixed.
const savedModelSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, default: "Untitled model" },
    company: { type: String, default: "" },
    ticker: { type: String, default: "" },
    thesis: { type: String, default: "" },
    variables: { type: mongoose.Schema.Types.Mixed, default: [] },
    blocks: { type: mongoose.Schema.Types.Mixed }, // legacy (pre-rename); read-only
    folders: { type: mongoose.Schema.Types.Mixed, default: [] },
    formula: { type: mongoose.Schema.Types.Mixed, default: {} },
    auxFormulas: { type: mongoose.Schema.Types.Mixed, default: [] },
    units: { type: mongoose.Schema.Types.Mixed, default: {} },
    inputOrder: { type: mongoose.Schema.Types.Mixed, default: [] },
    baseValues: { type: mongoose.Schema.Types.Mixed, default: {} },
    scenarios: { type: mongoose.Schema.Types.Mixed, default: [] },
    schemaVersion: { type: Number, default: 1 },
  },
  { timestamps: true }
);

savedModelSchema.set("toJSON", {
  transform(_doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    delete ret.userId;
  },
});

export default mongoose.model("SavedModel", savedModelSchema);
