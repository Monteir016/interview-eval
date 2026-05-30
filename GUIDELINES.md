# Prepwise — Project Guidelines

> Versões e dependências exatas são decididas no momento de build. Este documento define o quê, porquê e com quê — não o como.

---

## What

Voice-based interview simulation tool. The user loads a set of interview questions, records spoken answers, gets a cleaned transcript, and a structured evaluation of each answer. Sessions are persisted and scores are tracked across time.

Built for personal use during an active internship search. The tool solves one specific problem: interview practice happens by typing into a chat window, which is not how interviews work. Voice changes that.

---

## Why It Exists (Beyond Personal Use)

The builder is applying to AI engineering roles. Every target JD requires demonstrated experience with: direct LLM API usage, tool calling, structured outputs, RAG, embeddings, vector databases, streaming, and evaluation frameworks. This project covers all of them in a single, coherent product — not a demo, something actually used.

---

## Stack

| Layer | Choice | Reason |
|---|---|---|
| Frontend | React + TypeScript + Tailwind | Builder's existing stack; looks good on CV |
| Backend | FastAPI (Python) | Python is universal in AI roles; required for CV signal |
| LLM | Gemini Flash (direct SDK, no LangChain) | Free tier sufficient for usage volume |
| Embeddings | Gemini `text-embedding-004` | Free tier; same SDK |
| Vector DB | ChromaDB (local) | Zero infra; open source; appears in AI JDs |
| Transcription | Web Speech API (primary) | Free, browser-native, sufficient quality |
| Transcription | Gemini Live Audio (stretch) | Better quality if Web Speech API frustrates; uses Google AI Pro credits ($10/month, barely touched) |
| Structured outputs | Pydantic + Gemini `response_schema` | Hard requirement across all target JDs |
| Streaming | FastAPI SSE (`StreamingResponse`) | Core signal for production AI systems knowledge |
| Session storage | SQLite | Simple, local, cross-session tracking |
| Tool calling | Gemini function declarations, manual loop | Core AI JD requirement; no helper libraries |

**No LangChain, no LlamaIndex, no LLM framework of any kind.** Direct API calls only.

---

## Core Features

**Question loading** — questions are loaded from a local JSON file (generated externally in Claude chat, not inside the tool). Format: array of objects with `text`, `category`, and `target_experience` fields.

**Voice recording + transcription** — Web Speech API captures audio in the browser and produces a live transcript. No audio file is sent anywhere in the primary flow.

**Transcript cleaning** — raw transcript (with filler words, false starts) is sent to Gemini and returned as a clean, paste-ready text.

**Per-answer evaluation** — Gemini evaluates each answer against a four-dimension rubric: specificity, evidence, relevance, structure. Returns a typed Pydantic object. Streams via SSE so scores appear progressively, not after a full wait. The evaluation retrieves relevant chunks from the RAG layer so feedback references the candidate's actual background, not generic advice.

**RAG over FULL_CONTEXT.md** — the candidate's full professional background is chunked, embedded via `text-embedding-004`, and stored in ChromaDB. Every evaluation query retrieves the top-k most relevant chunks and injects them into the evaluation prompt. This is what makes feedback specific ("you have the V1→V2 pivot which is exactly the evidence this question needs") rather than generic.

**JD-aware question generation** — optional feature. User pastes a JD URL; the backend fetches the JD and searches for company context using an external search API (Tavily, Serper, or Brave — chosen at build time; no direct scraping). Gemini generates 10 tailored questions using tool calling, with the RAG context injected so questions reference the candidate's background. Returns a `QuestionSet` Pydantic object saved as JSON and loadable in the next session.

**Session summary** — after all questions, one Gemini call aggregates all evaluations and returns a `SessionSummary`: average scores per dimension, weakest dimension, top 3 improvements, and a full transcript block ready to paste into Claude for deep feedback.

**Eval test suite** — `pytest` suite with assertions over RAG retrieval (known queries return expected sections of FULL_CONTEXT) and evaluation behavior (strong answers score above threshold, vague answers score below, all required fields present, scores within valid range). Suite must pass before pushing to GitHub.

**Session history** — SQLite stores every session and answer. A history view shows score trends per dimension across sessions.

---

## Key Architectural Decisions

**SSE over WebSocket for streaming** — evaluation responses stream via Server-Sent Events. Simpler than WebSocket for a unidirectional stream, native to FastAPI's `StreamingResponse`, and sufficient for this use case.

**Manual tool calling loop** — the function calling loop for JD fetch and company search is implemented manually: send prompt with tool definitions, handle `function_call` response, execute the function, return `function_response`, repeat. No abstraction layer. This is intentional — it's the signal that matters to AI JD reviewers.

**RAG at evaluation time, not session setup** — FULL_CONTEXT is queried per answer using `question + transcript` as the retrieval query. Not queried once at session start. This produces more relevant chunk retrieval because the specific answer content influences what background context is most useful.

**Pydantic as the evaluation contract** — `AnswerEvaluation`, `SessionSummary`, `QuestionSet` are defined as Pydantic models and passed to Gemini as `response_schema`. These models are the CV-visible artifact — they should be clean, complete, and not changed without reason.

---

## What Is Deliberately Outside the Tool

These stay in Claude chat, not in the product:

- Company research and role scoring
- Cover letter generation  
- Deep qualitative feedback on answers
- Question generation (done in chat, JSON loaded into tool)
- Strategic judgment about fit and goals

The tool owns: simulation, transcription, cleaning, structured scoring, streaming, RAG retrieval, session persistence, eval assertions.

---

## CV Signal This Covers

Direct LLM API — tool calling — structured outputs — SSE streaming — RAG pipeline — embeddings — vector database — agentic multi-turn loop — evaluation framework with assertions — Python backend — TypeScript frontend — voice/multimodal (stretch).

Target bullet:

> **Prepwise** — *React, FastAPI, Gemini Flash, text-embedding-004, ChromaDB, Pydantic*
> Voice interview simulation with RAG over personal CV context, JD-aware question generation via Gemini tool calling, per-answer structured evaluation streamed via SSE, and a pytest eval suite asserting RAG retrieval correctness and scoring consistency; built and used personally during active internship search.
