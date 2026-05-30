import json
from groq import Groq
from app.config import settings
from app.models.evaluation import AnswerEvaluation, SessionSummary, QuestionSet

_client = Groq(api_key=settings.groq_api_key)
_MODEL = "llama-3.3-70b-versatile"


def clean_transcript(raw: str) -> str:
    prompt = (
        "Clean the following spoken transcript. Remove filler words (um, uh, like, you know), "
        "false starts, and repetitions. Preserve all meaning and keep first-person voice. "
        "Return only the cleaned text, no explanation.\n\n"
        f"TRANSCRIPT:\n{raw}"
    )
    response = _client.chat.completions.create(
        model=_MODEL,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.choices[0].message.content.strip()


def evaluate_answer(question: str, transcript_clean: str, context_chunks: list[str]) -> AnswerEvaluation:
    context_block = "\n---\n".join(context_chunks)
    schema_example = json.dumps(AnswerEvaluation.model_json_schema(), indent=2)
    prompt = (
        "You are an interview coach evaluating a candidate's answer. "
        "Use the candidate background below to give specific, grounded feedback.\n\n"
        f"CANDIDATE BACKGROUND:\n{context_block}\n\n"
        f"QUESTION: {question}\n\n"
        f"ANSWER: {transcript_clean}\n\n"
        "Evaluate on four dimensions (score 1–5): specificity, evidence, relevance, structure. "
        "For each dimension provide a score (integer 1-5) and one sentence of feedback. "
        "Also provide overall_score (float average of the four scores), key_strength, and key_improvement.\n\n"
        "Return a JSON object matching this schema exactly:\n"
        f"{schema_example}\n\n"
        "The response must be valid JSON only, no markdown, no explanation."
    )
    response = _client.chat.completions.create(
        model=_MODEL,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
    )
    return AnswerEvaluation.model_validate_json(response.choices[0].message.content)


def summarise_session(session_id: int, evaluations: list[AnswerEvaluation]) -> SessionSummary:
    evals_json = json.dumps([e.model_dump() for e in evaluations], indent=2)
    schema_example = json.dumps(SessionSummary.model_json_schema(), indent=2)
    prompt = (
        "Summarise this interview session from the evaluations below.\n\n"
        f"{evals_json}\n\n"
        "Return avg scores per dimension, weakest_dimension, top 3 improvements, "
        "and a full_transcript block combining all cleaned answers.\n\n"
        "Return a JSON object matching this schema exactly:\n"
        f"{schema_example}\n\n"
        "The response must be valid JSON only, no markdown, no explanation."
    )
    response = _client.chat.completions.create(
        model=_MODEL,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
    )
    summary = SessionSummary.model_validate_json(response.choices[0].message.content)
    summary.session_id = session_id
    return summary


def generate_questions(jd_text: str, context_chunks: list[str]) -> QuestionSet:
    context_block = "\n---\n".join(context_chunks)
    schema_example = json.dumps(QuestionSet.model_json_schema(), indent=2)
    prompt = (
        "Generate 10 interview questions tailored to the job description below, "
        "referencing the candidate's background where relevant.\n\n"
        f"CANDIDATE BACKGROUND:\n{context_block}\n\n"
        f"JOB DESCRIPTION:\n{jd_text}\n\n"
        "Return a QuestionSet with company, role, and 10 questions each with text, category, target_experience.\n\n"
        "Return a JSON object matching this schema exactly:\n"
        f"{schema_example}\n\n"
        "The response must be valid JSON only, no markdown, no explanation."
    )
    response = _client.chat.completions.create(
        model=_MODEL,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
    )
    return QuestionSet.model_validate_json(response.choices[0].message.content)
