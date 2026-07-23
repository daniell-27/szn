import { Router } from "express";
import mongoose from "mongoose";
import SavedModel from "../models/SavedModel.js";
import Run from "../models/Run.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth); // everything here is per-user

// Wrap async handlers so a thrown error (e.g. a malformed id) returns JSON
// instead of hanging the request.
const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    console.error("data route error:", e.message);
    res.status(500).json({ error: "Something went wrong." });
  });

const validId = (id) => mongoose.isValidObjectId(id);

// ---------- Saved models ----------
router.get("/models", wrap(async (req, res) => {
  const models = await SavedModel.find({ userId: req.userId }).sort({ updatedAt: -1 });
  res.json(models.map((m) => m.toJSON()));
}));

router.post("/models", wrap(async (req, res) => {
  const b = req.body || {};
  const { id, name, company, ticker, thesis, variables, blocks, folders, formula, auxFormulas, units, inputOrder, baseValues, scenarios, schemaVersion } = b;
  // Full-page snapshot; accept legacy `blocks` as a fallback for `variables`.
  const fields = {
    name, company, ticker, thesis,
    variables: variables ?? blocks ?? [],
    folders, formula, auxFormulas, units, inputOrder, baseValues, scenarios, schemaVersion,
  };
  // Don't overwrite stored values with undefined when a field is omitted.
  for (const k of Object.keys(fields)) if (fields[k] === undefined) delete fields[k];
  let doc;
  if (id && validId(id)) {
    doc = await SavedModel.findOneAndUpdate({ _id: id, userId: req.userId }, { $set: fields }, { new: true });
  }
  if (!doc) doc = await SavedModel.create({ ...fields, userId: req.userId });
  res.json(doc.toJSON());
}));

router.delete("/models/:id", wrap(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: "Invalid id." });
  await SavedModel.deleteOne({ _id: req.params.id, userId: req.userId });
  res.json({ ok: true });
}));

// ---------- Run history ----------
router.get("/runs", wrap(async (req, res) => {
  const runs = await Run.find({ userId: req.userId }).sort({ ranAt: -1 }).limit(100);
  res.json(runs.map((r) => r.toJSON()));
}));

router.post("/runs", wrap(async (req, res) => {
  const { id, modelName, company, ticker, model, baseValues, result } = req.body || {};
  const fields = { modelName, company, ticker, model, baseValues, result };
  let doc;
  if (id && validId(id)) {
    doc = await Run.findOneAndUpdate({ _id: id, userId: req.userId }, { $set: fields }, { new: true });
  }
  if (!doc) doc = await Run.create({ ...fields, userId: req.userId, ranAt: Date.now() });
  res.json(doc.toJSON());
}));

router.delete("/runs/:id", wrap(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: "Invalid id." });
  await Run.deleteOne({ _id: req.params.id, userId: req.userId });
  res.json({ ok: true });
}));

export default router;
