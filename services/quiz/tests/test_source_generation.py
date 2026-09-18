import asyncio
from unittest.mock import AsyncMock
import pytest
from app.core import db
from app.models.quiz import QuizOutput
from tests.test_quiz_attempts import api, create, submit
from tests.test_question_sources import source, managed
from tests.test_question_bank import data

pytestmark = pytest.mark.asyncio
PATH = '/api/v1/quiz/generate/from-source'


async def wait_task(client, task_id):
    for _ in range(100):
        response = await client.get('/api/v1/quiz/task/' + task_id)
        assert response.status_code == 200, response.text
        result = response.json()['data']
        if result['status'] in ('failed', 'completed'):
            return result
        await asyncio.sleep(.005)
    pytest.fail('source task did not finish')


async def test_source_generation_persists_mapping_and_deduplicates(api, monkeypatch):
    client, uid, body = api
    managed(client, monkeypatch)
    # No paid calls, even while the endpoint is initially missing.
    generated = AsyncMock(return_value=QuizOutput(title='源题卷', summary='', questions=body['questions']))
    monkeypatch.setattr('app.services.quiz_service.generate_quiz', generated)
    payload = {'request_id': 'same-request', 'source': source()}
    results = await asyncio.gather(*(client.post(PATH, json=payload) for _ in range(3)))
    assert all(r.status_code == 200 for r in results), results[0].text
    task_id = results[0].json()['data']['task_id']
    assert all(r.json()['data']['task_id'] == task_id for r in results)
    result = await wait_task(client, task_id)
    assert result['status'] == 'completed'
    assert generated.await_count == 1
    assert '冻结陈述' in generated.call_args.kwargs['search_context']
    entries = (await data(client, quiz_id=result['result']['quiz_id']))['items']
    assert len(entries) == 5
    assert all(e['source'] == source() and e['source_revision'] == 1 for e in entries)
    answers = body | {'quiz_id': result['result']['quiz_id']}
    attempt = await create(client, answers, 'source-attempt')
    assert (await submit(client, attempt, answers)).status_code == 200
    stats = (await client.get('/api/v1/question-bank/knowledge-stats')).json()['data']
    assert stats['total'] == 1 and stats['items'][0]['answer_count'] == 5
    assert stats['items'][0]['correct_count'] == 4
    assert (await client.post(PATH, json=payload | {'question_count': 3})).status_code == 409
    await db.close_db()
    await db.init_db()
    assert (await client.post(PATH, json=payload)).json()['data']['task_id'] == task_id
    assert generated.await_count == 1


async def test_source_generation_privacy_failure_and_no_network(api, monkeypatch):
    from app.core.auth import create_token
    from app.repositories import user_repository as users
    client, uid, body = api
    payload = {'request_id': 'private-source', 'source': source()}
    assert (await client.post(PATH, json=payload)).status_code == 403
    managed(client, monkeypatch)
    network = AsyncMock(side_effect=AssertionError('source generation must not search'))
    monkeypatch.setattr('app.services.quiz_service._fetch_context', network)
    generated = AsyncMock(side_effect=RuntimeError('secret provider token'))
    monkeypatch.setattr('app.services.quiz_service.generate_quiz', generated)
    response = await client.post(PATH, json=payload)
    task_id = response.json()['data']['task_id']
    result = await wait_task(client, task_id)
    assert result['status'] == 'failed' and 'secret' not in result['error_message']
    assert (await client.post(PATH, json=payload)).json()['data']['task_id'] == task_id
    assert generated.await_count == 1
    network.assert_not_awaited()
    other = await users.create_user('foreign-source-task')
    client.headers['authorization'] = 'Bearer ' + create_token(other['id'], 'foreign-source-task')
    assert (await client.get('/api/v1/quiz/task/' + task_id)).status_code == 404
    assert (await client.get('/api/v1/quiz/source-request/private-source')).status_code == 404
    del client.headers['authorization']
    assert (await client.get('/api/v1/quiz/task/' + task_id)).status_code == 404
    assert (await client.post(PATH, json=payload)).status_code == 401


