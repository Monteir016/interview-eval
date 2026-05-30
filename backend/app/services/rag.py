import chromadb
from google import genai
from google.genai import types
from app.config import settings

_client = genai.Client(api_key=settings.gemini_api_key)

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


def _embed_documents(texts: list[str]) -> list[list[float]]:
    result = _client.models.embed_content(
        model="text-embedding-004",
        contents=texts,
        config=types.EmbedContentConfig(task_type="RETRIEVAL_DOCUMENT"),
    )
    return [e.values for e in result.embeddings]


def _embed_query(query: str) -> list[float]:
    result = _client.models.embed_content(
        model="text-embedding-004",
        contents=query,
        config=types.EmbedContentConfig(task_type="RETRIEVAL_QUERY"),
    )
    return result.embeddings[0].values


class RAGService:
    def __init__(self) -> None:
        self._chroma = chromadb.PersistentClient(path=settings.chroma_persist_path)
        self._collection = self._chroma.get_or_create_collection(COLLECTION_NAME)

    def index(self) -> int:
        with open(settings.full_context_path, "r") as f:
            text = f.read()
        chunks = _chunk_text(text)
        embeddings = _embed_documents(chunks)
        ids = [f"chunk_{i}" for i in range(len(chunks))]
        self._collection.upsert(ids=ids, embeddings=embeddings, documents=chunks)
        return len(chunks)

    def query(self, query: str, k: int | None = None) -> list[str]:
        k = k or settings.rag_top_k
        query_embedding = _embed_query(query)
        results = self._collection.query(
            query_embeddings=[query_embedding],
            n_results=k,
        )
        return results["documents"][0]

    @property
    def count(self) -> int:
        return self._collection.count()
