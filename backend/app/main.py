import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db.database import init_db
from app.api import evaluation, sessions, transcription, questions

logger = logging.getLogger("uvicorn.error")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    from app.services.rag import RAGService
    rag = RAGService()
    if rag.count == 0:
        if Path(settings.full_context_path).exists():
            n = rag.index()
            logger.info("RAG auto-indexed: %d chunks", n)
        else:
            logger.warning("RAG empty — upload FULL_CONTEXT.md to %s", settings.full_context_path)
    else:
        logger.info("RAG ready: %d chunks indexed", rag.count)
    yield


app = FastAPI(title="Prepwise", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins.split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(evaluation.router)
app.include_router(sessions.router)
app.include_router(transcription.router)
app.include_router(questions.router)
