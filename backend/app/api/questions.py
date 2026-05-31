import asyncio

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.models.evaluation import QuestionSet
from app.services.llm import generate_questions

router = APIRouter(prefix="/questions", tags=["questions"])


class GenerateRequest(BaseModel):
    jd_url: str


@router.post("/generate", response_model=QuestionSet)
async def generate(body: GenerateRequest) -> QuestionSet:
    try:
        return await asyncio.to_thread(generate_questions, body.jd_url)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Question generation failed: {e}")
