"""v3 backups and failures only on isolated temporary database fixtures."""
import sqlite3
import pytest
from app.core import db


def downgrade_fixture(path):
    with sqlite3.connect(path) as conn:
        conn.execute('DROP TABLE exam_sessions')
        conn.execute('DROP TABLE exam_papers')
        conn.execute('DROP TABLE learning_goals')
        conn.execute('DROP TABLE quiz_source_tasks')
        conn.execute('DROP TABLE question_bank_sources')
        conn.execute('ALTER TABLE question_bank_attempts DROP COLUMN source_json')
        conn.execute('ALTER TABLE question_bank_attempts DROP COLUMN source_revision')
        conn.execute('PRAGMA user_version=3')


@pytest.mark.asyncio
async def test_v3_source_upgrade_backup_and_no_inference(api, database):
    from tests.test_question_bank import data
    from tests.test_quiz_attempts import create, submit
    client, uid, body = api
    attempt = await create(client, body)
    await submit(client, attempt, body)
    await db.close_db()
    downgrade_fixture(database)
    await db.init_db()
    entries = (await data(client))['items']
    assert all(e['source'] is None and e['source_revision'] == 0 for e in entries)
    old = await data(client, f"/entries/{entries[0]['id']}/history")
    assert old['items'][0]['source'] is None
    assert old['items'][0]['source_revision'] is None
    backups = list(database.parent.glob('*.pre-v8-*.bak'))
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as con:
        assert con.execute('PRAGMA user_version').fetchone()[0] == 3
        assert con.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert con.execute('SELECT total_xp FROM users WHERE id=?', (uid,)).fetchone()[0] == 18
        assert not con.execute("SELECT 1 FROM sqlite_master WHERE name='question_bank_sources'").fetchone()
    await db.close_db()
    await db.init_db()
    assert len(list(database.parent.glob('*.pre-v8-*.bak'))) == 1


@pytest.mark.asyncio
async def test_source_migration_failure_keeps_v3(database, monkeypatch):
    await db.close_db()
    downgrade_fixture(database)
    def fail(con):
        con.execute('CREATE TABLE source_partial(value TEXT)')
        raise RuntimeError('source migration failed')
    monkeypatch.setattr(db, 'migrate_sources', fail)
    with pytest.raises(RuntimeError, match='source migration failed'):
        await db.init_db()
    with sqlite3.connect(database) as con:
        assert con.execute('PRAGMA user_version').fetchone()[0] == 3
        assert not con.execute("SELECT 1 FROM sqlite_master WHERE name='source_partial'").fetchone()
    assert len(list(database.parent.glob('*.pre-v8-*.bak'))) == 1


from tests.test_quiz_attempts import api
