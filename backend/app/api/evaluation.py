import asyncio
import json
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from app.models.evaluation import AnswerEvaluation, SessionSummary
from app.services.llm import evaluate_answer, summarise_session
from app.services.rag import RAGService

router = APIRouter(prefix="/evaluation", tags=["evaluation"])
_rag = RAGService()


class EvaluateRequest(BaseModel):
    question: str
    transcript_clean: str


class SummariseRequest(BaseModel):
    session_id: int
    evaluations: list[AnswerEvaluation]


_SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
    "Connection": "keep-alive",
}

# Delay between each yielded field — cosmetic streaming (full eval computed first,
# then fields emitted progressively). True token-level streaming isn't viable with
# Groq JSON mode since the JSON object can't be parsed until the stream is complete.
_FIELD_DELAY = 0.05


@router.post("/answer")
async def evaluate(body: EvaluateRequest) -> StreamingResponse:
    query = f"{body.question} {body.transcript_clean}"
    chunks = await asyncio.to_thread(_rag.query, query)
    evaluation = await asyncio.to_thread(evaluate_answer, body.question, body.transcript_clean, chunks)

    async def stream():
        data = evaluation.model_dump()
        for key, value in data.items():
            yield f"data: {json.dumps({key: value})}\n\n"
            await asyncio.sleep(_FIELD_DELAY)
        yield "data: [DONE]\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream", headers=_SSE_HEADERS)


@router.post("/session/summary", response_model=SessionSummary)
async def summarise(body: SummariseRequest) -> SessionSummary:
    return await asyncio.to_thread(summarise_session, body.session_id, body.evaluations)
