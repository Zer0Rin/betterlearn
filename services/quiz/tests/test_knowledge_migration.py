import sqlite3
import pytest
from app.core import db
from app.core.config import get_settings


@pytest.mark.asyncio
@pytest.mark.parametrize('failure', [False, True])
async def test_v7_upgrade_preserves_documents_and_backup(database, tmp_path, monkeypatch, failure):
    await db.close_db()
    path = tmp_path / 'v7.sqlite'
    monkeypatch.setenv('QUIZ_DB_PATH', str(path))
    get_settings.cache_clear()
    with sqlite3.connect(path) as conn:
        conn.row_factory = sqlite3.Row
        for statement in db.SCHEMA_STATEMENTS:
            conn.execute(statement)
        for migration in (db.migrate, db.migrate_bank, db.migrate_sources, db.migrate_source_generation, db.migrate_goals, db.migrate_exams):
            migration(conn)
        conn.execute("INSERT INTO users(id,openid) VALUES(1,'keep')")
        conn.execute("INSERT INTO kb_documents(doc_id,user_id,file_name,file_type,file_size,status,chunk_count) VALUES('doc_keep',1,'keep.md','md',123,'ready',26)")
        conn.execute('PRAGMA user_version=7')
    if failure:
        original = db.migrate_knowledge
        def fail(conn, statements):
            original(conn, statements)
            raise RuntimeError('migration failed')
        monkeypatch.setattr(db, 'migrate_knowledge', fail)
        with pytest.raises(RuntimeError, match='migration failed'):
            await db.init_db()
    else:
        await db.init_db()
    with sqlite3.connect(path) as conn:
        assert conn.execute('PRAGMA user_version').fetchone()[0] == (7 if failure else 8)
        assert conn.execute('SELECT doc_id,status,chunk_count FROM kb_documents').fetchone() == ('doc_keep','ready',26)
        assert conn.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        if not failure:
            conn.execute("INSERT INTO kb_documents(doc_id,user_id,file_name,file_type,file_size) VALUES('doc_new',1,'new.txt','txt',3)")
            assert conn.execute("SELECT status FROM kb_documents WHERE doc_id='doc_new'").fetchone()[0] == 'uploaded'
    backup, = tmp_path.glob('v7.sqlite.pre-v8-*.bak')
    with sqlite3.connect(backup) as conn:
        assert conn.execute('PRAGMA user_version').fetchone()[0] == 7
        assert conn.execute('SELECT chunk_count FROM kb_documents').fetchone()[0] == 26
