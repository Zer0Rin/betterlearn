"""Temporary SQLite only: owned immutable goals, deadline evidence and CAS."""
import asyncio
from copy import deepcopy
from datetime import datetime, timezone
import uuid

import pytest
from app.core import db
from app.core.auth import create_token
from app.repositories import user_repository as users
from tests.test_quiz_attempts import api
from tests.test_question_sources import source, managed
from tests.test_knowledge_stats import bind
from tests.test_knowledge_assessment import copied_entry, record, assess

pytestmark = pytest.mark.asyncio
ROOT = '/api/v1/learning-goals'


def payload(**changes):
    return dict(request_id=str(uuid.uuid4()), title='  练习目标  ', source=source(),
                due_at='2099-01-01T08:00:00+08:00') | changes


async def create_goal(client, body):
    response = await client.post(ROOT, json=body)
    assert response.status_code == 200, response.text
    return response.json()['data']


async def detail(client, goal):
    response = await client.get(ROOT + '/' + goal['goal_id'])
    assert response.status_code == 200, response.text
    return response.json()['data']


async def test_create_replay_normalization_archive_and_restart(api, monkeypatch):
    client, uid, _ = api
    managed(client, monkeypatch)
    body = payload()
    goal = await create_goal(client, body)
    assert goal['title'] == '练习目标' and goal['due_at'] == '2099-01-01T00:00:00.000Z'
    assert goal['target_percent'] == 90 and goal['min_distinct_questions'] == 5
    assert goal['revision'] == 0 and goal['archived'] is False
    assert 'evidence' not in goal['source'] and 'request_digest' not in goal
    normalized = body | {'title': '练习目标', 'due_at': '2099-01-01T00:00:00Z', 'target_percent': 90, 'min_distinct_questions': 5}
    assert await create_goal(client, normalized) == goal
    request = await client.get(ROOT + '/request/' + body['request_id'])
    assert request.json()['data']['request']['source'] == source()
    for changed in [{'title': 'different'}, {'target_percent': 80}, {'min_distinct_questions': 7},
                    {'due_at': '2099-01-02T00:00:00Z'}, {'source': source('2')}]:
        assert (await client.post(ROOT, json=body | changed)).status_code == 409
    path = ROOT + '/' + goal['goal_id'] + '/archive'
    change = {'expected_revision': 0, 'archived': True}
    archived = (await client.put(path, json=change)).json()['data']
    assert archived['archived'] is True and archived['revision'] == 1
    assert (await client.put(path, json=change)).json()['data'] == archived
    assert (await client.put(path, json={'expected_revision': 0, 'archived': False})).status_code == 409
    assert await create_goal(client, body) == archived
    await db.close_db()
    await db.init_db()
    assert await create_goal(client, body) == archived
    from app.repositories import learning_goal_repository as goals
    monkeypatch.setattr(goals, 'utc_now', lambda: datetime(2100, 1, 1, tzinfo=timezone.utc))
    assert await create_goal(client, body) == archived  # Replay before future-deadline check.
    assert (await client.post(ROOT, json=payload())).status_code == 422
    restored = (await client.put(path, json={'expected_revision': 1, 'archived': False})).json()['data']
    assert restored['revision'] == 2 and restored['due_at'] == goal['due_at']
    assert (await detail(client, goal))['progress']['deadline_passed'] is True


async def test_deadline_includes_existing_history_and_exact_boundary_but_not_late_answers(api, monkeypatch):
    client, uid, body = api
    managed(client, monkeypatch)
    attempts = []
    for i in range(6):
        copied, entry = await copied_entry(client, uid, body, str(i), True)
        await bind(client, entry, source())
        attempts.append(await record(client, copied, 'goal-answer-' + str(i), i < 5))
    goal = await create_goal(client, payload(due_at='2099-01-01T00:00:00.123Z'))
    with db.transaction() as cur:
        for i, attempt in enumerate(attempts):
            at = '2098-12-31 23:59:59.999' if i < 4 else '2099-01-01 00:00:00.' + ('123' if i == 4 else '124')
            cur.execute('UPDATE quiz_attempts SET submitted_at=? WHERE attempt_id=?', (at, attempt['attempt_id']))
    from app.repositories import learning_goal_repository as goals
    monkeypatch.setattr(goals, 'utc_now', lambda: datetime(2099, 1, 2, tzinfo=timezone.utc))
    result = (await detail(client, goal))['progress']
    assert result['answer_count'] == result['distinct_question_count'] == 5
    assert result['evidence_score'] == 1 and result['criteria_met'] is True
    assert result['remaining_distinct_questions'] == 0 and result['deadline_passed'] is True
    assert result['evidence_cutoff_at'] == goal['due_at']
    assert result['basis'][-1]['attempt_id'] == attempts[4]['attempt_id']
    # Current all-history assessment still contains the post-deadline wrong answer.
    assert (await assess(client))['evidence_score'] == .75
    with db.transaction() as cur:
        before = cur.connection.total_changes
    assert (await detail(client, goal))['progress'] == result
    with db.transaction() as cur:
        assert cur.connection.total_changes == before
    monkeypatch.setattr(goals, 'utc_now', lambda: datetime(2098, 12, 31, 23, 59, 59, 999000, tzinfo=timezone.utc))
    ongoing = (await detail(client, goal))['progress']
    assert ongoing['deadline_passed'] is False and ongoing['distinct_question_count'] == 4
    assert ongoing['criteria_met'] is False and ongoing['remaining_distinct_questions'] == 1


