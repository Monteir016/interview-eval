import pytest
from app.services.llm import clean_transcript

NOISY = (
    "Um, like, yeah so I, I worked on, you know, this thing at Lazzo "
    "where um we, we built a real-time photo upload feature and it was, "
    "like, pretty complex you know."
)

CLEAN = (
    "I worked at Lazzo where we built a real-time photo upload feature, "
    "which was complex."
)

FILLERS = ("um", "uh", "like,", "you know", "yeah so")


@pytest.mark.live
def test_clean_transcript_removes_fillers():
    result = clean_transcript(NOISY)
    result_lower = result.lower()
    for filler in FILLERS:
        assert filler not in result_lower, f"filler '{filler}' still present in: {result!r}"
    assert "lazzo" in result_lower
    assert "real-time" in result_lower or "photo" in result_lower
    # First-person voice preserved
    assert " i " in result_lower or result_lower.startswith("i ")


@pytest.mark.live
def test_clean_transcript_preserves_meaning():
    result = clean_transcript(NOISY)
    result_lower = result.lower()
    # Key facts from the original must survive cleaning
    assert "lazzo" in result_lower
    assert "photo" in result_lower or "upload" in result_lower
    # No invented content — result should not be longer than original by more than 10%
    assert len(result) <= len(NOISY) * 1.1


@pytest.mark.live
def test_clean_transcript_idempotent():
    result = clean_transcript(CLEAN)
    result_lower = result.lower()
    assert "lazzo" in result_lower
    assert "real-time" in result_lower or "photo" in result_lower
    # Clean input must not be substantially changed in length
    assert abs(len(result) - len(CLEAN)) < 25
