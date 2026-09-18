import json
import sqlite3
import pytest
from app.core import db, attempt_schema
from app.core.config import get_settings


@pytest.mark.asyncio
async def test_v2_backfill_trust_boundary_and_no_double_count(tmp_path, monkeypatch, sample_report_request):
    path = tmp_path / 'v2.sqlite'
    monkeypatch.setenv('QUIZ_DB_PATH', str(path))
    get_settings.cache_clear()
    await db.close_db()
    body = sample_report_request
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        for statement in db.SCHEMA_STATEMENTS:
            conn.execute(statement)
        attempt_schema.migrate(conn)
        conn.execute('PRAGMA user_version=2')
        conn.execute("INSERT INTO users(id,openid,total_xp) VALUES(1,'migration',18)")
        conn.execute('INSERT INTO quiz_sessions(quiz_id,user_id,title,questions_json) VALUES(?,1,?,?)',
                     (body['quiz_id'], body['topic'], json.dumps(body['questions'])))
        for aid, legacy in [('trusted', None), ('old-client', json.dumps(body['answer_records']))]:
            conn.execute('''INSERT INTO quiz_attempts(attempt_id,quiz_id,user_id,title,questions_json,status,
                total_questions,correct_count,accuracy,submitted_at,legacy_records_json) VALUES(?,?,1,?,?,'submitted',5,4,80,'2026-01-01',?)''',
                (aid, body['quiz_id'], body['topic'], json.dumps(body['questions']), legacy))
        for answer in body['answer_records']:
            conn.execute('INSERT INTO quiz_attempt_answers VALUES(?,?,?,?,?)', ('trusted', answer['question_id'],
                        json.dumps(answer['selected_answers']), answer['duration_ms'], int(answer['is_correct'])))
        conn.commit()
    finally:
        conn.close()
    try:
        await db.init_db()
        from app.repositories import question_bank_repository as bank
        from app.models.question_bank import BankQuery
        assert (await bank.stats(1)) == {'total': 5, 'wrong': 1, 'ever_wrong': 1, 'bookmarked': 0, 'uncategorized': 5}
        assert all(r['attempt_count'] == 1 for r in (await bank.list_entries(1, BankQuery()))['items'])
        await db.close_db()
        await db.init_db()
        assert (await bank.stats(1))['wrong'] == 1
        backups = list(tmp_path.glob('v2.sqlite.pre-v7-*.bak'))
        assert len(backups) == 1
        with sqlite3.connect(backups[0]) as backup:
            assert backup.execute('PRAGMA user_version').fetchone()[0] == 2
            assert backup.execute('SELECT total_xp FROM users').fetchone()[0] == 18
        with db.transaction() as cur:
            assert cur.execute('PRAGMA user_version').fetchone()[0] == 7
            assert cur.execute('SELECT total_xp FROM users').fetchone()[0] == 18
            assert cur.execute('SELECT COUNT(*) FROM question_bank_attempts WHERE source_json IS NOT NULL OR source_revision IS NOT NULL').fetchone()[0] == 0
            assert cur.execute('SELECT COUNT(*) FROM question_bank_sources').fetchone()[0] == 0
    finally:
        await db.close_db()
        get_settings.cache_clear()


@pytest.mark.asyncio
async def test_v2_bank_migration_failure_is_atomic(database, monkeypatch):
    await db.close_db()
    with sqlite3.connect(database) as conn:
        for table in ('question_bank_entry_categories', 'question_bank_categories', 'question_bank_attempts', 'question_bank_entries'):
            conn.execute(f'DROP TABLE {table}')
        conn.execute('PRAGMA user_version=2')
        conn.execute("INSERT INTO users(openid,total_xp) VALUES('rollback',25)")
    def fail(connection):
        connection.execute('CREATE TABLE bank_partial(value TEXT)')
        connection.execute('UPDATE users SET total_xp=0')
        raise RuntimeError('bank backfill failed')
    monkeypatch.setattr(db, 'migrate_bank', fail)
    with pytest.raises(RuntimeError, match='backfill'):
        await db.init_db()
    with sqlite3.connect(database) as conn:
        assert conn.execute('PRAGMA user_version').fetchone()[0] == 2
        assert conn.execute('SELECT total_xp FROM users').fetchone()[0] == 25
        assert not conn.execute("SELECT 1 FROM sqlite_master WHERE name='bank_partial'").fetchone()
    backup_path = next(database.parent.glob('*.pre-v7-*.bak'))
    with sqlite3.connect(backup_path) as backup:
        assert backup.execute('PRAGMA user_version').fetchone()[0] == 2
        assert backup.execute('SELECT total_xp FROM users').fetchone()[0] == 25