async def test_empty_count_gate_versions_and_duplicates(api, monkeypatch):
    client, uid, body = api
    managed(client, monkeypatch)
    goal = await create_goal(client, payload())
    empty = (await detail(client, goal))['progress']
    assert empty['evidence_score'] is None and empty['criteria_met'] is False
    assert empty['remaining_distinct_questions'] == 5
    for i in range(3):
        copied, entry = await copied_entry(client, uid, body, str(i), True)
        await bind(client, entry, source())
        await record(client, copied, 'gate-' + str(i), True)
    three = (await detail(client, goal))['progress']
    assert three['evidence_score'] == 1 and three['criteria_met'] is False
    await record(client, copied, 'repeat', True)
    assert (await detail(client, goal))['progress']['distinct_question_count'] == 3
    smaller = await create_goal(client, payload(min_distinct_questions=3))
    assert (await detail(client, smaller))['progress']['criteria_met'] is True
    import hashlib
    from app.models.question_source import canonical
    newer = source() | {'statement': 'new version'}
    newer['content_version'] = hashlib.sha256(canonical({k: newer[k] for k in
        ('knowledge_point_id', 'type', 'title', 'statement', 'evidence')}).encode()).hexdigest()
    newgoal = await create_goal(client, payload(source=newer))
    assert (await detail(client, newgoal))['progress']['evidence_score'] is None


async def test_user_isolation_list_and_host_boundary(api, monkeypatch):
    client, uid, _ = api
    body = payload()
    assert (await client.post(ROOT, json=body)).status_code == 403
    assert (await client.get(ROOT + '/request/' + body['request_id'])).status_code == 403
    managed(client, monkeypatch)
    a = await create_goal(client, body)
    b = await create_goal(client, payload())
    assert (await client.get(ROOT, params={'page_size': 1})).json()['data']['items'][0]['goal_id'] == b['goal_id']
    assert 'progress' not in (await client.get(ROOT)).json()['data']['items'][0]
    await client.put(ROOT + '/' + a['goal_id'] + '/archive', json={'expected_revision': 0, 'archived': True})
    assert (await client.get(ROOT)).json()['data']['total'] == 1
    assert (await client.get(ROOT, params={'status': 'all'})).json()['data']['total'] == 2
    assert (await client.get(ROOT, params={'status': 'archived'})).json()['data']['items'][0]['goal_id'] == a['goal_id']
    outsider = await users.create_user('goal-other')
    client.headers['authorization'] = 'Bearer ' + create_token(outsider['id'], 'goal-other')
    assert (await client.get(ROOT)).json()['data']['total'] == 0
    for method, path, data in [('GET', '/' + a['goal_id'], None), ('GET', '/request/' + body['request_id'], None),
                              ('PUT', '/' + a['goal_id'] + '/archive', {'expected_revision': 1, 'archived': False})]:
        assert (await client.request(method, ROOT + path, json=data)).status_code == 404
    assert (await create_goal(client, body))['goal_id'] != a['goal_id']
    del client.headers['authorization']
    assert (await client.get(ROOT)).status_code == 401


