# Prepwise — Implementation Roadmap

> Execution plan, ordered strictly by dependency: nothing in phase N assumes anything from phase N+1 works. The structural scaffold exists (see `backend/`, `frontend/`); these phases turn stubs into a validated product.
>
> Each phase must pass its validation step before the next begins.

---

## Phase 0 — Environment bootstrap

**Goal.** Make the toolchain runnable. Nothing AI-related yet.

**Scope.**
- Create `backend/.env` with `GROQ_API_KEY` (from console.groq.com).
- Install Ollama (`brew install ollama`) and pull the embedding model: `ollama pull nomic-embed-text`. Confirm `ollama serve` starts and stays running.
- Create Python venv, install `backend/requirements.txt`. Pin versions in a lockfile or commit the resolved `pip freeze` output.
- Confirm `npm install` in `frontend/` succeeded; resolve any peer-dep noise.

**Validation.**
- Groq: `python -c "from groq import Groq; from app.config import settings; c = Groq(api_key=settings.groq_api_key); r = c.chat.completions.create(model='llama-3.3-70b-versatile', messages=[{'role':'user','content':'ping'}]); print('OK:', r.choices[0].message.content[:30])"` prints `OK:` followed by text.
- Ollama: `python -c "import httpx; r = httpx.post('http://localhost:11434/api/embeddings', json={'model':'nomic-embed-text','prompt':'test'}); print('OK: dim =', len(r.json()['embedding']))"` prints `OK: dim = 768`.
- `npm run dev` in `frontend/` serves a page without errors.

**Main risk.** Ollama not running when the backend starts — `RAGService.__init__` will fail silently if the embed endpoint is down. Verify `ollama serve` is running before starting uvicorn. Groq SDK is stable (OpenAI-compatible); no renaming risk.

---

## Phase 1 — Pydantic contracts

**Goal.** Finalize the schemas the LLM will be asked to return and that the frontend will consume. These are the CV-visible artifact — get them right once.

**Scope.**
- Review `models/evaluation.py`: `DimensionScore`, `AnswerEvaluation`, `SessionSummary`, `Question`, `QuestionSet`.
- Decide field nullability rules — Groq JSON mode requires clean schemas with no nullable fields or complex defaults; every field should be required and typed concretely.
- Mirror the final shape into `frontend/src/types/index.ts`.
- Cover construction + validation in `tests/test_evaluation.py` (range bounds on scores, required fields, list length on `top_improvements`).

**Validation.** `pytest backend/tests/test_evaluation.py -q` passes. Manual: feed an `AnswerEvaluation` instance through `.model_json_schema()` and confirm JSON-mode compatible (no `anyOf`, no `default`, no `$ref` to non-trivial types).

**Main risk.** Locking in a schema now that Groq's JSON mode rejects later (e.g. nested models with defaults). Discovering this in Phase 5 means redoing Phase 1 and the frontend types together.

---

## Phase 2 — SQLite persistence layer

**Goal.** Standalone, LLM-free data layer for sessions and answers.

**Scope.**
- Verify `init_db()` creates both tables. Decide indexing strategy (`session_id` on `answers`).
- Tighten `db/database.py` connection pattern — single shared `aiosqlite.connect` vs per-request opens; pick one explicitly.
- Add a small repo-style helper if `api/sessions.py` is doing too much raw SQL.

**Validation.** Write a throwaway script (or pytest) that calls `init_db()`, inserts one session, inserts two answers, reads them back, and asserts row count + JSON round-trip of `evaluation_json`. Delete the test DB file between runs.

**Main risk.** Concurrency model confusion. Single-user local app, but the SSE endpoint + a saveAnswer call can interleave. Pick "one connection per request" and stick with it.

---

## Phase 3 — RAG pipeline (indexing + query)

**Goal.** Reliable retrieval over `FULL_CONTEXT.md` before any evaluation tries to use it.

