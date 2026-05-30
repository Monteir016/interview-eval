import pytest
from pydantic import ValidationError

from app.models.evaluation import AnswerEvaluation, DimensionScore, Question, QuestionSet, SessionSummary

STRONG_ANSWER = (
    "At Lazzo I owned the real-time photo upload feature end-to-end. "
    "I designed a 24-hour upload window using Supabase Storage and Realtime channels, "
    "reducing post-event coordination messages by about 60% based on user feedback. "
    "The architecture decision was to use WebSocket channels over polling for latency reasons."
)

VAGUE_ANSWER = "I worked on some projects and did various things that were pretty good."

QUESTION = "Tell me about a time you designed a system feature from scratch."


def _make_dim(score: int = 4) -> DimensionScore:
    return DimensionScore(score=score, feedback="feedback")


def _make_eval(score: int = 4) -> AnswerEvaluation:
    dim = _make_dim(score)
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


# --- DimensionScore ---

def test_dimension_score_bounds():
    assert _make_dim(1).score == 1
    assert _make_dim(5).score == 5


def test_dimension_score_rejects_out_of_range():
    with pytest.raises(ValidationError):
        DimensionScore(score=6, feedback="too high")
    with pytest.raises(ValidationError):
        DimensionScore(score=0, feedback="too low")


def test_dimension_score_requires_feedback():
    with pytest.raises(ValidationError):
        DimensionScore(score=3)


# --- AnswerEvaluation ---

def test_answer_evaluation_fields():
    e = _make_eval(4)
    assert 1 <= e.specificity.score <= 5
    assert 1 <= e.evidence.score <= 5
    assert 1 <= e.relevance.score <= 5
    assert 1 <= e.structure.score <= 5
    assert 1.0 <= e.overall_score <= 5.0
    assert e.key_strength
    assert e.key_improvement


def test_overall_score_range_validation():
    with pytest.raises(ValidationError):
        _make_eval(4).__class__(
            question=QUESTION,
            transcript_clean=STRONG_ANSWER,
            specificity=_make_dim(),
            evidence=_make_dim(),
            relevance=_make_dim(),
            structure=_make_dim(),
            overall_score=0.5,
            key_strength="s",
            key_improvement="i",
        )
    with pytest.raises(ValidationError):
        AnswerEvaluation(
            question=QUESTION,
            transcript_clean=STRONG_ANSWER,
            specificity=_make_dim(),
            evidence=_make_dim(),
            relevance=_make_dim(),
            structure=_make_dim(),
            overall_score=5.5,
            key_strength="s",
            key_improvement="i",
        )


def test_answer_evaluation_missing_required_field():
    with pytest.raises(ValidationError):
        AnswerEvaluation(
            question=QUESTION,
            transcript_clean=STRONG_ANSWER,
            specificity=_make_dim(),
            evidence=_make_dim(),
            relevance=_make_dim(),
            # structure missing
            overall_score=4.0,
            key_strength="s",
            key_improvement="i",
        )


# --- SessionSummary ---

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


def test_session_summary_weakest_dimension_valid_values():
    for dim in ("specificity", "evidence", "relevance", "structure"):
        s = SessionSummary(
            session_id=1,
            avg_specificity=3.0,
            avg_evidence=3.0,
            avg_relevance=3.0,
            avg_structure=3.0,
            avg_overall=3.0,
            weakest_dimension=dim,
            top_improvements=["tip"],
            full_transcript="...",
        )
        assert s.weakest_dimension == dim


def test_session_summary_rejects_invalid_dimension():
    with pytest.raises(ValidationError):
        SessionSummary(
            session_id=1,
            avg_specificity=3.0,
            avg_evidence=3.0,
            avg_relevance=3.0,
            avg_structure=3.0,
            avg_overall=3.0,
            weakest_dimension="creativity",
            top_improvements=["tip"],
            full_transcript="...",
        )


def test_top_improvements_must_be_non_empty():
    with pytest.raises(ValidationError):
        SessionSummary(
            session_id=1,
            avg_specificity=3.0,
            avg_evidence=3.0,
            avg_relevance=3.0,
            avg_structure=3.0,
            avg_overall=3.0,
            weakest_dimension="relevance",
            top_improvements=[],
            full_transcript="...",
        )


def test_top_improvements_max_three():
    with pytest.raises(ValidationError):
        SessionSummary(
            session_id=1,
            avg_specificity=3.0,
            avg_evidence=3.0,
            avg_relevance=3.0,
            avg_structure=3.0,
            avg_overall=3.0,
            weakest_dimension="relevance",
            top_improvements=["a", "b", "c", "d"],
            full_transcript="...",
        )


# --- QuestionSet ---

def test_question_set_structure():
    q = Question(text="Why?", category="behavioural", target_experience="Lazzo")
    qs = QuestionSet(company="Acme", role="SWE", questions=[q])
    assert qs.company == "Acme"
    assert len(qs.questions) == 1


def test_question_set_requires_at_least_one_question():
    with pytest.raises(ValidationError):
        QuestionSet(company="Acme", role="SWE", questions=[])


# --- JSON schema Groq-mode sanity check ---

def test_answer_evaluation_schema_groq_compatible():
    schema = AnswerEvaluation.model_json_schema()
    schema_str = str(schema)
    assert "anyOf" not in schema_str, "schema contains anyOf — likely an Optional field"
    assert '"default"' not in schema_str, "schema contains default values"


def test_session_summary_schema_groq_compatible():
    schema = SessionSummary.model_json_schema()
    schema_str = str(schema)
    assert "anyOf" not in schema_str
    assert '"default"' not in schema_str


def test_question_set_schema_groq_compatible():
    schema = QuestionSet.model_json_schema()
    schema_str = str(schema)
    assert "anyOf" not in schema_str
    assert '"default"' not in schema_str
