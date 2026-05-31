import re
import sys
import httpx
import chromadb
from app.config import settings

COLLECTION_NAME = "full_context"
MAX_CHUNK_WORDS = 600
WORD_WINDOW_OVERLAP = 100

# Nomic API
_NOMIC_EMBED_URL = "https://api-atlas.nomic.ai/v1/embedding/text"
_NOMIC_MODEL = "nomic-embed-text-v1.5"

# Ollama fallback (local dev without NOMIC_API_KEY)
_OLLAMA_EMBED_URL = "http://localhost:11434/api/embeddings"
_OLLAMA_MODEL = "nomic-embed-text"


def _chunk_sections(text: str, max_words: int = MAX_CHUNK_WORDS) -> list[str]:
    """Split markdown on H2 (``## ``) sections.

    Sections larger than ``max_words`` are split further on H3 (``### ``)
    subheadings, with the parent H2 heading prepended to each subsection so
    retrieved chunks keep their context. Anything still oversized falls back
    to a word-window split.
    """
    sections = [s.strip() for s in re.split(r"(?=^## )", text, flags=re.MULTILINE) if s.strip()]
    chunks: list[str] = []

    for section in sections:
        if len(section.split()) <= max_words:
            chunks.append(section)
            continue

        h2_match = re.match(r"^(## .+?)$", section, flags=re.MULTILINE)
        h2_header = h2_match.group(1) if h2_match else ""

        subsections = [s.strip() for s in re.split(r"(?=^### )", section, flags=re.MULTILINE) if s.strip()]
        for sub in subsections:
            if sub.startswith("### "):
                chunks.append(f"{h2_header}\n\n{sub}")
            else:
                chunks.append(sub)

    final: list[str] = []
    for chunk in chunks:
        words = chunk.split()
        if len(words) <= max_words:
            final.append(chunk)
            continue
        step = max(1, max_words - WORD_WINDOW_OVERLAP)
        for start in range(0, len(words), step):
            final.append(" ".join(words[start:start + max_words]))
    return final


def _embed_nomic(texts: list[str], task_type: str) -> list[list[float]]:
    r = httpx.post(
        _NOMIC_EMBED_URL,
        headers={"Authorization": f"Bearer {settings.nomic_api_key}"},
        json={"texts": texts, "model": _NOMIC_MODEL, "task_type": task_type},
        timeout=60.0,
    )
    r.raise_for_status()
    return r.json()["embeddings"]


def _embed_batch(texts: list[str], task_type: str = "search_document") -> list[list[float]]:
    if settings.nomic_api_key:
        return _embed_nomic(texts, task_type)
    # Ollama fallback for local dev (no task_type concept — same model, different endpoint)
    results = []
    for t in texts:
        r = httpx.post(_OLLAMA_EMBED_URL, json={"model": _OLLAMA_MODEL, "prompt": t}, timeout=30.0)
        r.raise_for_status()
        results.append(r.json()["embedding"])
    return results


def _embed(text: str, task_type: str = "search_query") -> list[float]:
    return _embed_batch([text], task_type)[0]


class RAGService:
    def __init__(self) -> None:
        self._chroma = chromadb.PersistentClient(path=settings.chroma_persist_path)
        self._collection = self._chroma.get_or_create_collection(
            COLLECTION_NAME,
            metadata={"hnsw:space": "cosine"},
        )

    def index(self) -> int:
        with open(settings.full_context_path, "r") as f:
            text = f.read()
        chunks = _chunk_sections(text)

        existing = self._collection.get()["ids"]
        if existing:
            self._collection.delete(ids=existing)

        embeddings = _embed_batch(chunks, task_type="search_document")
        ids = [f"chunk_{i}" for i in range(len(chunks))]
        self._collection.add(ids=ids, embeddings=embeddings, documents=chunks)
        return len(chunks)

    def query(self, query: str, k: int | None = None) -> list[str]:
        k = k or settings.rag_top_k
        query_embedding = _embed(query, task_type="search_query")
        results = self._collection.query(
            query_embeddings=[query_embedding],
            n_results=k,
        )
        return results["documents"][0]

    @property
    def count(self) -> int:
        return self._collection.count()


def _cli() -> None:
    if len(sys.argv) < 2 or sys.argv[1] != "index":
        print("Usage: python -m app.services.rag index", file=sys.stderr)
        sys.exit(2)
    svc = RAGService()
    n = svc.index()
    print(f"Indexed {n} chunks into '{COLLECTION_NAME}'")


if __name__ == "__main__":
    _cli()
