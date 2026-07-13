# Fermi

Back-of-the-envelope company valuations with AI-assisted scenario analysis.

Build a valuation formula out of drag-and-drop "Scratch"-style blocks, enter your
own median estimates, describe a set of alternative futures in plain English, and
let an Anthropic model fill in the inputs for each scenario **using the exact same
formula** — so the numbers stay honest and the format never drifts. Every AI
estimate carries a sticky-note justification, and you can tweak any input to see
its scenario recalculate live. Each analyst has their own account; saved models and
run history are stored per user.

## Stack (MERN)

- **MongoDB** — users, saved models, and run history (Mongoose).
- **Express** — REST API + Anthropic proxy that holds the API key server-side.
- **React** (Vite) — the client.
- **Node.js** — the server runtime.
- **Auth** — email/password with bcrypt-hashed passwords and a JWT in an httpOnly cookie.
- **AI** — Anthropic Messages API (`claude-opus-4-8`), forced to return a structured
  estimate + justification for every variable in every scenario.

## Setup

### 1. Backend

```bash
cd server
npm install
cp .env.example .env      # then edit .env (see below)
npm start                 # http://localhost:5001
```

`.env` values:

| Key | Required | Notes |
|-----|----------|-------|
| `ANTHROPIC_API_KEY` | for real reasoning | https://console.anthropic.com/settings/keys |
| `MONGODB_URI` | for production | Local `mongod` or a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster. **If left blank in dev, the server starts a temporary in-memory MongoDB** so you can try everything with zero setup. |
| `JWT_SECRET` | yes | A long random string used to sign login tokens. |
| `MOCK` | optional | Set `MOCK=1` for demo mode (canned scenario estimates, no Anthropic key needed). |

### 2. Frontend

```bash
cd client
npm install
npm run dev                # http://localhost:5173
```

The Vite dev server proxies `/api` to the backend, so the browser never sees your
key and the auth cookie is same-origin.

### Try it with no setup

Start the backend with `MOCK=1 npm start` (and no `MONGODB_URI`) to click through the
whole app — sign up, build a formula, run scenarios, see the output page — using an
in-memory database and canned AI estimates. Add a real `ANTHROPIC_API_KEY` and
`MONGODB_URI`, and drop `MOCK=1`, for the real thing.

## RAG: Peter Lynch grounding (one-time index build)

The scenario reasoning and the "Model feedback on your reasoning" panel are grounded
in *One Up on Wall Street* and *Beating the Street* via a small vector index of the
books. The book text is **never committed** (it's copyrighted) — the index lives in
your MongoDB. Build it once, locally, from your own PDFs:

```bash
cd server
pip install pypdf                     # for text extraction
python3 rag/extract.py \
  "One Up on Wall Street=/path/to/one-up-on-wall-street.pdf" \
  "Beating the Street=/path/to/beating-the-street.pdf"
node rag/build-index.mjs --mongo      # embeds locally (free), uploads vectors to MONGODB_URI
```

The first run downloads a small embedding model (`all-MiniLM-L6-v2`, ~25 MB, no API key).
The server reads the index from MongoDB at query time. Until you build it, the RAG
features degrade gracefully (feedback still works, just without book grounding). For
local dev without Mongo, `node rag/build-index.mjs` (no `--mongo`) writes a local
`rag/lynch-index.json` the dev server picks up automatically.

## How the "exact same format" guarantee works

The formula is evaluated by one function, `client/src/lib/evaluate.js`, for the
median case and every scenario. The model only supplies **input values** (never the
output), and the server forces a single structured tool call so it must return one
estimate per variable per scenario — no missing or extra fields. The output block is
then computed identically for every column.

## Project layout

```
server/
  index.js            Express app + route wiring
  db.js               Mongo connection (in-memory fallback for dev)
  models/             User, SavedModel, Run (Mongoose schemas)
  middleware/auth.js  JWT cookie issue/verify
  routes/             auth.js, data.js (models+runs), scenario.js (Anthropic proxy)
client/
  src/
    App.jsx           top-level state + auth gate
    components/       AuthScreen, Sidebar, FormulaBuilder, OutputView, StickyNote
    lib/              evaluate.js (formula engine), api.js, defaults.js, util.js
```
