import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.db.database import init_db
from app.api import evaluation, sessions, transcription, questions

logger = logging.getLogger("uvicorn.error")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    from app.services.rag import RAGService
    rag = RAGService()
    if rag.count == 0:
        logger.warning("RAG collection is empty — run: python -m app.services.rag index")
    else:
        logger.info("RAG ready: %d chunks indexed", rag.count)
    yield


app = FastAPI(title="Prepwise", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(evaluation.router)
app.include_router(sessions.router)
app.include_router(transcription.router)
app.include_router(questions.router)