**Scope.**
- Decide chunking strategy: section-based (split on `##` headings) is more meaningful than word-window for a structured CV doc — reconsider the current word-window approach.
- Implement `RAGService.index()` as idempotent (upsert, not append; reset on schema change).
- Implement query path via `POST http://localhost:11434/api/embeddings` and confirm dimensionality matches indexed embeddings (`nomic-embed-text` produces 768-dim vectors).
- A CLI entry point (`python -m app.services.rag index`) is useful and risk-free.

**Validation.** `pytest backend/tests/test_rag.py -q` — the existing assertions (IST query returns education chunk, Lazzo query returns founding experience) must pass. Manually: query "react native frontend" and read the top-3 chunks; they should mention Lazzo's Flutter stack rather than unrelated coursework.

**Main risk.** Chunk granularity. Too small → no context per chunk → feedback feels disconnected. Too large → top-k pulls in irrelevant sections → feedback cites wrong experience. Visually inspect output before declaring this done.

---

## Phase 4 — Transcript cleaning service

**Goal.** First real Groq integration. Simplest possible — no structured output, no RAG.

**Scope.**
- `clean_transcript()` in `services/llm.py`: prompt + Groq chat completion call (`llama-3.3-70b-versatile`), return string.
- Tune the prompt to preserve meaning and first-person voice; reject the model's tendency to "improve" beyond cleaning.

**Validation.** Run `clean_transcript()` on a sample with obvious fillers ("um, like, yeah so I, I worked on, you know, this thing at Lazzo") and confirm output: fillers gone, meaning preserved, no invented content. Run on an already-clean transcript and confirm it returns near-identical text (idempotency).

**Main risk.** Over-cleaning. llama-3.3-70b rewrites in third-person or paraphrases. Bake constraints into the prompt and test both directions (noisy and clean inputs).

---

## Phase 5 — Per-answer evaluation (non-streaming)

**Goal.** End-to-end evaluation working as a blocking call, before SSE complicates debugging.

**Scope.**
- `evaluate_answer()` calls `RAGService.query(question + transcript)`, formats the prompt with retrieved chunks, calls Groq with `response_format={"type": "json_object"}`, validates response against `AnswerEvaluation` via `model_validate_json`.
- Strengthen `tests/test_evaluation.py` with two live-LLM tests: strong answer (concrete metrics, real project names from FULL_CONTEXT) scores ≥ 3.5 average; vague answer scores ≤ 2.5.

**Validation.** `pytest backend/tests/test_evaluation.py -q` — strong/vague threshold assertions pass; all four dimensions populated; `overall_score` ∈ [1.0, 5.0]; `key_strength` and `key_improvement` non-empty. Inspect a real evaluation: feedback should cite something from FULL_CONTEXT (e.g., "Lazzo" or "IST"), not generic advice.

**Main risk.** Groq JSON mode returns structurally valid JSON that fails Pydantic validation (wrong field names, scores out of range). Prompt must include the exact schema as a JSON example, not just a description. Decide prompt format before wiring streaming on top.

---

## Phase 6 — SSE streaming wrapper

**Goal.** Stream evaluation fields progressively over Server-Sent Events.

**Scope.**
- Wrap Phase 5's evaluation in `StreamingResponse` from `api/evaluation.py`.
- Decide the streaming unit: full evaluation computed then yielded field-by-field (cosmetic stream) vs Groq `stream=True` token chunks accumulated and parsed incrementally. Groq JSON mode with streaming accumulates tokens before a valid JSON object can be parsed — cosmetic streaming is the practical approach; document it honestly.
- Disable response buffering (uvicorn flag or response headers like `X-Accel-Buffering: no`).

**Validation.** `curl -N http://localhost:8000/evaluation/answer -X POST -H 'Content-Type: application/json' -d '{"question":"...","transcript_clean":"..."}'` — observe `data:` lines arriving with visible time gaps, terminated by `[DONE]`. Field arrival should be monotonic over wall-clock time, not bursty at the end.

