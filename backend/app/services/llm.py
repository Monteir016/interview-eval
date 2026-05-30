import json
import google.generativeai as genai
from app.config import settings
from app.models.evaluation import AnswerEvaluation, SessionSummary, QuestionSet

genai.configure(api_key=settings.gemini_api_key)

_flash = genai.GenerativeModel("gemini-2.0-flash")


def clean_transcript(raw: str) -> str:
    prompt = (
        "Clean the following spoken transcript. Remove filler words (um, uh, like, you know), "
        "false starts, and repetitions. Preserve all meaning and keep first-person voice. "
        "Return only the cleaned text, no explanation.\n\n"
        f"TRANSCRIPT:\n{raw}"
    )
    response = _flash.generate_content(prompt)
    return response.text.strip()


def evaluate_answer(question: str, transcript_clean: str, context_chunks: list[str]) -> AnswerEvaluation:
    context_block = "\n---\n".join(context_chunks)
    prompt = (
        "You are an interview coach evaluating a candidate's answer. "
        "Use the candidate background below to give specific, grounded feedback.\n\n"
        f"CANDIDATE BACKGROUND:\n{context_block}\n\n"
        f"QUESTION: {question}\n\n"
        f"ANSWER: {transcript_clean}\n\n"
        "Evaluate on four dimensions (score 1–5): specificity, evidence, relevance, structure. "
        "For each, give a score and one sentence of feedback. "
        "Also give overall_score (average), key_strength, and key_improvement."
    )
    response = _flash.generate_content(
        prompt,
        generation_config=genai.GenerationConfig(
            response_mime_type="application/json",
            response_schema=AnswerEvaluation,
        ),
    )
    return AnswerEvaluation.model_validate_json(response.text)


def summarise_session(session_id: int, evaluations: list[AnswerEvaluation]) -> SessionSummary:
    evals_json = json.dumps([e.model_dump() for e in evaluations], indent=2)
    prompt = (
        "Summarise this interview session from the evaluations below.\n\n"
        f"{evals_json}\n\n"
        "Return avg scores per dimension, weakest_dimension, top 3 improvements, "
        "and a full_transcript block combining all cleaned answers."
    )
    response = _flash.generate_content(
        prompt,
        generation_config=genai.GenerationConfig(
            response_mime_type="application/json",
            response_schema=SessionSummary,
        ),
    )
    summary = SessionSummary.model_validate_json(response.text)
    summary.session_id = session_id
    return summary


def generate_questions(jd_text: str, context_chunks: list[str]) -> QuestionSet:
    context_block = "\n---\n".join(context_chunks)
    prompt = (
        "Generate 10 interview questions tailored to the job description below, "
        "referencing the candidate's background where relevant.\n\n"
        f"CANDIDATE BACKGROUND:\n{context_block}\n\n"
        f"JOB DESCRIPTION:\n{jd_text}\n\n"
        "Return a QuestionSet with company, role, and 10 questions each with text, category, target_experience."
    )
    response = _flash.generate_content(
        prompt,
        generation_config=genai.GenerationConfig(
            response_mime_type="application/json",
            response_schema=QuestionSet,
        ),
    )
    return QuestionSet.model_validate_json(response.text)
