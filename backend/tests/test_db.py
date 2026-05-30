import json
import os
import pytest
import pytest_asyncio
import aiosqlite

from app.db.database import init_db

TEST_DB = "/tmp/prepwise_test.db"

EVAL_JSON = json.dumps({
    "question": "Tell me about a project.",
    "transcript_clean": "I built X.",
    "specificity": {"score": 4, "feedback": "good"},
    "evidence": {"score": 3, "feedback": "ok"},
    "relevance": {"score": 5, "feedback": "great"},
    "structure": {"score": 4, "feedback": "solid"},
    "overall_score": 4.0,
    "key_strength": "concrete metrics",
    "key_improvement": "add more context",
})


@pytest.fixture(autouse=True)
def clean_db():
    yield
    if os.path.exists(TEST_DB):
        os.remove(TEST_DB)


@pytest.fixture(autouse=True)
def patch_db_path(monkeypatch):
    monkeypatch.setenv("SQLITE_PATH", TEST_DB)
    from app import config
    monkeypatch.setattr(config.settings, "sqlite_path", TEST_DB)


@pytest.mark.asyncio
async def test_init_db_creates_tables():
    await init_db()
    async with aiosqlite.connect(TEST_DB) as db:
        cursor = await db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
        tables = {row[0] for row in await cursor.fetchall()}
    assert "sessions" in tables
    assert "answers" in tables


@pytest.mark.asyncio
async def test_init_db_creates_index():
    await init_db()
    async with aiosqlite.connect(TEST_DB) as db:
        cursor = await db.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_answers_session_id'"
        )
        row = await cursor.fetchone()
    assert row is not None


@pytest.mark.asyncio
async def test_session_and_answers_round_trip():
    await init_db()
    async with aiosqlite.connect(TEST_DB) as db:
        # create session
        cur = await db.execute("INSERT INTO sessions (question_set) VALUES (?)", (None,))
        await db.commit()
        session_id = cur.lastrowid

        data = json.loads(EVAL_JSON)

        # insert two answers
        for i in range(2):
            await db.execute(
                """INSERT INTO answers
                   (session_id, question, transcript_raw, transcript_clean,
                    specificity, evidence, relevance, structure, overall_score, evaluation_json)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (
                    session_id, f"Q{i}", f"raw{i}", data["transcript_clean"],
                    data["specificity"]["score"], data["evidence"]["score"],
                    data["relevance"]["score"], data["structure"]["score"],
                    data["overall_score"], EVAL_JSON,
                ),
            )
        await db.commit()

        # assert row count
        cur = await db.execute("SELECT COUNT(*) FROM answers WHERE session_id = ?", (session_id,))
        count = (await cur.fetchone())[0]
        assert count == 2

        # assert JSON round-trip
        cur = await db.execute(
            "SELECT evaluation_json FROM answers WHERE session_id = ? ORDER BY id", (session_id,)
        )
        rows = await cur.fetchall()
        for row in rows:
            parsed = json.loads(row[0])
            assert parsed["overall_score"] == 4.0
            assert parsed["specificity"]["score"] == 4


@pytest.mark.asyncio
async def test_init_db_is_idempotent():
    await init_db()
    await init_db()  # second call must not raise or duplicate tables
    async with aiosqlite.connect(TEST_DB) as db:
        cur = await db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
        tables = {row[0] for row in await cur.fetchall()}
    assert tables == {"sessions", "answers"}
