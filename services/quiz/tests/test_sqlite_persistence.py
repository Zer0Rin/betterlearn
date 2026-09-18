"""Persistence acceptance tests using a real, isolated SQLite database."""
import asyncio
import sqlite3

import pytest

from app.core import db
from app.core.config import get_settings
from app.repositories import user_repository as users, knowledge_repository as docs, task_repository as tasks


@pytest.mark.asyncio
async def test_user_document_and_schema(database):
    results = await asyncio.gather(*(users.get_or_create_user('local:single') for _ in range(8)))
    user = results[0]
    assert len({r['id'] for r in results}) == 1
    await docs.create_document('doc', user['id'], '中文.pdf', 'pdf', 30)
    await docs.update_document_status('doc', 'ready', 3)
    assert (await docs.get_document('doc', user['id']))['chunk_count'] == 3
    assert await docs.get_document('doc', user['id'] + 1) is None
    assert len(await docs.list_documents(user['id'])) == 1
    with sqlite3.connect(database) as conn:
        assert conn.execute('PRAGMA user_version').fetchone()[0] == 8


@pytest.mark.asyncio
async def test_foreign_key_failure_rolls_back(database):
    uid = (await users.create_user('local:rollback'))['id']
    with pytest.raises(sqlite3.IntegrityError):
        await docs.create_document('bad', uid + 100, 'x', 'txt', 1)
    assert await docs.list_documents(uid) == []


@pytest.mark.asyncio
async def test_restart_recovers_only_interrupted_work(database):
    uid = (await users.create_user('local:restart'))['id']
    await docs.create_document('pending', uid, 'x', 'txt', 1)
    await docs.claim_vectorization('pending', uid)
    await docs.create_document('uploaded', uid, 'x', 'txt', 1)
    await docs.create_document('ready', uid, 'x', 'txt', 1)
    await docs.update_document_status('ready', 'ready', 2)
    for name in ['pending', 'running', 'completed']:
        await tasks.create_task(name, uid, 'topic', 5, 'mixed')
        await tasks.update_task_status(name, name, {'quiz_id': name} if name == 'completed' else None)
    await db.close_db()
    await db.init_db()
    assert (await docs.get_document('pending', uid))['status'] == 'failed'
    assert (await docs.get_document('uploaded', uid))['status'] == 'uploaded'
    assert (await docs.get_document('ready', uid))['status'] == 'ready'
    for name in ['pending', 'running']:
        assert (await tasks.get_task(name))['status'] == 'failed'
    assert (await tasks.get_task('completed'))['result_json'] == {'quiz_id': 'completed'}


@pytest.mark.asyncio
async def test_future_schema_refused_without_mutation(database):
    await db.close_db()
    with sqlite3.connect(database) as conn:
        conn.execute('PRAGMA user_version = 99')
    with pytest.raises(RuntimeError, match='schema version'):
        await db.init_db()
    with sqlite3.connect(database) as conn:
        assert conn.execute('PRAGMA user_version').fetchone()[0] == 99


@pytest.mark.asyncio
async def test_active_tasks_managed_boundary(database, monkeypatch):
    from httpx import ASGITransport, AsyncClient
    from app.main import app
    settings = get_settings()
    monkeypatch.setattr(settings, 'managed_host_token', 'test-host-secret')
    transport = ASGITransport(app=app, client=('127.0.0.1', 1234))
    async with AsyncClient(transport=transport, base_url='http://test') as client:
        assert (await client.get('/api/v1/user/active-tasks')).status_code == 403
        headers = {'x-betterlearn-host': 'test-host-secret'}
        response = await client.get('/api/v1/user/active-tasks', headers=headers)
        assert response.status_code == 200
        assert response.json()['data'] == {'active': False}
        await tasks.create_task('active', None, 'topic', 5, 'mixed')
        assert (await client.get('/api/v1/user/active-tasks', headers=headers)).json()['data'] == {'active': True}
        await tasks.update_task_status('active', 'completed', {})
        assert (await client.get('/api/v1/user/active-tasks', headers=headers)).json()['data'] == {'active': False}
        monkeypatch.setattr(settings, 'managed_host_token', '')
        assert (await client.get('/api/v1/user/active-tasks', headers=headers)).status_code == 403


@pytest.mark.asyncio
async def test_empty_configuration_startup_and_local_profile(tmp_path, monkeypatch):
    from httpx import ASGITransport, AsyncClient
    from app.main import app
    monkeypatch.setenv('QUIZ_DB_PATH', str(tmp_path / 'unconfigured.sqlite3'))
    monkeypatch.setenv('MANAGED_HOST_TOKEN', 'host-test')
    monkeypatch.setenv('DEEPSEEK_API_KEY', '')
    monkeypatch.setenv('DASHSCOPE_API_KEY', '')
    get_settings.cache_clear()
    await db.close_db()
    try:
        async with app.router.lifespan_context(app):
            async with AsyncClient(transport=ASGITransport(app=app, client=('127.0.0.1', 1)), base_url='http://test', headers={'x-betterlearn-host': 'host-test'}) as client:
                assert (await client.get('/api/v1/health')).status_code == 200
                response = await client.post('/api/v1/user/host-session')
                assert response.status_code == 200
                token = response.json()['data']['token']
                headers = {'authorization': f'Bearer {token}'}
                assert (await client.get('/api/v1/user/profile', headers=headers)).status_code == 200
                history = await client.get('/api/v1/user/quizzes', headers=headers)
                assert history.status_code == 200
                assert history.json()['data']['total'] == 0
    finally:
        await db.close_db()
        get_settings.cache_clear()
