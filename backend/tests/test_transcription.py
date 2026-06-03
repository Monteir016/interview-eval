import pytest
from app.services.llm import clean_transcript

# Raw speech-to-text: no punctuation, no capitalization, with fillers and duplicated words.
NOISY = (
    "um like yeah so i i worked on you know this thing at lazzo "
    "where um we we built a a real-time photo upload feature and it was "
    "like pretty complex you know"
)

CLEAN = (
    "I worked at Lazzo where we built a real-time photo upload feature, "
    "which was complex."
)

FILLERS = ("um", "uh", "like,", "you know", "yeah so")
TERMINAL_PUNCTUATION = (".", "?", "!")


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
def test_clean_transcript_adds_punctuation():
    result = clean_transcript(NOISY)
    # Headline behavior: raw STT has no punctuation; cleaned output must be a proper sentence.
    assert result[0].isupper(), f"first letter not capitalized: {result!r}"
    assert result.rstrip().endswith(TERMINAL_PUNCTUATION), f"no terminal punctuation: {result!r}"


@pytest.mark.live
def test_clean_transcript_collapses_duplicates():
    result = clean_transcript(NOISY)
    result_lower = result.lower()
    # Adjacent word-for-word duplications from the raw input must be collapsed.
    assert "i i " not in result_lower
    assert "we we " not in result_lower
    assert "a a " not in result_lower


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
