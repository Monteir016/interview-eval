import aiosqlite
from app.config import settings

CREATE_SESSIONS = """
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    question_set TEXT,
    name TEXT
)
"""

MIGRATE_SESSIONS_NAME = """
ALTER TABLE sessions ADD COLUMN name TEXT
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

CREATE_IDX_ANSWERS_SESSION = """
CREATE INDEX IF NOT EXISTS idx_answers_session_id ON answers(session_id)
"""


async def get_db():
    async with aiosqlite.connect(settings.sqlite_path) as db:
        db.row_factory = lambda c, r: dict(zip([col[0] for col in c.description], r))
        yield db


async def init_db() -> None:
    async with aiosqlite.connect(settings.sqlite_path) as db:
        await db.execute(CREATE_SESSIONS)
        await db.execute(CREATE_ANSWERS)
        await db.execute(CREATE_IDX_ANSWERS_SESSION)
        # idempotent migration for existing DBs
        try:
            await db.execute(MIGRATE_SESSIONS_NAME)
        except Exception:
            pass
        await db.commit()