**Main risk.** Fake streaming is unavoidable with JSON mode. Accept it and verify the UI experience is still fluid — fields should appear with small gaps, not all at once after a long pause.

---

## Phase 7 — FastAPI app wiring

**Goal.** All backend endpoints reachable end-to-end via HTTP.

**Scope.**
- Verify `main.py` lifespan calls `init_db()` and warms the RAG collection (or document that indexing is a manual step).
- Confirm CORS allows the Vite origin and works for both regular POST and SSE.
- Register all four routers; reach each one via `/docs`.

**Validation.** `uvicorn app.main:app --reload` starts cleanly. Run a curl sequence: create session → POST clean transcript → POST evaluate (SSE) → POST save answer → GET sessions list → GET answers for that session. Every step returns 2xx with the expected shape.

**Main risk.** SSE + CORS preflight. Browsers handle SSE differently than fetch; verifying via curl is necessary but not sufficient — Phase 9 will catch the rest.

---

## Phase 8 — Frontend foundation (no backend dependency)

**Goal.** Question loading and voice capture work in the browser, standalone.

**Scope.**
- Strip the Vite template remnants (`App.css`, `assets/`, `public/icons.svg`) that are no longer referenced.
- Verify Tailwind v4 + the new `@import "tailwindcss"` setup actually produces utility classes (inspect a built class in devtools).
- `useSpeech` hook: handle permission denied, browser unsupported, and `onerror` events.
- Question loader: accept the JSON shape from GUIDELINES (`text`, `category`, `target_experience`) and a `QuestionSet` shape from Phase 12.

**Validation.** `npm run dev`, load a hand-written `questions.json` with 2 items, click record, speak a sentence, observe live transcript in the UI. No network calls fired yet.

**Main risk.** Web Speech API gaps — Safari support is patchy, mobile flaky. Confirm target browser (Chrome desktop) up front and gate the UI when unsupported rather than silently failing.

---

## Phase 9 — Frontend ↔ backend integration

**Goal.** Single answer flows: record → clean → evaluate (streamed) → render card.

**Scope.**
- Wire `api/client.ts` to the Vite proxy (`/api` → `localhost:8000`).
- Verify the SSE async generator parses real `data:` lines and ignores `[DONE]`.
- `EvaluationCard` renders partial state cleanly — no flicker, no crash on missing fields mid-stream.

**Validation.** In the browser, complete one answer end-to-end. Observe: cleaned transcript appears under raw; then dimensions populate one by one with visible gaps; finally strength/improvement boxes render. Check devtools Network tab — the SSE request shows `text/event-stream` and stays open until done.

**Main risk.** Vite dev proxy buffering SSE. If chunks arrive batched, configure the proxy explicitly or switch to direct `http://localhost:8000` in dev with CORS already in place from Phase 7.

---

## Phase 10 — Multi-question session loop + persistence

**Goal.** Run a full N-question session with every answer saved.

**Scope.**
- App-level state machine: `setup → session(qIndex) → done`.
- On session start: `createSession`, store `session_id`.
- Per answer: after stream completes, `saveAnswer` with the full evaluation JSON. Reset transcript and evaluation state before advancing.
- Block "Next" while streaming or saving.

**Validation.** Complete a 3-question session in the browser. Open the SQLite file (`sqlite3 backend/prepwise.db "SELECT id, session_id, question, overall_score FROM answers"`): exactly 3 rows for that `session_id`, each with a parseable `evaluation_json` and a score in range.

**Main risk.** Save races stream-complete. If `saveAnswer` fires before the last chunk arrives, the persisted JSON is incomplete. Drive the save off stream-end, not off a timer or button click during streaming.

---

## Phase 11 — Session summary (backend + UI together)

**Goal.** End-of-session summary that's actually useful — paste-into-Claude transcript block plus structured aggregates.

