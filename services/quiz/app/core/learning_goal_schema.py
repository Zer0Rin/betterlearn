"""v6: owned immutable goal conditions plus independent archive revision."""


def migrate(connection):
    connection.execute('''CREATE TABLE learning_goals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        goal_id TEXT NOT NULL UNIQUE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        request_id TEXT NOT NULL,
        request_digest TEXT NOT NULL,
        create_request_json TEXT NOT NULL,
        title TEXT NOT NULL,
        source_json TEXT NOT NULL,
        knowledge_point_id TEXT NOT NULL,
        content_version TEXT NOT NULL,
        target_percent INTEGER NOT NULL CHECK(target_percent BETWEEN 1 AND 100),
        min_distinct_questions INTEGER NOT NULL CHECK(min_distinct_questions BETWEEN 3 AND 100),
        due_at TEXT NOT NULL,
        policy_version TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
        revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
        created_at TEXT NOT NULL,
        UNIQUE(user_id,request_id)
    )''')
    connection.execute('CREATE INDEX learning_goals_user_id ON learning_goals(user_id,id)')
