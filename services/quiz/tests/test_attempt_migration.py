"""Upgrade only temporary databases; preserve a restorable v1 SQLite backup."""
import json
import sqlite3

import pytest
from app.core import db
from app.core.config import get_settings


@pytest.mark.asyncio
async def test_v1_backup_and_history_import(tmp_path, monkeypatch, sample_report_request):
    path = tmp_path / 'quiz.sqlite'
    monkeypatch.setenv('QUIZ_DB_PATH', str(path))
    get_settings.cache_clear()
    await db.close_db()
    body = sample_report_request
    with sqlite3.connect(path) as conn:
        for statement in db.SCHEMA_STATEMENTS:
            conn.execute(statement)
        conn.execute('PRAGMA user_version=1')
        conn.execute("INSERT INTO users(id,openid,total_xp) VALUES (1,'old',18)")
        conn.execute('INSERT INTO quiz_sessions(quiz_id,user_id,title,questions_json) VALUES (?,?,?,?)',
                     (body['quiz_id'], 1, body['topic'], json.dumps(body['questions'])))
        conn.execute('INSERT INTO answer_records(quiz_id,user_id,records_json,total_questions,correct_count,accuracy,created_at) VALUES (?,?,?,5,4,80,?)',
                     (body['quiz_id'], 1, json.dumps(body['answer_records']), '2026-01-01 12:00:00'))
        conn.execute('INSERT INTO reports(quiz_id,user_id,report_json) VALUES (?,1,?)',
                     (body['quiz_id'], json.dumps({'accuracy': 80})))
    try:
        await db.init_db()
        with sqlite3.connect(path) as conn:
            assert conn.execute('PRAGMA user_version').fetchone()[0] == 8
            assert conn.execute('SELECT accuracy, submitted_at FROM quiz_attempts').fetchone() == (80, '2026-01-01 12:00:00')
            assert conn.execute('SELECT total_xp FROM users').fetchone()[0] == 18
            assert conn.execute('SELECT status FROM quiz_attempt_reports').fetchone()[0] == 'completed'
            assert conn.execute('SELECT COUNT(*) FROM question_bank_sources').fetchone()[0] == 0
            assert conn.execute('SELECT COUNT(*) FROM question_bank_attempts').fetchone()[0] == 0
        backups = list(tmp_path.glob('quiz.sqlite.pre-v8-*.bak'))
        assert len(backups) == 1
        with sqlite3.connect(backups[0]) as conn:
            assert conn.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
            assert conn.execute('PRAGMA user_version').fetchone()[0] == 1
            assert conn.execute('SELECT COUNT(*) FROM answer_records').fetchone()[0] == 1
        await db.close_db()
        await db.init_db()
        with sqlite3.connect(path) as conn:
            assert conn.execute('SELECT COUNT(*) FROM quiz_attempts').fetchone()[0] == 1
        assert len(list(tmp_path.glob('*.bak'))) == 1
    finally:
        await db.close_db()
        get_settings.cache_clear()


@pytest.mark.asyncio
@pytest.mark.parametrize('failure', ['backup', 'migration'])
async def test_upgrade_failure_retains_v1(tmp_path, monkeypatch, failure):
    path = tmp_path / 'quiz.sqlite'
    monkeypatch.setenv('QUIZ_DB_PATH', str(path))
    get_settings.cache_clear()
    await db.close_db()
    with sqlite3.connect(path) as conn:
        for statement in db.SCHEMA_STATEMENTS:
            conn.execute(statement)
        conn.execute('PRAGMA user_version=1')
        conn.execute("INSERT INTO users(openid,total_xp) VALUES ('preserve',42)")
    def fail_backup(*args):
        raise OSError('backup unavailable')
    def fail_migration(connection):
        connection.execute('CREATE TABLE must_rollback (value TEXT)')
        connection.execute('UPDATE users SET total_xp=0')
        raise RuntimeError('migration failed')
    monkeypatch.setattr(db, 'backup_database' if failure == 'backup' else 'migrate',
                        fail_backup if failure == 'backup' else fail_migration)
    try:
        with pytest.raises((OSError, RuntimeError)):
            await db.init_db()
        with sqlite3.connect(path) as conn:
            assert conn.execute('PRAGMA user_version').fetchone()[0] == 1
            assert conn.execute('SELECT total_xp FROM users').fetchone()[0] == 42
            assert not conn.execute("SELECT 1 FROM sqlite_master WHERE name IN ('quiz_attempts','must_rollback')").fetchone()
        assert len(list(tmp_path.glob('*.bak'))) == (1 if failure == 'migration' else 0)
    finally:
        await db.close_db()
        get_settings.cache_clear()


