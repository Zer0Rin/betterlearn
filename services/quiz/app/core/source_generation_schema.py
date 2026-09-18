"""v5: persisted single-source generation requests, with owned deduplication."""


def migrate(connection):
    connection.execute("""CREATE TABLE quiz_source_tasks (
        task_id TEXT PRIMARY KEY REFERENCES quiz_tasks(task_id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        request_id TEXT NOT NULL,
        request_digest TEXT NOT NULL,
        request_json TEXT NOT NULL,
        UNIQUE(user_id,request_id)
    )""")
