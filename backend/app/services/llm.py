import json
from groq import Groq
from app.config import settings
from app.models.evaluation import AnswerEvaluation, SessionSummary, QuestionSet

_client = Groq(api_key=settings.groq_api_key)
_MODEL = "llama-3.3-70b-versatile"


def clean_transcript(raw: str) -> str:
    prompt = (
        "You are a transcript editor. Your only job is to remove noise from spoken text.\n\n"
        "Rules (follow all of them):\n"
        "1. Remove filler words: um, uh, like, you know, so, yeah, right, basically, literally.\n"
        "2. Remove false starts (e.g. 'I, I worked' → 'I worked'; 'we, we built' → 'we built').\n"
        "3. Remove immediate word-for-word repetitions.\n"
        "4. Do NOT rephrase, paraphrase, or rewrite any sentence.\n"
        "5. Do NOT improve grammar, style, or word choice beyond removing the items above.\n"
        "6. Keep first-person voice exactly as-is ('I', 'we', 'my', 'our').\n"
        "7. Do NOT add any words, context, or explanation that were not in the original.\n"
        "8. If the transcript is already clean, return it unchanged.\n"
        "9. Return only the cleaned text — no preamble, no quotes, no explanation.\n\n"
        f"TRANSCRIPT:\n{raw}"
    )
    response = _client.chat.completions.create(
        model=_MODEL,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.choices[0].message.content.strip()


_EVAL_EXAMPLE = {
    "specificity": {"score": 4, "feedback": "Names the project and the specific feature owned."},
    "evidence": {"score": 3, "feedback": "Mentions outcomes but lacks quantified metrics."},
    "relevance": {"score": 5, "feedback": "Directly addresses the system-design focus of the question."},
    "structure": {"score": 4, "feedback": "Clear situation-action-result arc."},
    "overall_score": 4.0,
    "key_strength": "Concrete technical decision tied to a real shipped project.",
    "key_improvement": "Quantify the outcome — latency, adoption, or retention numbers.",
}


def evaluate_answer(question: str, transcript_clean: str, context_chunks: list[str]) -> AnswerEvaluation:
    context_block = "\n---\n".join(context_chunks)
    example_json = json.dumps(_EVAL_EXAMPLE, indent=2)
    prompt = (
        "You are an interview coach evaluating a candidate's spoken answer. "
        "Ground every piece of feedback in the CANDIDATE BACKGROUND below — "
        "reference specific projects, companies, or experiences from it when relevant. "
        "Do not give generic advice that ignores the candidate's actual history.\n\n"
        f"CANDIDATE BACKGROUND:\n{context_block}\n\n"
        f"QUESTION:\n{question}\n\n"
        f"ANSWER:\n{transcript_clean}\n\n"
        "Score the answer on four dimensions, each integer 1-5:\n"
        "  - specificity: names concrete projects, technologies, and decisions (not vague claims).\n"
        "  - evidence: backs claims with metrics, outcomes, or observable artefacts.\n"
        "  - relevance: directly addresses what the question asked.\n"
        "  - structure: clear situation-action-result arc; not rambling.\n\n"
        "Scoring rubric — use the full range:\n"
        "  1 = poor, 2 = weak, 3 = adequate, 4 = strong, 5 = excellent.\n"
        "A one-sentence vague answer with no specifics should score 1-2 across all dimensions.\n"
        "An answer with concrete projects, quantified outcomes, and clear structure should score 4-5.\n\n"
        "`overall_score` must be the arithmetic mean of the four dimension scores (float, 1 decimal).\n"
        "Each `feedback` field must be exactly one sentence. "
        "`key_strength` and `key_improvement` must each be exactly one sentence.\n\n"
        "Return a JSON object with EXACTLY these fields and shape — no extras, no markdown:\n"
        f"{example_json}"
    )
    response = _client.chat.completions.create(
        model=_MODEL,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
    )
    data = json.loads(response.choices[0].message.content)
    data["question"] = question
    data["transcript_clean"] = transcript_clean
    return AnswerEvaluation.model_validate(data)


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