async def test_concurrent_creation_archive_and_rollback(api, monkeypatch):
    client, uid, _ = api
    managed(client, monkeypatch)
    # First API request also ensures missing implementation fails at HTTP boundary.
    first = await create_goal(client, payload())
    from app.models.learning_goal import GoalCreate, GoalArchive
    from app.repositories import learning_goal_repository as goals
    from app.core.exceptions import BankError
    request = GoalCreate.model_validate(payload())
    async def threaded(fn, *args):
        return await asyncio.to_thread(lambda: asyncio.run(fn(*args)))
    created = await asyncio.gather(*(threaded(goals.create, uid, request) for _ in range(4)))
    assert len({g['goal_id'] for g in created}) == 1
    results = await asyncio.gather(*(threaded(goals.archive, uid, first['goal_id'], GoalArchive(expected_revision=0, archived=x))
                                    for x in (True, False)), return_exceptions=True)
    assert sum(isinstance(r, dict) for r in results) == 1
    assert sum(isinstance(r, BankError) for r in results) == 1
    with db.transaction() as cur:
        before = cur.execute('SELECT COUNT(*) FROM learning_goals').fetchone()[0]
        cur.execute("CREATE TRIGGER goal_fail AFTER INSERT ON learning_goals BEGIN SELECT RAISE(ABORT,'goal failure'); END")
    import sqlite3
    with pytest.raises(sqlite3.IntegrityError):
        await goals.create(uid, GoalCreate.model_validate(payload()))
    with db.transaction() as cur:
        assert cur.execute('SELECT COUNT(*) FROM learning_goals').fetchone()[0] == before
        cur.execute('DROP TRIGGER goal_fail')


@pytest.mark.parametrize('change', [
    {'title': ''}, {'title': '   '}, {'title': 'a' * 121}, {'target_percent': True}, {'target_percent': 0},
    {'target_percent': 101}, {'target_percent': '90'}, {'min_distinct_questions': 2}, {'min_distinct_questions': 101},
    {'due_at': '2099-02-30T00:00:00Z'}, {'due_at': '2099-01-01'}, {'due_at': '2099-01-01T00:00:00'},
    {'due_at': '2099-01-01T00:00:00.1234Z'}, {'due_at': '2099-01-01T00:00:00+24:00'},
    {'due_at': '2099-01-01T00:00:00+00:60'},
    {'request_id': 'bad'}, {'user_id': 1}, {'criteria_met': True}, {'source': source() | {'content_version': '0' * 64}},
])
async def test_invalid_create(api, monkeypatch, change):
    client, _, _ = api
    managed(client, monkeypatch)
    assert (await client.post(ROOT, json=payload() | change)).status_code == 422


async def test_exact_queries_and_archive_fields(api, monkeypatch):
    client, _, _ = api
    managed(client, monkeypatch)
    goal = await create_goal(client, payload())
    for params in [{'page': 0}, {'page_size': 51}, {'user_id': 2}, {'status': 'bad'}, [('page', 1), ('page', 2)]]:
        assert (await client.get(ROOT, params=params)).status_code == 422
    path = ROOT + '/' + goal['goal_id']
    assert (await client.get(path, params={'page': 1})).status_code == 422
    for body in [{'expected_revision': True, 'archived': True}, {'expected_revision': 0, 'archived': 'true'},
                 {'expected_revision': -1, 'archived': True}, {'expected_revision': 0, 'archived': True, 'title': 'edit'}]:
        assert (await client.put(path + '/archive', json=body)).status_code == 422
    assert (await client.delete(path)).status_code == 405


async def test_delayed_timeout_counts_by_recorded_submission_time(api, monkeypatch):
    from datetime import timedelta
    from tests.test_exams import setup_paper, paper, approve, start, ok, answers, S, exam_source
    from app.repositories import exam_repository as exams, learning_goal_repository as goals
    client, _, _ = api
    now = datetime(2030, 1, 1, tzinfo=timezone.utc)
    monkeypatch.setattr(exams, 'utc_now', lambda: now)
    monkeypatch.setattr(goals, 'utc_now', lambda: now)
    value = await paper(client, await setup_paper(client, monkeypatch))
    value = await ok(await approve(client, value))
    session = await ok(await start(client, value))
    goal = await create_goal(client, payload(source=exam_source('1'),
        due_at=(now + timedelta(seconds=120)).isoformat(), target_percent=10, min_distinct_questions=3))
    path = S + '/' + session['session_id']
    await ok(await client.put(path + '/answers', json={'expected_revision': 0, 'answer_records': answers(value)}))
    now += timedelta(seconds=130)
    before = (await detail(client, goal))['progress']
    assert before['deadline_passed'] and not before['criteria_met']
    result = (await ok(await client.post(path + '/submit', json={'expected_revision': 1, 'answer_records': []})))['result']
    assert result['submitted_at'] == session['deadline_at']
    assert result['finalized_at'] > goal['due_at']
    after = (await detail(client, goal))['progress']
    assert after['criteria_met'] and after['distinct_question_count'] == 3