@pytest.mark.asyncio
async def test_backup_contains_committed_wal_and_is_restorable(tmp_path, monkeypatch):
    path = tmp_path / 'quiz.sqlite'
    monkeypatch.setenv('QUIZ_DB_PATH', str(path))
    get_settings.cache_clear()
    await db.close_db()
    # Keep this connection open so committed changes remain in the WAL.
    source = sqlite3.connect(path)
    try:
        source.execute('PRAGMA journal_mode=WAL')
        source.execute('PRAGMA wal_autocheckpoint=0')
        for statement in db.SCHEMA_STATEMENTS:
            source.execute(statement)
        source.execute('PRAGMA user_version=1')
        source.execute("INSERT INTO users(openid,total_xp) VALUES ('wal-user',31)")
        source.commit()
        assert path.with_name('quiz.sqlite-wal').stat().st_size > 0
        await db.init_db()
        backup_path = next(tmp_path.glob('*.bak'))
        restored_path = tmp_path / 'restored.sqlite'
        restored_path.write_bytes(backup_path.read_bytes())
        with sqlite3.connect(restored_path) as restored:
            assert restored.execute('PRAGMA user_version').fetchone()[0] == 1
            assert restored.execute('SELECT total_xp FROM users').fetchone()[0] == 31
            assert restored.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    finally:
        source.close()
        await db.close_db()
        get_settings.cache_clear()


@pytest.mark.asyncio
async def test_legacy_duplicate_unknown_answers_preserved_verbatim(tmp_path, monkeypatch, sample_report_request):
    from copy import deepcopy
    from app.repositories import quiz_repository as quizzes, attempt_repository as attempts
    path = tmp_path / 'quiz.sqlite'
    monkeypatch.setenv('QUIZ_DB_PATH', str(path))
    get_settings.cache_clear()
    await db.close_db()
    body = sample_report_request
    old_records = deepcopy(body['answer_records'])
    old_records.append(deepcopy(old_records[0]))
    old_records[2]['question_id'] = 'old-unknown-id'
    with sqlite3.connect(path) as conn:
        for statement in db.SCHEMA_STATEMENTS:
            conn.execute(statement)
        conn.execute('PRAGMA user_version=1')
        conn.execute("INSERT INTO users(id,openid,total_xp) VALUES (1,'historical',20)")
        conn.execute('INSERT INTO quiz_sessions(quiz_id,user_id,title,questions_json) VALUES (?,?,?,?)',
                     (body['quiz_id'], 1, body['topic'], json.dumps(body['questions'])))
        conn.execute('INSERT INTO answer_records(quiz_id,user_id,records_json,total_questions,correct_count,accuracy) VALUES (?,?,?,6,5,83)',
                     (body['quiz_id'], 1, json.dumps(old_records)))
    try:
        await db.init_db()
        detail = await quizzes.get_quiz_detail(body['quiz_id'], 1)
        assert detail['answer_records'] == old_records
        attempt = await attempts.get_attempt(detail['attempt_id'], 1)
        assert attempt['answer_records'] == old_records
        assert attempt['accuracy'] == 83
    finally:
        await db.close_db()
        get_settings.cache_clear()
