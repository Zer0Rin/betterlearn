"""Additive v2 migration. Legacy facts are imported, never regraded or rewarded."""

STATEMENTS = [
    """CREATE TABLE quiz_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        attempt_id TEXT NOT NULL UNIQUE,
        quiz_id TEXT NOT NULL REFERENCES quiz_sessions(quiz_id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        request_id TEXT, title TEXT NOT NULL, questions_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('draft','submitted')),
        revision INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')),
        submitted_at TEXT, total_questions INTEGER, correct_count INTEGER, accuracy REAL,
        xp_gain INTEGER NOT NULL DEFAULT 0, submission_hash TEXT, legacy_records_json TEXT,
        legacy_source INTEGER NOT NULL DEFAULT 0 CHECK(legacy_source IN (0,1)),
        UNIQUE(user_id, request_id))""",
    'CREATE UNIQUE INDEX idx_attempt_legacy ON quiz_attempts(quiz_id) WHERE legacy_source = 1',
    'CREATE INDEX idx_attempt_user_quiz ON quiz_attempts(user_id, quiz_id, id)',
    """CREATE TABLE quiz_attempt_answers (
        attempt_id TEXT NOT NULL REFERENCES quiz_attempts(attempt_id) ON DELETE CASCADE,
        question_id TEXT NOT NULL, selected_answers_json TEXT NOT NULL,
        duration_ms INTEGER NOT NULL CHECK(duration_ms >= 0),
        is_correct INTEGER CHECK(is_correct IN (0,1)),
        PRIMARY KEY(attempt_id, question_id))""",
    """CREATE TABLE quiz_attempt_reports (
        attempt_id TEXT PRIMARY KEY REFERENCES quiz_attempts(attempt_id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK(status IN ('running','completed','failed')),
        generation_token TEXT NOT NULL, report_json TEXT, error_message TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)""",
]


def migrate(connection):
    for statement in STATEMENTS:
        connection.execute(statement)
    rows = connection.execute('''SELECT ar.*, qs.title, qs.questions_json FROM answer_records ar
        JOIN quiz_sessions qs ON qs.quiz_id = ar.quiz_id''').fetchall()
    for row in rows:
        attempt_id = f"legacy_{row['id']}"
        connection.execute('''INSERT INTO quiz_attempts
            (attempt_id, quiz_id, user_id, title, questions_json, status, revision,
             created_at, submitted_at, total_questions, correct_count, accuracy, legacy_source, legacy_records_json)
            VALUES (?,?,?,?,?,'submitted',1,?,?,?,?,?,1,?)''',
            (attempt_id, row['quiz_id'], row['user_id'], row['title'], row['questions_json'],
             row['created_at'], row['created_at'], row['total_questions'], row['correct_count'], row['accuracy'], row['records_json']))
        # v1 accepted duplicate/unknown question IDs. Preserve its exact history
        # separately instead of imposing new answer constraints or silently deduplicating.
        connection.execute('''INSERT INTO quiz_attempt_reports(attempt_id,status,generation_token,report_json,updated_at)
            SELECT ?, 'completed', 'legacy', report_json, created_at FROM reports
            WHERE quiz_id = ? AND user_id IS ?''', (attempt_id, row['quiz_id'], row['user_id']))
