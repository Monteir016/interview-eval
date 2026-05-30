import pytest
from app.models.evaluation import AnswerEvaluation, SessionSummary, QuestionSet, DimensionScore

STRONG_ANSWER = (
    "At Lazzo I owned the real-time photo upload feature end-to-end. "
    "I designed a 24-hour upload window using Supabase Storage and Realtime channels, "
    "reducing post-event coordination messages by about 60% based on user feedback. "
    "The architecture decision was to use WebSocket channels over polling for latency reasons."
)

VAGUE_ANSWER = "I worked on some projects and did various things that were pretty good."

QUESTION = "Tell me about a time you designed a system feature from scratch."


def _make_eval(score: int) -> AnswerEvaluation:
    dim = DimensionScore(score=score, feedback="feedback")
    return AnswerEvaluation(
        question=QUESTION,
        transcript_clean=STRONG_ANSWER,
        specificity=dim,
        evidence=dim,
        relevance=dim,
        structure=dim,
        overall_score=float(score),
        key_strength="strength",
        key_improvement="improvement",
    )


def test_answer_evaluation_fields():
    e = _make_eval(4)
    assert 1 <= e.specificity.score <= 5
    assert 1 <= e.evidence.score <= 5
    assert 1 <= e.relevance.score <= 5
    assert 1 <= e.structure.score <= 5
    assert 1.0 <= e.overall_score <= 5.0
    assert e.key_strength
    assert e.key_improvement


def test_score_range_validation():
    with pytest.raises(Exception):
        DimensionScore(score=6, feedback="too high")
    with pytest.raises(Exception):
        DimensionScore(score=0, feedback="too low")


def test_session_summary_fields():
    summary = SessionSummary(
        session_id=1,
        avg_specificity=3.5,
        avg_evidence=4.0,
        avg_relevance=3.0,
        avg_structure=4.5,
        avg_overall=3.75,
        weakest_dimension="relevance",
        top_improvements=["Be more specific", "Add metrics", "Structure better"],
        full_transcript="Q1: ...",
    )
    assert summary.weakest_dimension == "relevance"
    assert len(summary.top_improvements) == 3


def test_question_set_structure():
    qs = QuestionSet(
        company="Acme",
        role="Software Engineer",
        questions=[],
    )
    assert qs.company == "Acme"
