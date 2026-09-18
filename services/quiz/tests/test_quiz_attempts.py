"""Actual API, isolated SQLite, fake model: scores must survive report failure."""
import asyncio
from copy import deepcopy
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.core import db
from app.core.auth import create_token
from app.core.config import get_settings
from app.main import app
from app.models.report import ReportOutput, ReportGenerateRequest
from app.repositories import quiz_repository as quizzes, user_repository as users
from app.repositories.task_repository import has_active_tasks
from app.services import report_service

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def api(database, sample_report_request, monkeypatch):
    uid = (await users.create_user('attempt-owner'))['id']
    body = sample_report_request
    await quizzes.save_quiz_session(body['quiz_id'], uid, body['topic'], '', '', body['questions'])
    monkeypatch.setattr(get_settings(), 'managed_host_token', '')
    monkeypatch.setattr(get_settings(), 'jwt_secret', 'test-attempt-secret-at-least-32-characters')
    headers = {'authorization': 'Bearer ' + create_token(uid, 'attempt-owner')}
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test', headers=headers) as client:
        yield client, uid, body


@pytest.fixture
def model(monkeypatch):
    mock = AsyncMock(return_value=ReportOutput(accuracy=99, mastered_points=[], weak_points=[],
                        three_line_summary=[], advice=[], share_quote=''))
    monkeypatch.setattr(report_service, 'generate_report', mock)
    return mock


async def create(client, body, key='first'):
    response = await client.post(f"/api/v1/quiz/{body['quiz_id']}/attempts", json={'request_id': key})
    assert response.status_code == 200, response.text
    return response.json()['data']


async def submit(client, attempt, body, revision=0):
    return await client.post(f"/api/v1/quiz/attempts/{attempt['attempt_id']}/submit",
                            json={'expected_revision': revision, 'answer_records': body['answer_records']})


async def test_score_survives_report_failure_and_retry(api, model):
    client, uid, body = api
    attempt = await create(client, body)
    assert attempt['accuracy'] is None and attempt['submitted_at'] is None
    response = await submit(client, attempt, body)
    assert response.status_code == 200, response.text
    saved = response.json()['data']
    assert saved['accuracy'] == 80 and saved['xp_gain'] == 18
    assert saved['answer_records'][2]['is_correct'] is False
    model.assert_not_awaited()
    path = f"/api/v1/quiz/attempts/{attempt['attempt_id']}"
    model.side_effect = RuntimeError('private provider failure')
    assert (await client.post(path + '/report', json={})).status_code == 500
    after = (await client.get(path)).json()['data']
    assert after['accuracy'] == 80 and after['submitted_at'] == saved['submitted_at']
    assert after['report_status'] == 'failed' and 'private' not in str(after)
    assert (await users.get_user_by_id(uid))['total_xp'] == 18
    model.side_effect = None
    report = await client.post(path + '/report', json={})
    assert report.status_code == 200 and report.json()['data']['accuracy'] == 80
    await client.post(path + '/report', json={})
    assert model.await_count == 2 and not await has_active_tasks()


async def test_repeated_and_concurrent_submission_rounds_and_history(api, model):
    client, uid, body = api
    first, repeated = await asyncio.gather(create(client, body), create(client, body))
    assert first['attempt_id'] == repeated['attempt_id']
    responses = await asyncio.gather(*(submit(client, first, body) for _ in range(5)))
    assert all(r.status_code == 200 for r in responses)
    assert len({r.json()['data']['submitted_at'] for r in responses}) == 1
    reordered = deepcopy(body)
    reordered['answer_records'].reverse()
    reordered['answer_records'][1]['selected_answers'].reverse()
    assert (await submit(client, first, reordered)).status_code == 200
    changed = deepcopy(body)
    changed['answer_records'][0]['selected_answers'] = ['B']
    assert (await submit(client, first, changed)).status_code == 409
    second = await create(client, body, 'second')
    second_result = await submit(client, second, changed)
    assert second_result.status_code == 200
    assert second_result.json()['data']['accuracy'] == 60
    assert second_result.json()['data']['xp_gain'] == 0
    assert (await users.get_user_by_id(uid))['total_xp'] == 18
    assert (await quizzes.get_user_answer_stats(uid)) == {'correct_count': 7, 'average_accuracy': 70}
    items = (await client.get(f"/api/v1/quiz/{body['quiz_id']}/attempts")).json()['data']['items']
    assert len(items) == 2
    listing, _ = await quizzes.get_user_quiz_list(uid, 1, 10)
    assert listing[0]['attempt_id'] == second['attempt_id'] and listing[0]['accuracy'] == 60
    model.assert_not_awaited()


