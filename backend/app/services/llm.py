import json
import logging
from pathlib import Path
from typing import Any

from groq import Groq

from app.config import settings
from app.models.evaluation import AnswerEvaluation, SessionSummary, QuestionSet
from app.services import tools as _tools

logger = logging.getLogger(__name__)

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
    n = len(evaluations)
    avg_specificity = round(sum(e.specificity.score for e in evaluations) / n, 2)
    avg_evidence = round(sum(e.evidence.score for e in evaluations) / n, 2)
    avg_relevance = round(sum(e.relevance.score for e in evaluations) / n, 2)
    avg_structure = round(sum(e.structure.score for e in evaluations) / n, 2)
    avg_overall = round(sum(e.overall_score for e in evaluations) / n, 2)

    dim_avgs = {
        "specificity": avg_specificity,
        "evidence": avg_evidence,
        "relevance": avg_relevance,
        "structure": avg_structure,
    }
    weakest_dimension = min(dim_avgs, key=lambda k: dim_avgs[k])

    full_transcript = "\n\n".join(
        f"Q: {e.question}\nA: {e.transcript_clean}" for e in evaluations
    )

    prompt = (
        "You are an interview coach. Based on these interview answer evaluations, "
        "list exactly 3 concrete, actionable improvements for this candidate.\n\n"
        "Be specific: reference the candidate's actual patterns (e.g. 'your answers describe "
        "what you did but rarely name the measurable outcome'), not generic advice.\n\n"
        f"Evaluations:\n{json.dumps([e.model_dump() for e in evaluations], indent=2)}\n\n"
        'Return a JSON object with exactly this shape:\n'
        '{"top_improvements": ["improvement 1", "improvement 2", "improvement 3"]}'
    )
    response = _client.chat.completions.create(
        model=_MODEL,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
    )
    data = json.loads(response.choices[0].message.content)
    top_improvements = data["top_improvements"][:3]

    return SessionSummary(
        session_id=session_id,
        avg_specificity=avg_specificity,
        avg_evidence=avg_evidence,
        avg_relevance=avg_relevance,
        avg_structure=avg_structure,
        avg_overall=avg_overall,
        weakest_dimension=weakest_dimension,
        top_improvements=top_improvements,
        full_transcript=full_transcript,
    )


_QUESTION_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "fetch_jd",
            "description": (
                "Fetch the cleaned text content of a job description from a URL. "
                "Call this once with the JD URL the user provides."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "The URL of the job posting."}
                },
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_company",
            "description": (
                "Search the web for information about a company — engineering culture, "
                "tech stack, products, recent news. Use after fetch_jd to enrich context."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": (
                            "Search query, typically the company name optionally with a topic "
                            "like 'engineering blog' or 'product launches'."
                        ),
                    }
                },
                "required": ["query"],
            },
        },
    },
]

_TOOL_HANDLERS = {
    "fetch_jd": _tools.fetch_jd,
    "search_company": _tools.search_company,
}

_MAX_TOOL_ITERATIONS = 5

_candidate_context_cache: str | None = None


def _candidate_context() -> str:
    global _candidate_context_cache
    if _candidate_context_cache is None:
        _candidate_context_cache = Path(settings.full_context_path).read_text()
    return _candidate_context_cache


def _strip_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    return text


