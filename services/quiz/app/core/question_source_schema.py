"""v4 explicit Core source associations. Never infer sources for old answers."""


def migrate(connection):
    connection.execute("""CREATE TABLE question_bank_sources (
        entry_id INTEGER PRIMARY KEY REFERENCES question_bank_entries(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL CHECK(revision>=1),
        source_json TEXT
    )""")
    connection.execute('ALTER TABLE question_bank_attempts ADD COLUMN source_json TEXT')
    connection.execute('ALTER TABLE question_bank_attempts ADD COLUMN source_revision INTEGER')
