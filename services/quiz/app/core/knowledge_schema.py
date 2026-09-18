"""Manual vectorization status, migrated inside the database transaction."""


def migrate(connection, statements):
    # Rebuild only the document table to extend its status constraint.
    statement = next(s for s in statements if s.startswith('CREATE TABLE kb_documents'))
    connection.execute(statement.replace('kb_documents', 'kb_documents_v8', 1)
                       .replace("DEFAULT 'processing'", "DEFAULT 'uploaded'")
                       .replace("('processing','ready','failed')", "('uploaded','processing','ready','failed')"))
    connection.execute('INSERT INTO kb_documents_v8 SELECT * FROM kb_documents')
    connection.execute('DROP TABLE kb_documents')
    connection.execute('ALTER TABLE kb_documents_v8 RENAME TO kb_documents')
    connection.execute('CREATE INDEX idx_kb_documents_user ON kb_documents(user_id)')
    connection.execute('CREATE TRIGGER kb_documents_updated AFTER UPDATE ON kb_documents '
                       'BEGIN UPDATE kb_documents SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END')
