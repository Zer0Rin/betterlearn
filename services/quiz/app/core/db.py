"""Local SQLite persistence with explicit, serialized transactions.

Repository operations are short synchronous statements without await points. A
process lock protects the shared connection (including TestClient threads); SQLite
also serializes writers across connections. Provider work never runs in a transaction.
"""
from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
import sqlite3
import threading

from app.core.config import get_settings

_connection: sqlite3.Connection | None = None
_lock = threading.RLock()
SCHEMA_VERSION = 1

SCHEMA_STATEMENTS = [
    """CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, openid TEXT NOT NULL UNIQUE,
        nickname TEXT NOT NULL DEFAULT '学习者', avatar_url TEXT NOT NULL DEFAULT '',
        total_xp INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)""",
    """CREATE TABLE quiz_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, quiz_id TEXT NOT NULL UNIQUE,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        title TEXT NOT NULL, summary TEXT, user_input TEXT, questions_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)""",
    """CREATE TABLE answer_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        quiz_id TEXT NOT NULL UNIQUE REFERENCES quiz_sessions(quiz_id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        records_json TEXT NOT NULL, total_questions INTEGER NOT NULL,
        correct_count INTEGER NOT NULL, accuracy REAL NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)""",
    """CREATE TABLE reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        quiz_id TEXT NOT NULL UNIQUE REFERENCES quiz_sessions(quiz_id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, report_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)""",
    """CREATE TABLE quiz_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL UNIQUE,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed')),
        user_input TEXT NOT NULL, question_count INTEGER NOT NULL DEFAULT 5,
        difficulty TEXT NOT NULL DEFAULT 'mixed', result_json TEXT, error_message TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)""",
    """CREATE TABLE kb_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id TEXT NOT NULL UNIQUE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL, file_type TEXT NOT NULL, file_size INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'processing' CHECK(status IN ('processing','ready','failed')),
        chunk_count INTEGER NOT NULL DEFAULT 0, error_message TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)""",
    """CREATE TABLE image_generation_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        quiz_id TEXT, question_id TEXT, image_url TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)""",
    *[f'CREATE INDEX idx_{table}_user ON {table}(user_id)' for table in
      ('quiz_sessions', 'answer_records', 'reports', 'quiz_tasks', 'kb_documents')],
    'CREATE INDEX idx_image_generation_user_created ON image_generation_logs(user_id, created_at)',
    *[f'''CREATE TRIGGER {table}_updated AFTER UPDATE ON {table}
         BEGIN UPDATE {table} SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END'''
      for table in ('users', 'quiz_tasks', 'kb_documents')],
]


async def init_db() -> None:
    global _connection
    with _lock:
        if _connection is not None:
            return
        path = Path(get_settings().quiz_db_path).expanduser().resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(path, isolation_level=None, check_same_thread=False, timeout=5)
        connection.row_factory = sqlite3.Row
        try:
            connection.execute('PRAGMA foreign_keys = ON')
            connection.execute('PRAGMA journal_mode = WAL')
            connection.execute('PRAGMA synchronous = FULL')
            connection.execute('BEGIN IMMEDIATE')
            version = connection.execute('PRAGMA user_version').fetchone()[0]
            if version > SCHEMA_VERSION:
                raise RuntimeError(f'Unsupported quiz database schema version: {version}')
            if version == 0:
                for statement in SCHEMA_STATEMENTS:
                    connection.execute(statement)
                connection.execute(f'PRAGMA user_version = {SCHEMA_VERSION}')
            reason = '服务重启中断了处理，请重试'
            connection.execute("UPDATE kb_documents SET status='failed', error_message=? WHERE status='processing'", (reason,))
            connection.execute("UPDATE quiz_tasks SET status='failed', error_message=? WHERE status IN ('pending','running')", (reason,))
            connection.commit()
        except BaseException:
            connection.rollback()
            connection.close()
            raise
        _connection = connection


@contextmanager
def transaction():
    """Yield a cursor; commit all statements together or roll everything back."""
    with _lock:
        if _connection is None:
            raise RuntimeError('数据库未初始化')
        cursor = _connection.cursor()
        try:
            cursor.execute('BEGIN IMMEDIATE')
            yield cursor
            _connection.commit()
        except BaseException:
            _connection.rollback()
            raise
        finally:
            cursor.close()


async def close_db() -> None:
    global _connection
    with _lock:
        if _connection is not None:
            _connection.close()
            _connection = None


def format_timestamp(value) -> str:
    if value is None:
        return ''
    return value.strftime('%Y-%m-%d %H:%M:%S') if hasattr(value, 'strftime') else str(value)
