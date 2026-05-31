# Prepwise

**A voice-based interview simulator with retrieval-grounded, dimension-scored answer evaluation.**

Record a spoken answer in the browser, get a cleaned transcript, and receive a structured evaluation across four dimensions — streamed back token by token. Every piece of feedback is grounded in the candidate's actual background via a RAG layer over a private context document, not generic advice. JD-aware question generation runs a hand-rolled tool-calling loop over the candidate's profile and live web search.

> **Live demo:** [interview-eval-six.vercel.app](https://interview-eval-six.vercel.app/)

---

## Why this exists

Interview practice usually happens by typing into a chat window, which is nothing like a real interview. Prepwise was built, and is actively used, to train for real job interviews under realistic conditions: spoken answers, structured feedback, and per-dimension scoring trends across sessions. It covers the full surface area of a modern AI product in one coherent tool: direct LLM API usage, tool calling, structured outputs, RAG, vector databases, streaming, and an evaluation harness with assertions.

The constraint that shaped every decision: **no LLM framework**. No LangChain, no LlamaIndex, no abstraction layer between the application and the model API. The retrieval pipeline, the tool-calling loop, and the evaluation contract are all written directly.

---

## Features


| Feature                          | What it does                                                                                                                                                                                               |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Voice capture**                | Web Speech API records the answer in the browser and produces a live transcript — no audio leaves the device.                                                                                              |
| **Transcript cleaning**          | An LLM pass removes fillers, false starts, and repetitions while preserving the candidate's voice and meaning.                                                                                             |
| **Streamed evaluation**          | Each answer is scored on four dimensions (specificity, evidence, relevance, structure) and streamed back over SSE so the UI populates progressively.                                                       |
| **RAG-grounded feedback**        | The top-k chunks from the candidate's professional background are retrieved per answer and injected into the evaluation prompt — feedback references real projects, not platitudes.                        |
| **JD-aware question generation** | Paste a job posting URL; a manual tool-calling loop fetches the JD, searches for company context, and produces 10 questions that reference both the candidate's background and the company's actual stack. |
| **Session summary**              | Aggregates four-dimension averages, identifies the weakest area, and produces three concrete, candidate-specific improvements.                                                                             |
| **Score trends**                 | SQLite-backed history view with per-dimension sparklines across sessions.                                                                                                                                  |


---

## Architecture

```
┌──────────────────┐         ┌──────────────────────────────┐         ┌─────────────────┐
│  React + Vite    │  /api   │  FastAPI                     │  HTTP   │  Groq           │
│  Tailwind        │ ──────▶ │  ├─ /transcription/clean     │ ──────▶ │  llama-3.3-70b  │
│  Web Speech API  │  SSE    │  ├─ /evaluation/answer (SSE) │         └─────────────────┘
│  (Vercel)        │ ◀────── │  ├─ /sessions, /answers      │         ┌─────────────────┐
└──────────────────┘         │  └─ /questions/generate      │ ──────▶ │  Nomic Embed    │
                             │                              │         │  v1.5 (768-d)   │
                             │  Manual tool loop:           │         └─────────────────┘
                             │   fetch_jd → search_company  │         ┌─────────────────┐
                             │                              │ ──────▶ │  Tavily Search  │
                             │  ┌────────────────────────┐  │         └─────────────────┘
                             │  │ RAGService             │  │
                             │  │  └─ ChromaDB (cosine)  │  │
                             │  └────────────────────────┘  │
                             │  ┌────────────────────────┐  │
                             │  │ SQLite (aiosqlite)     │  │
                             │  └────────────────────────┘  │
                             │  (Fly.io · persistent vol)   │
                             └──────────────────────────────┘
```

---

## Stack


| Layer            | Choice                                                                             |
| ---------------- | ---------------------------------------------------------------------------------- |
| Frontend         | React 19 · TypeScript · Vite · Tailwind v4                                         |
| Voice input      | Web Speech API (browser-native, no audio leaves the device)                        |
| Streaming        | Server-Sent Events consumed via a native async-generator over `fetch`              |
| Backend          | Python 3.12 · FastAPI · Pydantic · `httpx`                                         |
| LLM              | Groq SDK — `llama-3.3-70b-versatile`                                               |
| Embeddings       | Nomic Embed API — `nomic-embed-text-v1.5` (768-dim); Ollama fallback for local dev |
| Vector store     | ChromaDB (persistent client, cosine distance)                                      |
| Session storage  | SQLite via `aiosqlite`                                                             |
| Web search       | Tavily (used inside the JD tool-calling loop)                                      |
| Frontend hosting | Vercel — `/api/*` proxied to the backend via rewrites, same-origin in the browser  |
| Backend hosting  | Fly.io — Docker, persistent volume at `/data`, Paris region                        |
| CI gate          | `pytest` (with a `live` marker for LLM assertions) wired into a pre-push hook      |


---

## Engineering decisions worth calling out

**Pydantic models as the LLM contract.** `AnswerEvaluation`, `SessionSummary`, and `QuestionSet` are passed to the model as the structured output schema and used unchanged at every layer — Python validation, frontend types, database serialization. The schema is the API.

**RAG queries at evaluation time, not session setup.** Retrieval uses `question + transcript` as the query, so the chunk pulled from FULL_CONTEXT depends on what the candidate actually said — not a generic per-session profile. This produces noticeably more specific feedback.

**Section-based chunking on Markdown headings.** A naive word-window chunker fragments coherent experience descriptions; splitting on `##` and re-prepending the H2 header to oversized H3 subsections keeps chunks self-contained.

**Manual tool-calling loop.** The JD question generator declares two function tools, dispatches on `tool_calls`, executes the handler, appends a `tool` role message, and loops — capped at five iterations with a JSON-mode fallback if the model refuses to terminate. No abstraction.

**Cosmetic SSE streaming, honestly.** Groq's JSON-mode output can't be parsed mid-stream — the full structured response has to arrive before validation. The endpoint computes the evaluation, then yields fields one by one with intentional gaps so the UI populates progressively. The trade-off is documented rather than hidden.

**Compute aggregates locally, ask the LLM for judgment.** Session averages are calculated in Python; the model is only asked for the weakest dimension and the three concrete improvements. LLMs are bad at arithmetic and there is no reason to give them the chance.

`**pytest` as a push gate.** A pre-push hook runs the suite, including live-LLM tests gated on a `live` marker. Strong answers must score ≥ 3.5, vague answers ≤ 2.5; thresholds are wide enough to absorb non-determinism but tight enough to catch real prompt regressions.

---

## Repository layout

```
backend/
  app/
    api/           # FastAPI routers — evaluation, sessions, questions, transcription
    db/            # aiosqlite connection helper + schema
    models/        # Pydantic contracts (AnswerEvaluation, SessionSummary, QuestionSet)
    services/      # llm.py, rag.py, tools.py — all direct API calls, no framework
    config.py      # pydantic-settings, .env-driven
    main.py        # lifespan: init_db + RAG auto-index
  tests/           # unit + live-LLM tests (gated by `live` marker)
  Dockerfile       # python:3.12-slim, 256MB on Fly
  fly.toml         # http_service, persistent volume at /data

frontend/
  src/
    api/client.ts        # fetch + SSE async-generator over /api
    hooks/useSpeech.ts   # Web Speech wrapper
    components/          # EvaluationCard, HistoryView, SessionDetail, Sparkline
    App.tsx              # view state machine: setup → session → done
  vercel.json            # rewrites /api/* to the Fly backend (same-origin, no CORS)

scripts/
  pre-push, install-hooks.sh   # gate pushes on pytest

GUIDELINES.md      # what the tool is, what it's deliberately not
ROADMAP.md         # phase-by-phase build order with validation criteria
```

---

## Local development

```bash
# Backend
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env       # fill in GROQ_API_KEY, NOMIC_API_KEY, TAVILY_API_KEY
uvicorn app.main:app --reload

# Frontend (separate shell)
cd frontend
npm install
npm run dev                # Vite dev server on :5173, proxies /api → :8000

```

`FULL_CONTEXT.md` lives in `private/` and is gitignored — supply your own structured Markdown CV with `##` section headings. RAG auto-indexes on backend startup if the collection is empty and the file exists.

---

## Tests

```bash
cd backend
pytest                              # unit tests only (no API calls)
pytest -m live                      # includes live-LLM assertions
```

The live suite asserts retrieval correctness (known queries return the expected sections of `FULL_CONTEXT.md`) and scoring consistency (strong vs. vague answers land on opposite sides of the rubric).

---

## Deployment

The deployed stack is **Vercel + Fly.io**, both free tier.

- **Frontend:** Vercel auto-builds from `frontend/`. `vercel.json` rewrites `/api/`* to the Fly backend so the browser only ever talks to the same origin (no CORS preflight from the client).
- **Backend:** `fly deploy` from `backend/` builds the Docker image and rolls a new machine. ChromaDB and SQLite live on a Fly persistent volume mounted at `/data`, surviving redeploys. CORS origins, API keys, and the Vercel URL are stored as Fly secrets.
- **Embeddings:** Nomic Embed API in production; an Ollama fallback (`nomic-embed-text`, same model) kicks in locally when `NOMIC_API_KEY` is unset, so development has no API-key cost.

The full setup commands are in the header comments of `backend/fly.toml`.