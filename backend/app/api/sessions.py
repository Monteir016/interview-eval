import json
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.db.database import get_db

router = APIRouter(prefix="/sessions", tags=["sessions"])


class SessionCreate(BaseModel):
    question_set: str | None = None


class AnswerCreate(BaseModel):
    session_id: int
    question: str
    transcript_raw: str
    transcript_clean: str
    evaluation_json: str


@router.post("")
async def create_session(body: SessionCreate) -> dict:
    async with await get_db() as db:
        cursor = await db.execute(
            "INSERT INTO sessions (question_set) VALUES (?)", (body.question_set,)
        )
        await db.commit()
        return {"session_id": cursor.lastrowid}


@router.post("/answers")
async def save_answer(body: AnswerCreate) -> dict:
    data = json.loads(body.evaluation_json)
    async with await get_db() as db:
        cursor = await db.execute(
            """INSERT INTO answers
               (session_id, question, transcript_raw, transcript_clean,
                specificity, evidence, relevance, structure, overall_score, evaluation_json)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (
                body.session_id, body.question, body.transcript_raw,
                body.transcript_clean, data["specificity"]["score"],
                data["evidence"]["score"], data["relevance"]["score"],
                data["structure"]["score"], data["overall_score"],
                body.evaluation_json,
            ),
        )
        await db.commit()
        return {"answer_id": cursor.lastrowid}


@router.get("")
async def list_sessions() -> list[dict]:
    async with await get_db() as db:
        db.row_factory = lambda c, r: dict(zip([col[0] for col in c.description], r))
        cursor = await db.execute("SELECT * FROM sessions ORDER BY created_at DESC")
        return await cursor.fetchall()


@router.get("/{session_id}/answers")
async def get_answers(session_id: int) -> list[dict]:
    async with await get_db() as db:
        db.row_factory = lambda c, r: dict(zip([col[0] for col in c.description], r))
        cursor = await db.execute(
            "SELECT * FROM answers WHERE session_id = ? ORDER BY created_at", (session_id,)
        )
        rows = await cursor.fetchall()
        if not rows:
            raise HTTPException(status_code=404, detail="Session not found")
        return rows
