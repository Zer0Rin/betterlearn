import sqlite3
import pytest
from app.core import db


@pytest.mark.asyncio
@pytest.mark.parametrize('failure', [False, True])
async def test_v4_generation_upgrade_backup_and_rollback(database, monkeypatch, failure):
    await db.close_db()
    with sqlite3.connect(database) as con:
        con.execute('DROP TABLE exam_sessions')
        con.execute('DROP TABLE exam_papers')
        con.execute('DROP TABLE learning_goals')
        con.execute('DROP TABLE quiz_source_tasks')
        con.execute('PRAGMA user_version=4')
        con.execute("INSERT INTO users(openid,total_xp) VALUES('v4-user',77)")
    if failure:
        def fail(con):
            con.execute('CREATE TABLE bad_partial(x TEXT)')
            raise RuntimeError('generation migration failed')
        monkeypatch.setattr(db, 'migrate_source_generation', fail)
        with pytest.raises(RuntimeError, match='migration failed'):
            await db.init_db()
    else:
        await db.init_db()
    with sqlite3.connect(database) as con:
        assert con.execute('PRAGMA user_version').fetchone()[0] == (4 if failure else 8)
        assert con.execute('SELECT total_xp FROM users').fetchone()[0] == 77
        assert not con.execute("SELECT 1 FROM sqlite_master WHERE name='bad_partial'").fetchone()
    backups = list(database.parent.glob('*.pre-v8-*.bak'))
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as con:
        assert con.execute('PRAGMA user_version').fetchone()[0] == 4
        assert con.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    if not failure:
        await db.close_db()
        await db.init_db()
        assert len(list(database.parent.glob('*.pre-v8-*.bak'))) == 1
