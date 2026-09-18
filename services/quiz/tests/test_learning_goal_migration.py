"""Upgrade/restoration checks exclusively on temporary databases."""
import sqlite3
import pytest
from app.core import db


@pytest.mark.asyncio
@pytest.mark.parametrize('failure', [False, True])
async def test_v5_goal_upgrade_backup_and_rollback(database, monkeypatch, failure):
    await db.close_db()
    with sqlite3.connect(database) as conn:
        conn.execute('DROP TABLE exam_sessions')
        conn.execute('DROP TABLE exam_papers')
        conn.execute('DROP TABLE IF EXISTS learning_goals')
        conn.execute('PRAGMA user_version=5')
        conn.execute("INSERT INTO users(openid,total_xp) VALUES('v5-user',77)")
    if failure:
        def fail(conn):
            conn.execute('CREATE TABLE goal_partial(x TEXT)')
            conn.execute('UPDATE users SET total_xp=0')
            raise RuntimeError('goal migration failed')
        monkeypatch.setattr(db, 'migrate_goals', fail, raising=False)
        with pytest.raises(RuntimeError, match='goal migration failed'):
            await db.init_db()
    else:
        await db.init_db()
    with sqlite3.connect(database) as conn:
        assert conn.execute('PRAGMA user_version').fetchone()[0] == (5 if failure else 7)
        assert conn.execute('SELECT total_xp FROM users').fetchone()[0] == 77
        assert not conn.execute("SELECT 1 FROM sqlite_master WHERE name='goal_partial'").fetchone()
        if not failure:
            assert conn.execute('SELECT COUNT(*) FROM learning_goals').fetchone()[0] == 0
    backups = list(database.parent.glob('*.pre-v7-*.bak'))
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as conn:
        assert conn.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert conn.execute('PRAGMA user_version').fetchone()[0] == 5
        assert conn.execute('SELECT total_xp FROM users').fetchone()[0] == 77
    if not failure:
        await db.close_db()
        await db.init_db()
        assert len(list(database.parent.glob('*.pre-v7-*.bak'))) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('version', [1, 2, 3, 4])
@pytest.mark.parametrize('failure', [False, True])
async def test_older_versions_upgrade_or_rollback_every_migration(database, tmp_path, monkeypatch, version, failure):
    from app.core.config import get_settings
    await db.close_db()
    path = tmp_path / 'historic.sqlite'
    monkeypatch.setenv('QUIZ_DB_PATH', str(path))
    get_settings.cache_clear()
    with sqlite3.connect(path) as conn:
        conn.row_factory = sqlite3.Row
        for sql in db.SCHEMA_STATEMENTS:
            conn.execute(sql)
        if version >= 2:
            db.migrate(conn)
        if version >= 3:
            db.migrate_bank(conn)
        if version >= 4:
            db.migrate_sources(conn)
        conn.execute(f'PRAGMA user_version={version}')
        conn.execute("INSERT INTO users(openid,total_xp) VALUES('preserved',42)")
    if failure:
        def fail(conn):
            conn.execute('CREATE TABLE goal_partial(x TEXT)')
            raise RuntimeError('goal migration failed')
        monkeypatch.setattr(db, 'migrate_goals', fail)
        with pytest.raises(RuntimeError, match='goal migration failed'):
            await db.init_db()
    else:
        await db.init_db()
    with sqlite3.connect(path) as conn:
        assert conn.execute('PRAGMA user_version').fetchone()[0] == (version if failure else 7)
        assert conn.execute('SELECT total_xp FROM users').fetchone()[0] == 42
        assert not conn.execute("SELECT 1 FROM sqlite_master WHERE name='goal_partial'").fetchone()
        assert bool(conn.execute("SELECT 1 FROM sqlite_master WHERE name='learning_goals'").fetchone()) is not failure
    backup = next(tmp_path.glob('historic.sqlite.pre-v7-*.bak'))
    with sqlite3.connect(backup) as conn:
        assert conn.execute('PRAGMA user_version').fetchone()[0] == version
        assert conn.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