def generate_questions(jd_url: str, count: int = 10) -> QuestionSet:
    """Run a manual tool-calling loop to produce a JD-tailored QuestionSet.

    Expected message sequence on the happy path:
        1. system + user (start)
        2. assistant: tool_calls = [fetch_jd]
        3. tool: fetch_jd result
        4. assistant: tool_calls = [search_company]
        5. tool: search_company result
        6. assistant: content = QuestionSet JSON (no tool_calls → return)

    `FULL_CONTEXT.md` is embedded fully in the system prompt — for question
    generation we want comprehensive coverage of the candidate, not the surgical
    top-k retrieval RAG provides during evaluation.
    """
    count = max(1, min(count, 10))
    grounded_min = max(1, round(count * 0.3))
    company_min = max(1, round(count * 0.2))
    schema_example = json.dumps(QuestionSet.model_json_schema(), indent=2)
    system_prompt = (
        "You are an expert interview question writer for THIS specific candidate going into "
        "THIS specific role. Your goal is questions that could only be asked of this person "
        "applying to this company — not generic interview questions.\n\n"
        "NON-NEGOTIABLE REQUIREMENTS:\n"
        f"  - At least {grounded_min} of the {count} questions MUST name a specific candidate experience "
        "(e.g. 'At Lazzo, you …', 'In your IST coursework on …', 'When you ran the marketing "
        "agency …'). Vague 'tell me about a challenging project' without naming the project "
        "is forbidden.\n"
        f"  - At least {company_min} questions MUST reference company-specific context you found via "
        "search (the company's actual product, tech stack, or recent moves) — not generic "
        "company-fit questions.\n"
        "  - The remaining questions can be broader role-fit questions but must still tie to the JD.\n\n"
        "WORKFLOW:\n"
        "  1. Call `fetch_jd` with the URL the user provides to load the JD text.\n"
        "  2. Call `search_company` once with the company name (plus a topic like "
        "'engineering blog' if useful) to gather context beyond the JD.\n"
        f"  3. Generate exactly {count} questions per the requirements above.\n"
        "  4. Return ONLY a JSON object matching the QuestionSet schema — no markdown, "
        "no explanation, no preamble.\n\n"
        "EXAMPLES of grounded questions (do this):\n"
        "  - 'At Lazzo you found the product performs strongest at events with 15+ mixed-group "
        "attendees. How did you isolate that insight, and how would you apply that kind of "
        "segmentation work to Amplemarket's outbound use cases?'\n"
        "  - 'You shipped Lazzo's iOS beta through TestFlight as a two-person team. Walk us "
        "through your release process and what you'd change for a larger engineering org.'\n\n"
        "EXAMPLES of generic questions (DO NOT do this — they would be rejected):\n"
        "  - 'Describe your experience with full-stack development.'\n"
        "  - 'How do you approach state management in React applications?'\n"
        "  - 'Tell me about a challenging technical problem.'\n\n"
        f"CANDIDATE BACKGROUND:\n{_candidate_context()}\n\n"
        f"QuestionSet JSON schema:\n{schema_example}"
    )

    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
        {
            "role": "user",
            "content": f"Generate exactly {count} interview questions for this job posting: {jd_url}",
        },
    ]

    for iteration in range(_MAX_TOOL_ITERATIONS):
        response = _client.chat.completions.create(
            model=_MODEL,
            messages=messages,
            tools=_QUESTION_TOOLS,
            tool_choice="auto",
        )
        msg = response.choices[0].message

        if not msg.tool_calls:
            logger.info("Tool loop done at iteration %d", iteration)
            return QuestionSet.model_validate_json(_strip_fences(msg.content or ""))

        logger.info(
            "Tool loop iteration %d: %s",
            iteration,
            [tc.function.name for tc in msg.tool_calls],
        )
        messages.append({
            "role": "assistant",
            "content": msg.content or "",
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.function.name,
                        "arguments": tc.function.arguments,
                    },
                }
                for tc in msg.tool_calls
            ],
        })
        for tc in msg.tool_calls:
            handler = _TOOL_HANDLERS.get(tc.function.name)
            if handler is None:
                result = f"ERROR: unknown tool '{tc.function.name}'"
            else:
                try:
                    args = json.loads(tc.function.arguments)
                    result = handler(**args)
                except Exception as e:
                    result = f"ERROR executing {tc.function.name}: {type(e).__name__}: {e}"
            messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": result,
            })

    # Loop exhausted without a final response — force one with json_object mode.
    logger.warning("Tool loop hit max iterations; forcing final answer")
    messages.append({
        "role": "user",
        "content": (
            "You've used the available tools. Now return ONLY the QuestionSet JSON object."
        ),
    })
    final = _client.chat.completions.create(
        model=_MODEL,
        messages=messages,
        response_format={"type": "json_object"},
    )
    return QuestionSet.model_validate_json(final.choices[0].message.content)
