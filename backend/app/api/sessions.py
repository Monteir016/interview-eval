import json

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException
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
async def create_session(body: SessionCreate, db: aiosqlite.Connection = Depends(get_db)) -> dict:
    cursor = await db.execute(
        "INSERT INTO sessions (question_set) VALUES (?)", (body.question_set,)
    )
    await db.commit()
    return {"session_id": cursor.lastrowid}


@router.post("/answers")
async def save_answer(body: AnswerCreate, db: aiosqlite.Connection = Depends(get_db)) -> dict:
    data = json.loads(body.evaluation_json)
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
async def list_sessions(db: aiosqlite.Connection = Depends(get_db)) -> list[dict]:
    cursor = await db.execute(
        """SELECT s.id, s.created_at, s.question_set,
                  ROUND(AVG(a.overall_score), 2) AS avg_overall,
                  COUNT(a.id) AS answer_count
           FROM sessions s
           LEFT JOIN answers a ON a.session_id = s.id
           GROUP BY s.id
           ORDER BY s.created_at DESC"""
    )
    return await cursor.fetchall()


@router.delete("/{session_id}")
async def delete_session(session_id: int, db: aiosqlite.Connection = Depends(get_db)) -> dict:
    await db.execute("DELETE FROM answers WHERE session_id = ?", (session_id,))
    await db.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
    await db.commit()
    return {"deleted": session_id}


@router.get("/{session_id}/answers")
async def get_answers(session_id: int, db: aiosqlite.Connection = Depends(get_db)) -> list[dict]:
    cursor = await db.execute(
        "SELECT * FROM answers WHERE session_id = ? ORDER BY created_at", (session_id,)
    )
    rows = await cursor.fetchall()
    if not rows:
        raise HTTPException(status_code=404, detail="Session not found")
    return rows
