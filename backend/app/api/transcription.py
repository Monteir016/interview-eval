from fastapi import APIRouter
from pydantic import BaseModel
from app.services.llm import clean_transcript

router = APIRouter(prefix="/transcription", tags=["transcription"])


class CleanRequest(BaseModel):
    raw: str


class CleanResponse(BaseModel):
    clean: str


@router.post("/clean", response_model=CleanResponse)
async def clean(body: CleanRequest) -> CleanResponse:
    return CleanResponse(clean=clean_transcript(body.raw))
