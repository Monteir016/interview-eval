import aiosqlite
from app.config import settings

CREATE_SESSIONS = """
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    question_set TEXT
)
"""

CREATE_ANSWERS = """
CREATE TABLE IF NOT EXISTS answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id),
    question TEXT NOT NULL,
    transcript_raw TEXT,
    transcript_clean TEXT,
    specificity INTEGER,
    evidence INTEGER,
    relevance INTEGER,
    structure INTEGER,
    overall_score REAL,
    evaluation_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
)
"""


async def get_db() -> aiosqlite.Connection:
    return await aiosqlite.connect(settings.sqlite_path)


async def init_db() -> None:
    async with aiosqlite.connect(settings.sqlite_path) as db:
        await db.execute(CREATE_SESSIONS)
        await db.execute(CREATE_ANSWERS)
        await db.commit()
