import pytest
from app.services.rag import RAGService, _chunk_sections


# --- Pure chunking unit tests (no Ollama) ---

def test_chunk_sections_splits_on_h2():
    text = "## Section A\n\nContent A here.\n\n## Section B\n\nContent B here."
    chunks = _chunk_sections(text)
    assert len(chunks) == 2
    assert chunks[0].startswith("## Section A")
    assert chunks[1].startswith("## Section B")


def test_chunk_sections_keeps_preamble_before_first_h2():
    text = "# Title\n\nIntro text.\n\n## Section A\n\nContent A."
    chunks = _chunk_sections(text)
    assert len(chunks) == 2
    assert "Intro text" in chunks[0]
    assert chunks[1].startswith("## Section A")


def test_chunk_sections_preserves_h2_header_when_splitting_on_h3():
    body = " ".join(["word"] * 200)
    text = (
        "## Big Section\n\nintro\n\n"
        f"### Sub One\n\n{body}\n\n"
        f"### Sub Two\n\n{body}"
    )
    chunks = _chunk_sections(text, max_words=100)
    assert any("## Big Section" in c and "### Sub One" in c for c in chunks)
    assert any("## Big Section" in c and "### Sub Two" in c for c in chunks)


def test_chunk_sections_word_window_fallback_for_oversized():
    long_body = " ".join(["word"] * 1500)
    text = f"## Huge\n\n{long_body}"
    chunks = _chunk_sections(text, max_words=400)
    assert len(chunks) > 1
    for c in chunks:
        assert len(c.split()) <= 400


def test_chunk_sections_drops_blank_input():
    assert _chunk_sections("") == []


# --- Live tests (require Ollama running) ---

@pytest.fixture(scope="module")
def rag():
    svc = RAGService()
    svc.index()
    return svc


@pytest.mark.live
def test_index_produces_chunks(rag):
    assert rag.count > 0


@pytest.mark.live
def test_index_is_idempotent(rag):
    before = rag.count
    rag.index()
    assert rag.count == before


@pytest.mark.live
def test_query_returns_k_results(rag):
    results = rag.query("IST computer science degree", k=3)
    assert len(results) == 3


@pytest.mark.live
def test_query_education_section(rag):
    results = rag.query("university degree IST Lisbon", k=5)
    combined = " ".join(results).lower()
    assert "ist" in combined or "instituto" in combined


@pytest.mark.live
def test_query_lazzo_experience(rag):
    results = rag.query("co-founder startup Flutter mobile app", k=5)
    combined = " ".join(results).lower()
    assert "lazzo" in combined or "flutter" in combined


@pytest.mark.live
def test_query_react_native_returns_lazzo_stack(rag):
    """ROADMAP manual check: 'react native frontend' should surface Lazzo's
    Flutter stack, not unrelated coursework."""
    results = rag.query("react native frontend", k=3)
    combined = " ".join(results).lower()
    assert "lazzo" in combined or "flutter" in combined or "next.js" in combined


@pytest.mark.live
def test_query_returns_strings(rag):
    results = rag.query("any query")
    assert all(isinstance(r, str) for r in results)
