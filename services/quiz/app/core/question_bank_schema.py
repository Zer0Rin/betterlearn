"""v3 question inventory and user organization, with trusted v2 history backfill."""
import json
from app.services.question_bank_projection import index_questions, record_attempt

STATEMENTS = [
    """CREATE TABLE question_bank_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        quiz_id TEXT NOT NULL REFERENCES quiz_sessions(quiz_id) ON DELETE CASCADE,
        question_id TEXT NOT NULL, question_hash TEXT NOT NULL, question_json TEXT NOT NULL,
        title TEXT NOT NULL, stem TEXT NOT NULL, explanation TEXT NOT NULL, knowledge_point TEXT NOT NULL,
        bookmarked INTEGER NOT NULL DEFAULT 0 CHECK(bookmarked IN (0,1)),
        is_correct INTEGER CHECK(is_correct IN (0,1)),
        latest_attempt_id TEXT REFERENCES quiz_attempts(attempt_id),
        attempt_count INTEGER NOT NULL DEFAULT 0, wrong_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')), last_answered_at TEXT,
        UNIQUE(user_id,quiz_id,question_id,question_hash))""",
    """CREATE TABLE question_bank_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_id INTEGER NOT NULL REFERENCES question_bank_entries(id) ON DELETE CASCADE,
        attempt_id TEXT NOT NULL REFERENCES quiz_attempts(attempt_id) ON DELETE CASCADE,
        UNIQUE(entry_id,attempt_id))""",
    """CREATE TABLE question_bank_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL, name_key TEXT NOT NULL,
        UNIQUE(user_id,name_key))""",
    """CREATE TABLE question_bank_entry_categories (
        entry_id INTEGER NOT NULL REFERENCES question_bank_entries(id) ON DELETE CASCADE,
        category_id INTEGER NOT NULL REFERENCES question_bank_categories(id) ON DELETE CASCADE,
        PRIMARY KEY(entry_id,category_id))""",
    'CREATE INDEX idx_bank_user_wrong ON question_bank_entries(user_id,is_correct,id)',
    'CREATE INDEX idx_bank_category_entries ON question_bank_entry_categories(category_id,entry_id)',
]


def migrate(connection):
    for statement in STATEMENTS:
        connection.execute(statement)
    cur = connection.cursor()
    try:
        for row in connection.execute('SELECT * FROM quiz_sessions WHERE user_id IS NOT NULL'):
            try:
                questions = json.loads(row['questions_json'])
            except (ValueError, TypeError):
                continue
            index_questions(cur, row['quiz_id'], row['user_id'], row['title'], questions)
        for row in connection.execute('''SELECT a.* FROM quiz_attempts a JOIN quiz_sessions q ON q.quiz_id=a.quiz_id
            WHERE a.user_id=q.user_id AND a.status='submitted' AND a.legacy_records_json IS NULL
            ORDER BY a.submitted_at, a.id'''):
            record_attempt(cur, row, freeze_source=False)
    finally:
        cur.close()