**Scope.**
- `summarise_session()`: compute averages locally (don't trust the LLM for arithmetic), call Groq only for `weakest_dimension`, `top_improvements`, and assembling `full_transcript`.
- `POST /evaluation/session/summary` endpoint.
- "Session complete" view: dimension averages, weakest dimension highlighted, top-3 improvement bullets, full transcript with copy-to-clipboard.

**Validation.** Finish a session in the browser. Verify the displayed averages match what you'd compute by hand from the saved answer rows. Click "copy transcript," paste into a scratch buffer, confirm it's well-formed (question/answer pairs, no JSON noise).

**Main risk.** Asking the LLM to do math. Even llama-3.3-70b will occasionally miscompute averages over 5+ items. Compute aggregates in Python; let the LLM judge qualitative things only.

---

## Phase 12 — JD-aware question generation (manual tool calling)

**Goal.** The CV-signal feature: a real, hand-rolled function-calling loop.

**Scope.**
- Pick the search provider (Tavily / Serper / Brave) and store its key in `.env`.
- Declare two function tools: `fetch_jd(url) -> str` and `search_company(query) -> list[result]`.
- Manual loop using Groq's OpenAI-compatible tool calling: send prompt + `tools=[...]` → if response has `tool_calls`, execute locally, append `tool` role message with result, repeat → when response has no `tool_calls`, parse content as `QuestionSet` via JSON mode.
- Cap loop iterations (e.g. 5) to prevent runaway.
- `POST /questions/generate` returns the `QuestionSet`; UI lets the user save the JSON.

**Validation.** Submit a real JD URL (a public Greenhouse or Lever posting). Receive 10 questions where: at least 2 reference company-specific context from search; at least 2 reference candidate background from RAG (e.g. mention Lazzo or IST). Save the JSON, load it via the question loader from Phase 8, run a session.

**Main risk.** Loop bugs — infinite loops if `function_response` is malformed, or premature termination if the model returns mixed text+function-call. Test with `print()` instrumentation on the loop and write down the expected message sequence before coding.

---

## Phase 13 — History view

**Goal.** Score trends across sessions.

**Scope.**
- `GET /sessions` already exists; add `GET /sessions/{id}/summary` or compute averages client-side from `/sessions/{id}/answers`.
- History page: list of past sessions with date + overall average; click into one to see answers; an inline SVG sparkline (no chart library) of overall_score over time.

**Validation.** Complete 3 sessions. History view shows 3 entries in reverse chronological order, each with correct averages. Sparkline renders with 3 points; clicking a session opens the answer list.

**Main risk.** Scope creep into chart-library land. Stay with a hand-rolled SVG sparkline; the history view is not the CV story.

---

## Phase 14 — Test suite as a push gate

**Goal.** `pytest` green is the precondition for `git push`.

**Scope.**
- Consolidate the assertions written during Phases 1, 3, 5: model validation, RAG retrieval correctness, live-LLM strong-vs-vague scoring.
- Mark live-LLM tests (Phases 4, 5) with a `@pytest.mark.live` marker; skip by default; run on push.
- Pre-push git hook (or GitHub Actions on push) that runs the full suite including `live`.
- Document threshold rationale: scoring tests use generous margins (≥3.5 / ≤2.5) because the LLM is non-deterministic.

**Validation.** `pytest -q` exits 0 on a clean checkout. Intentionally weaken a prompt (e.g. remove "be specific" from the evaluation prompt), confirm the strong-vs-vague test catches the regression. Push attempt with a broken test is rejected by the hook.

**Main risk.** Flakiness. Live-LLM tests can fail on a bad weather day. Mitigate with: comfortable threshold margins, retry-once on a single test, and a `SKIP_LIVE_TESTS=1` escape hatch for offline work.

---

## Out of scope for this roadmap

Per GUIDELINES — these stay in Claude chat, not in the tool:
- Company research and role scoring
- Cover letter generation
- Deep qualitative feedback on answers
- Strategic fit judgment
