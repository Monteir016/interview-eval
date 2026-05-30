import pytest
from app.services.rag import RAGService


@pytest.fixture(scope="module")
def rag():
    svc = RAGService()
    svc.index()
    return svc


def test_index_produces_chunks(rag):
    assert rag.count > 0


def test_query_returns_k_results(rag):
    results = rag.query("IST computer science degree", k=3)
    assert len(results) == 3


def test_query_education_section(rag):
    results = rag.query("university degree IST Lisbon", k=5)
    combined = " ".join(results).lower()
    assert "ist" in combined or "instituto" in combined


def test_query_lazzo_experience(rag):
    results = rag.query("co-founder startup Flutter mobile app", k=5)
    combined = " ".join(results).lower()
    assert "lazzo" in combined or "flutter" in combined


def test_query_returns_strings(rag):
    results = rag.query("any query")
    assert all(isinstance(r, str) for r in results)
