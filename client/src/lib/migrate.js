// Saved-data schema versioning + migrations.
//
// Every persisted model/run carries a `schemaVersion`. On load we run ordered
// migrations up to CURRENT_SCHEMA, so a bug fix (or a rename) can *repair*
// already-saved data instead of the old shape lingering and re-triggering the
// bug when a stale model is reloaded. To fix a data-shape bug: bump
// CURRENT_SCHEMA and append a migration step that transforms the bad shape.

export const CURRENT_SCHEMA = 2;

// Each step upgrades a model from the previous version to `to`.
const MIGRATIONS = [
  // v1 -> v2: rename `blocks` -> `variables`, and token `blockId` -> `variableId`.
  {
    to: 2,
    migrate(model) {
      const variables = model.variables || model.blocks || [];
      const fixRhs = (rhs) =>
        (rhs || []).map((t) => {
          if (t && t.type === "variable" && t.blockId !== undefined && t.variableId === undefined) {
            const { blockId, ...rest } = t;
            return { ...rest, variableId: blockId };
          }
          return t;
        });
      const formula = model.formula
        ? { ...model.formula, rhs: fixRhs(model.formula.rhs) }
        : { output: null, rhs: [] };
      const auxFormulas = (model.auxFormulas || []).map((f) => ({ ...f, rhs: fixRhs(f.rhs) }));
      const out = { ...model, variables, formula, auxFormulas };
      delete out.blocks;
      return out;
    },
  },
];

// Bring any saved model/run object up to the current schema. Safe to call on
// already-current data (no-op) and on partial objects — it only touches the
// keys it knows about.
export function migrateModel(model) {
  if (!model || typeof model !== "object") return model;
  let m = model;
  let v = typeof m.schemaVersion === "number" ? m.schemaVersion : 1;
  for (const step of MIGRATIONS) {
    if (v < step.to) {
      m = step.migrate(m);
      v = step.to;
    }
  }
  return { ...m, schemaVersion: CURRENT_SCHEMA };
}
