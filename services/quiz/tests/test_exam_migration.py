"""All migration checks operate on new temporary files, including v7 rollback."""
import sqlite3
import pytest
from app.core import db
from app.core.config import get_settings


@pytest.mark.asyncio
@pytest.mark.parametrize('version', [1, 2, 3, 4, 5, 6])
@pytest.mark.parametrize('failure', [False, True])
async def test_exam_upgrade_backup_and_atomic_rollback(database, tmp_path, monkeypatch, version, failure):
    await db.close_db()
    path = tmp_path / 'old.sqlite'
    monkeypatch.setenv('QUIZ_DB_PATH', str(path))
    get_settings.cache_clear()
    with sqlite3.connect(path) as conn:
        conn.row_factory = sqlite3.Row
        for sql in db.SCHEMA_STATEMENTS:
            conn.execute(sql)
        for v, migration in [(2, db.migrate), (3, db.migrate_bank), (4, db.migrate_sources),
                             (5, db.migrate_source_generation), (6, db.migrate_goals)]:
            if version >= v:
                migration(conn)
        conn.execute(f'PRAGMA user_version={version}')
        conn.execute("INSERT INTO users(openid,total_xp) VALUES('keep',77)")
    if failure:
        original = db.migrate_exams
        def fail(conn):
            original(conn)
            conn.execute('UPDATE users SET total_xp=0')
            raise RuntimeError('exam migration failed')
        monkeypatch.setattr(db, 'migrate_exams', fail)
        with pytest.raises(RuntimeError, match='exam migration failed'):
            await db.init_db()
    else:
        await db.init_db()
    with sqlite3.connect(path) as conn:
        assert conn.execute('PRAGMA user_version').fetchone()[0] == (version if failure else 8)
        assert conn.execute('SELECT total_xp FROM users').fetchone()[0] == 77
        assert bool(conn.execute("SELECT 1 FROM sqlite_master WHERE name='exam_papers'").fetchone()) is not failure
        assert bool(conn.execute("SELECT 1 FROM sqlite_master WHERE name='exam_sessions'").fetchone()) is not failure
    backups = list(tmp_path.glob('old.sqlite.pre-v8-*.bak'))
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as conn:
        assert conn.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert conn.execute('PRAGMA user_version').fetchone()[0] == version
        assert conn.execute('SELECT total_xp FROM users').fetchone()[0] == 77
    if not failure:
        await db.close_db()
        await db.init_db()
        assert len(list(tmp_path.glob('old.sqlite.pre-v8-*.bak'))) == 1