@pytest.mark.parametrize('failure_stage', ['source', 'completion'])
async def test_source_generation_atomic_rollback_and_model_ids_ignored(api, monkeypatch, failure_stage):
    client, uid, body = api
    managed(client, monkeypatch)
    raw = {'title': '源题卷', 'summary': '', 'questions': [
        q | {'source': source('2'), 'knowledge_point_id': 'kp_' + '2' * 20} for q in body['questions']]}
    generated = AsyncMock(return_value=QuizOutput.model_validate(raw))
    monkeypatch.setattr('app.services.quiz_service.generate_quiz', generated)
    with db.transaction() as cur:
        if failure_stage == 'source':
            cur.execute("""CREATE TRIGGER source_save_fail BEFORE INSERT ON question_bank_sources
                BEGIN SELECT RAISE(ABORT,'source failure'); END""")
        else:
            cur.execute("""CREATE TRIGGER source_save_fail BEFORE UPDATE ON quiz_tasks
                WHEN NEW.status='completed' BEGIN SELECT RAISE(ABORT,'completion failure'); END""")
        count = cur.execute('SELECT COUNT(*) FROM quiz_sessions').fetchone()[0]
    task = (await client.post(PATH, json={'request_id': 'rollback', 'source': source()})).json()['data']['task_id']
    assert (await wait_task(client, task))['status'] == 'failed'
    with db.transaction() as cur:
        assert cur.execute('SELECT COUNT(*) FROM quiz_sessions').fetchone()[0] == count
        assert cur.execute('SELECT COUNT(*) FROM question_bank_sources').fetchone()[0] == 0
        cur.execute('DROP TRIGGER source_save_fail')
    task = (await client.post(PATH, json={'request_id': 'explicit-new', 'source': source()})).json()['data']['task_id']
    result = await wait_task(client, task)
    assert result['status'] == 'completed'
    entries = (await data(client, quiz_id=result['result']['quiz_id']))['items']
    assert all(e['source'] == source() for e in entries)
    assert all('source' not in e['question'] and 'knowledge_point_id' not in e['question'] for e in entries)


async def test_persisted_pending_source_task_fails_on_restart_without_regeneration(api, monkeypatch):
    from app.repositories import source_generation_repository as repo
    from app.models.source_generation import SourceGenerateRequest
    client, uid, body = api
    managed(client, monkeypatch)
    payload = {'request_id': 'restart', 'source': source()}
    task_id, fresh = await repo.create(uid, SourceGenerateRequest.model_validate(payload))
    assert fresh
    await db.close_db()
    await db.init_db()
    generated = AsyncMock(side_effect=AssertionError('no automatic paid retry'))
    monkeypatch.setattr('app.services.quiz_service.generate_quiz', generated)
    assert (await client.post(PATH, json=payload)).json()['data']['task_id'] == task_id
    assert (await wait_task(client, task_id))['status'] == 'failed'
    generated.assert_not_awaited()
    lookup = (await client.get('/api/v1/quiz/source-request/restart')).json()['data']
    assert lookup['request']['source'] == source()


async def test_concurrent_repository_create_and_claim_only_once(api):
    from app.repositories import source_generation_repository as repo
    from app.models.source_generation import SourceGenerateRequest
    _, uid, _ = api
    request = SourceGenerateRequest(request_id='threads', source=source())
    async def worker():
        return await asyncio.to_thread(lambda: asyncio.run(repo.create(uid, request)))
    results = await asyncio.gather(*(worker() for _ in range(4)))
    assert len({task_id for task_id, _ in results}) == 1
    assert sum(fresh for _, fresh in results) == 1
    task_id = results[0][0]
    claimed = await asyncio.gather(*(asyncio.to_thread(lambda: asyncio.run(repo.claim(task_id))) for _ in range(3)))
    assert sum(row is not None for row in claimed) == 1


@pytest.mark.parametrize('invalid', ['answer', 'duplicate_id', 'count', 'blank_key', 'blank_id'])
async def test_invalid_generated_inventory_fails_before_images_or_save(api, monkeypatch, invalid):
    from copy import deepcopy
    client, uid, body = api
    managed(client, monkeypatch)
    questions = deepcopy(body['questions'])
    if invalid == 'answer':
        questions[0]['answer'] = ['missing_option']
    elif invalid == 'duplicate_id':
        questions[0]['id'] = questions[1]['id']
    elif invalid == 'blank_key':
        questions[0]['answer'] = ['']
        questions[0]['options'][0]['key'] = ''
    elif invalid == 'blank_id':
        questions[0]['id'] = ''
    else:
        questions.pop()
    generated = AsyncMock(return_value=QuizOutput(title='invalid', summary='', questions=questions))
    images = AsyncMock(return_value=None)
    monkeypatch.setattr('app.services.quiz_service.generate_quiz', generated)
    monkeypatch.setattr('app.services.quiz_service._maybe_generate_images', images)
    with db.transaction() as cur:
        count = cur.execute('SELECT COUNT(*) FROM quiz_sessions').fetchone()[0]
    task = (await client.post(PATH, json={'request_id': invalid, 'source': source(), 'generate_images': True})).json()['data']['task_id']
    assert (await wait_task(client, task))['status'] == 'failed'
    images.assert_not_awaited()
    with db.transaction() as cur:
        assert cur.execute('SELECT COUNT(*) FROM quiz_sessions').fetchone()[0] == count
