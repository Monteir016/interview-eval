import httpx
import chromadb
from app.config import settings

COLLECTION_NAME = "full_context"
CHUNK_SIZE = 400
CHUNK_OVERLAP = 80
OLLAMA_EMBED_URL = "http://localhost:11434/api/embeddings"
EMBED_MODEL = "nomic-embed-text"


def _chunk_text(text: str) -> list[str]:
    words = text.split()
    chunks = []
    start = 0
    while start < len(words):
        end = start + CHUNK_SIZE
        chunks.append(" ".join(words[start:end]))
        start += CHUNK_SIZE - CHUNK_OVERLAP
    return chunks


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
        chunks = _chunk_text(text)
        embeddings = _embed_batch(chunks)
        ids = [f"chunk_{i}" for i in range(len(chunks))]
        self._collection.upsert(ids=ids, embeddings=embeddings, documents=chunks)
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
