import asyncio
import json
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import settings
from app.models.evaluation import QuestionSet
from app.services.llm import generate_questions

router = APIRouter(prefix="/questions", tags=["questions"])


class GenerateRequest(BaseModel):
    jd_url: str


def _save_to_private(question_set: QuestionSet) -> None:
    private_dir = Path(settings.private_path)
    private_dir.mkdir(parents=True, exist_ok=True)
    slug = re.sub(r"[^a-z0-9-]+", "_", f"{question_set.company}-{question_set.role}".lower()).strip("_")
    out = private_dir / f"{slug}-generated.json"
    out.write_text(json.dumps(question_set.model_dump(), indent=2))


@router.post("/generate", response_model=QuestionSet)
async def generate(body: GenerateRequest) -> QuestionSet:
    try:
        question_set = await asyncio.to_thread(generate_questions, body.jd_url)
        await asyncio.to_thread(_save_to_private, question_set)
        return question_set
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Question generation failed: {e}")