async def test_draft_revision_restart_and_invalid_submission(api, model):
    client, uid, body = api
    attempt = await create(client, body)
    path = f"/api/v1/quiz/attempts/{attempt['attempt_id']}"
    payload = {'expected_revision': 0, 'answer_records': body['answer_records'][:2]}
    assert (await client.put(path + '/answers', json=payload)).status_code == 200
    assert (await client.put(path + '/answers', json=payload)).status_code == 409
    assert (await client.post(path + '/report', json={})).status_code == 409
    await db.close_db()
    await db.init_db()
    resumed = (await client.get(path)).json()['data']
    assert resumed['revision'] == 1 and len(resumed['answer_records']) == 2
    assert all(r['is_correct'] is None for r in resumed['answer_records'])
    assert (await submit(client, attempt, body)).status_code == 409
    assert (await client.post(path + '/submit', json=payload | {'expected_revision': 1})).status_code == 422
    invalid = deepcopy(body)
    invalid['answer_records'][0]['selected_answers'] = ['Z']
    assert (await submit(client, attempt, invalid, 1)).status_code == 422
    assert (await client.get(path)).json()['data']['revision'] == 1
    assert (await users.get_user_by_id(uid))['total_xp'] == 0
    assert (await submit(client, attempt, body, 1)).status_code == 200
    assert (await client.put(path + '/answers', json=payload | {'expected_revision': 2})).status_code == 409


async def test_ownership_and_idempotency_scope(api):
    client, uid, body = api
    attempt = await create(client, body)
    await quizzes.save_quiz_session('other-quiz', uid, 'other', '', '', body['questions'])
    assert (await client.post('/api/v1/quiz/other-quiz/attempts', json={'request_id': 'first'})).status_code == 409
    outsider = (await users.create_user('outsider'))['id']
    client.headers['authorization'] = 'Bearer ' + create_token(outsider, 'outsider')
    path = f"/api/v1/quiz/attempts/{attempt['attempt_id']}"
    for method, route, payload in [
        ('GET', path, None), ('GET', f"/api/v1/quiz/{body['quiz_id']}/attempts", None),
        ('POST', f"/api/v1/quiz/{body['quiz_id']}/attempts", {'request_id': 'outsider'}),
        ('PUT', path + '/answers', {'expected_revision': 0, 'answer_records': []}),
        ('POST', path + '/submit', {'expected_revision': 0, 'answer_records': body['answer_records']}),
        ('POST', path + '/report', {}),
    ]:
        assert (await client.request(method, route, json=payload)).status_code == 404
    del client.headers['authorization']
    assert (await client.get(path)).status_code == 401


async def test_report_claim_concurrency_and_cancellation(api, model):
    client, uid, body = api
    attempt = await create(client, body)
    await submit(client, attempt, body)
    started, release = asyncio.Event(), asyncio.Event()
    async def delayed(**kwargs):
        started.set()
        await release.wait()
        return model.return_value
    model.side_effect = delayed
    task = asyncio.create_task(report_service.handle_attempt_report(attempt['attempt_id'], uid))
    await asyncio.wait_for(started.wait(), 2)
    assert await has_active_tasks()
    path = f"/api/v1/quiz/attempts/{attempt['attempt_id']}"
    assert (await client.post(path + '/report', json={})).status_code == 409
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert not await has_active_tasks()
    assert (await client.get(path)).json()['data']['report_status'] == 'failed'
    model.side_effect = None
    assert (await client.post(path + '/report', json={})).status_code == 200
    assert (await users.get_user_by_id(uid))['total_xp'] == 18


async def test_legacy_failure_retries_saved_answers(api, model):
    client, uid, body = api
    model.side_effect = RuntimeError('failed')
    with pytest.raises(Exception):
        await report_service.handle_report_generate(ReportGenerateRequest(**body), uid)
    detail = await quizzes.get_quiz_detail(body['quiz_id'], uid)
    assert detail['answer_records'][2]['is_correct'] is False
    assert (await users.get_user_by_id(uid))['total_xp'] == 18
    changed = deepcopy(body)
    changed['answer_records'][2]['selected_answers'] = ['B']
    model.side_effect = None
    result = await report_service.handle_report_generate(ReportGenerateRequest(**changed), uid)
    assert result.accuracy == 80
    assert model.call_args.kwargs['answer_records'][2].is_correct is False
    assert (await users.get_user_by_id(uid))['total_xp'] == 18


