# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Project

Prepwise — voice interview simulation tool. Full-stack: FastAPI (Python) backend + React/TypeScript/Tailwind frontend. Built for personal use during an active internship search; every technical decision is also CV signal.

**Hard constraints from GUIDELINES.md:**
- No LangChain, no LlamaIndex, no LLM framework. Direct `google-genai` SDK calls only.
- Pydantic models (`AnswerEvaluation`, `SessionSummary`, `QuestionSet`) are the CV-visible artifact — do not restructure them without reason.
- Tool calling loop for JD question generation must be implemented manually (declare tools, handle `function_call`, execute, return `function_response`, loop).

---

## Dev commands

### Backend

All commands run from `backend/` with the venv active. The server must be started from `backend/` because `config.py` resolves paths relative to CWD (`.env`, `FULL_CONTEXT.md`, `chroma_db/`, `prepwise.db`).

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Start dev server
uvicorn app.main:app --reload

# Run all tests (skips live-LLM tests by default once marked)
pytest

# Run a single test file
pytest tests/test_rag.py -v

# Index FULL_CONTEXT.md into ChromaDB (must be done before first evaluation)
python -c "from app.services.rag import RAGService; r = RAGService(); print(r.index(), 'chunks indexed')"
```

### Frontend

```bash
cd frontend
npm install
npm run dev        # Vite dev server on :5173, proxies /api → localhost:8000
npm run build
npm run lint
```

---

## Architecture

### Request flow (core loop)

```
Browser (Web Speech API)
  → POST /transcription/clean       → clean_transcript() → Gemini Flash
  → POST /evaluation/answer (SSE)   → RAGService.query() → evaluate_answer() → Gemini Flash
  → POST /sessions/answers          → SQLite via aiosqlite
```

The SSE endpoint in `api/evaluation.py` currently computes the full evaluation first, then streams fields one-by-one with `asyncio.sleep(0)` between yields. This is cosmetic streaming — not true token-level streaming. The ROADMAP notes this as a known gap.

### Key data contracts

`models/evaluation.py` defines the three Pydantic models that are passed directly to Gemini as `response_schema`:
- `AnswerEvaluation` — per-answer result with four `DimensionScore` fields (specificity, evidence, relevance, structure)
- `SessionSummary` — aggregated session result
- `QuestionSet` — 10 questions from JD generation

These models are also mirrored in `frontend/src/types/index.ts`. Changes to one must be reflected in the other.

### RAG pipeline

`services/rag.py` — `RAGService` is instantiated at module import time in both `api/evaluation.py` and `api/questions.py` (module-level `_rag = RAGService()`). ChromaDB connects on construction. The index is not warmed automatically on startup — `RAGService.index()` must be called manually once before use. The current chunking strategy is word-window (400 words, 80 overlap); section-based splitting on `##` headings may give better retrieval for the structured CV document.

### LLM calls

All calls go through `services/llm.py`. Uses `google-genai` SDK (not the old `google-generativeai`). A module-level `genai.Client(api_key=settings.gemini_api_key)` is created at import time — missing `.env` fails the import. Model is `gemini-2.0-flash`. Structured outputs use `types.GenerateContentConfig(response_mime_type="application/json", response_schema=<PydanticModel>)`. Embeddings go through `services/rag.py` using `client.models.embed_content()` with `types.EmbedContentConfig(task_type=...)` — separate functions for document and query task types (`_embed_documents`, `_embed_query`).

### Database

SQLite via `aiosqlite`. Two tables: `sessions` and `answers`. The `answers` table stores individual dimension scores as integers plus the full `evaluation_json` blob. `init_db()` is called in the FastAPI lifespan — tables are created on startup. The `get_db()` helper opens a new connection per call (no connection pool).

### Frontend state machine

`App.tsx` manages the entire UI via a `view` enum: `'setup' → 'session' → 'done'`. There is no router. Session-level state (sessionId, qIndex, evaluation, streaming) lives in App. The SSE stream is consumed via an async generator in `api/client.ts:streamEvaluation()`.

### Vite proxy

`/api/*` in the frontend proxies to `http://localhost:8000/*` (strips the `/api` prefix). Frontend API calls use `/api/...`; the FastAPI routes are registered without the `/api` prefix.

---

## Environment

`backend/.env` (not committed — copy from `.env.example`):

```
GEMINI_API_KEY=...
CHROMA_PERSIST_PATH=./chroma_db
SQLITE_PATH=./prepwise.db
FULL_CONTEXT_PATH=../private/FULL_CONTEXT.md
RAG_TOP_K=5
```

---

## Test suite

`backend/tests/test_rag.py` — requires a live Gemini key; calls `RAGService.index()` once per module. Assertions are content-based (retrieved chunks must mention "ist" or "lazzo"). These will fail without a valid key and a populated `FULL_CONTEXT.md`.

`backend/tests/test_evaluation.py` — mostly unit tests over Pydantic model construction and validation. No Gemini calls. Safe to run offline.

The ROADMAP specifies that `pytest` must pass before pushing to `main`.
