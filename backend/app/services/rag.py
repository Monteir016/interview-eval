import re
import sys
import httpx
import chromadb
from app.config import settings

COLLECTION_NAME = "full_context"
MAX_CHUNK_WORDS = 600
WORD_WINDOW_OVERLAP = 100
OLLAMA_EMBED_URL = "http://localhost:11434/api/embeddings"
EMBED_MODEL = "nomic-embed-text"


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


def _embed(text: str) -> list[float]:
    r = httpx.post(OLLAMA_EMBED_URL, json={"model": EMBED_MODEL, "prompt": text}, timeout=30.0)
    r.raise_for_status()
    return r.json()["embedding"]


def _embed_batch(texts: list[str]) -> list[list[float]]:
    return [_embed(t) for t in texts]


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

        embeddings = _embed_batch(chunks)
        ids = [f"chunk_{i}" for i in range(len(chunks))]
        self._collection.add(ids=ids, embeddings=embeddings, documents=chunks)
        return len(chunks)

    def query(self, query: str, k: int | None = None) -> list[str]:
        k = k or settings.rag_top_k
        query_embedding = _embed(query)
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