async def test_threaded_submissions_are_atomic_and_failed_write_rolls_back(api):
    import sqlite3
    from app.repositories import attempt_repository as attempts
    from app.models.attempt import AttemptAnswer
    client, uid, body = api
    attempt = await create(client, body)
    answers = [AttemptAnswer.model_validate(a) for a in body['answer_records']]
    with db.transaction() as cur:
        cur.execute("CREATE TRIGGER fail_xp BEFORE UPDATE ON users BEGIN SELECT RAISE(ABORT, 'failure'); END")
    with pytest.raises(sqlite3.IntegrityError):
        await attempts.submit_attempt(attempt['attempt_id'], uid, 0, answers)
    current = await attempts.get_attempt(attempt['attempt_id'], uid)
    assert current['status'] == 'draft' and current['answer_records'] == []
    assert current['accuracy'] is None and (await users.get_user_by_id(uid))['total_xp'] == 0
    with db.transaction() as cur:
        cur.execute('DROP TRIGGER fail_xp')
    # Real independent threads run their own event loops against the shared DB.
    def worker():
        return asyncio.run(attempts.submit_attempt(attempt['attempt_id'], uid, 0, answers))
    results = await asyncio.gather(*(asyncio.to_thread(worker) for _ in range(8)))
    assert all(r == results[0] for r in results)
    assert (await users.get_user_by_id(uid))['total_xp'] == 18
    with db.transaction() as cur:
        assert cur.execute('SELECT COUNT(*) FROM quiz_attempt_answers').fetchone()[0] == 5


async def test_snapshot_zero_score_and_report_restart_recovery(api, model):
    import json
    from app.repositories import attempt_repository as attempts
    client, uid, body = api
    attempt = await create(client, body)
    changed_questions = deepcopy(body['questions'])
    changed_questions[0]['answer'] = ['B']
    with db.transaction() as cur:
        cur.execute('UPDATE quiz_sessions SET questions_json=?, title=? WHERE quiz_id=?',
                    (json.dumps(changed_questions), 'changed title', body['quiz_id']))
    assert (await submit(client, attempt, body)).json()['data']['accuracy'] == 80
    _, token = await attempts.claim_report(attempt['attempt_id'], uid)
    await db.close_db()
    await db.init_db()
    assert not await has_active_tasks()
    assert (await attempts.get_attempt(attempt['attempt_id'], uid))['report_status'] == 'failed'
    _, next_token = await attempts.claim_report(attempt['attempt_id'], uid)
    from app.core.exceptions import AttemptError
    with pytest.raises(AttemptError):
        await attempts.finish_report(attempt['attempt_id'], uid, token, {'accuracy': 100})
    assert await has_active_tasks()
    await attempts.finish_report(attempt['attempt_id'], uid, next_token)
    result = await report_service.handle_attempt_report(attempt['attempt_id'], uid)
    assert result.accuracy == 80
    assert model.call_args.kwargs['topic'] == body['topic']
    assert model.call_args.kwargs['questions'][0].answer == ['A']
    zero_body = deepcopy(body)
    for record in zero_body['answer_records']:
        question = next(q for q in changed_questions if q['id'] == record['question_id'])
        record['selected_answers'] = [next(o['key'] for o in question['options'] if o['key'] not in question['answer'])]
        record['is_correct'] = True
    zero = await create(client, body, 'zero')
    result = (await submit(client, zero, zero_body)).json()['data']
    assert result['accuracy'] == 0 and result['status'] == 'submitted' and result['submitted_at']


@pytest.mark.parametrize('submitted', [False, True])
async def test_legacy_cannot_create_round_alongside_modern_attempt(api, model, submitted):
    client, uid, body = api
    attempt = await create(client, body)
    if submitted:
        assert (await submit(client, attempt, body)).status_code == 200
    def snapshot():
        with db.transaction() as cur:
            return {table: [tuple(row) for row in cur.execute('SELECT * FROM ' + table)]
                    for table in ['quiz_attempts', 'quiz_attempt_answers', 'question_bank_entries', 'users']}
    before = snapshot()
    response = await client.post('/api/v1/report/generate', json=body)
    assert response.status_code == 409, response.text
    assert snapshot() == before
    model.assert_not_awaited()
    if not submitted:
        assert (await submit(client, attempt, body)).json()['data']['xp_gain'] == 18
    assert (await client.post(f"/api/v1/quiz/attempts/{attempt['attempt_id']}/report", json={})).status_code == 200


async def test_legacy_saved_report_replay_after_modern_round_is_read_only(api, model):
    client, uid, body = api
    saved = await client.post('/api/v1/report/generate', json=body)
    assert saved.status_code == 200
    await create(client, body)
    assert (await client.post('/api/v1/report/generate', json=body)).json() == saved.json()
    assert model.await_count == 1
    assert len((await client.get(f"/api/v1/quiz/{body['quiz_id']}/attempts")).json()['data']['items']) == 2
    assert (await users.get_user_by_id(uid))['total_xp'] == 18
