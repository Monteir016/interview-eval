import asyncio
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.models.evaluation import QuestionSet
from app.services.llm import generate_questions
from app.services.rag import RAGService

router = APIRouter(prefix="/questions", tags=["questions"])
_rag = RAGService()


class GenerateRequest(BaseModel):
    jd_url: str


async def _fetch_jd(url: str) -> str:
    async with httpx.AsyncClient(follow_redirects=True, timeout=15) as client:
        response = await client.get(url)
        if response.status_code != 200:
            raise HTTPException(status_code=400, detail="Could not fetch JD URL")
        return response.text


@router.post("/generate", response_model=QuestionSet)
async def generate(body: GenerateRequest) -> QuestionSet:
    jd_text = await _fetch_jd(body.jd_url)
    context_chunks = await asyncio.to_thread(_rag.query, jd_text[:500])
    return await asyncio.to_thread(generate_questions, jd_text, context_chunks)
