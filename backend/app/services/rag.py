import chromadb
import google.generativeai as genai
from app.config import settings

COLLECTION_NAME = "full_context"
CHUNK_SIZE = 400
CHUNK_OVERLAP = 80


def _chunk_text(text: str) -> list[str]:
    words = text.split()
    chunks = []
    start = 0
    while start < len(words):
        end = start + CHUNK_SIZE
        chunks.append(" ".join(words[start:end]))
        start += CHUNK_SIZE - CHUNK_OVERLAP
    return chunks


def _embed(texts: list[str]) -> list[list[float]]:
    result = genai.embed_content(
        model="models/text-embedding-004",
        content=texts,
        task_type="retrieval_document",
    )
    return result["embedding"]


class RAGService:
    def __init__(self) -> None:
        self._client = chromadb.PersistentClient(path=settings.chroma_persist_path)
        self._collection = self._client.get_or_create_collection(COLLECTION_NAME)

    def index(self) -> int:
        with open(settings.full_context_path, "r") as f:
            text = f.read()
        chunks = _chunk_text(text)
        embeddings = _embed(chunks)
        ids = [f"chunk_{i}" for i in range(len(chunks))]
        self._collection.upsert(ids=ids, embeddings=embeddings, documents=chunks)
        return len(chunks)

    def query(self, query: str, k: int | None = None) -> list[str]:
        k = k or settings.rag_top_k
        result = genai.embed_content(
            model="models/text-embedding-004",
            content=query,
            task_type="retrieval_query",
        )
        query_embedding = result["embedding"]
        results = self._collection.query(
            query_embeddings=[query_embedding],
            n_results=k,
        )
        return results["documents"][0]

    @property
    def count(self) -> int:
        return self._collection.count()
