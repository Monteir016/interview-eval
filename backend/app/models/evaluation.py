from typing import Literal

from pydantic import BaseModel, Field

Dimension = Literal["specificity", "evidence", "relevance", "structure"]


class DimensionScore(BaseModel):
    score: int = Field(..., ge=1, le=5)
    feedback: str


class AnswerEvaluation(BaseModel):
    question: str
    transcript_clean: str
    specificity: DimensionScore
    evidence: DimensionScore
    relevance: DimensionScore
    structure: DimensionScore
    overall_score: float = Field(..., ge=1.0, le=5.0)
    key_strength: str
    key_improvement: str


class SessionSummary(BaseModel):
    session_id: int
    avg_specificity: float
    avg_evidence: float
    avg_relevance: float
    avg_structure: float
    avg_overall: float
    weakest_dimension: Dimension
    top_improvements: list[str] = Field(..., min_length=1, max_length=3)
    full_transcript: str


class Question(BaseModel):
    text: str
    category: str
    target_experience: str


class QuestionSet(BaseModel):
    company: str
    role: str
    questions: list[Question] = Field(..., min_length=1)
