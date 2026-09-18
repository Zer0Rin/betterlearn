"""v7: immutable paper contents and durable timed sessions; no legacy rewrites."""


def migrate(connection):
    connection.execute('''CREATE TABLE exam_papers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        paper_id TEXT NOT NULL UNIQUE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        request_id TEXT NOT NULL,
        request_json TEXT NOT NULL,
        title TEXT NOT NULL,
        duration_seconds INTEGER NOT NULL,
        allocations_json TEXT NOT NULL,
        items_json TEXT NOT NULL,
        reviews_json TEXT NOT NULL DEFAULT '[]',
        revision INTEGER NOT NULL DEFAULT 0,
        approved INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        UNIQUE(user_id,request_id))''')
    connection.execute('''CREATE TABLE exam_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL UNIQUE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        paper_id TEXT NOT NULL REFERENCES exam_papers(paper_id),
        request_id TEXT NOT NULL,
        paper_revision INTEGER NOT NULL,
        started_at TEXT NOT NULL,
        deadline_at TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0,
        answers_json TEXT NOT NULL DEFAULT '[]',
        submission_json TEXT,
        result_json TEXT,
        UNIQUE(user_id,request_id))''')
    connection.execute('CREATE INDEX exam_papers_user ON exam_papers(user_id,id)')
    connection.execute('CREATE INDEX exam_sessions_user ON exam_sessions(user_id,id)')
    connection.execute('CREATE INDEX exam_sessions_paper ON exam_sessions(paper_id)')
