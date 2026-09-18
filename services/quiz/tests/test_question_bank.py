"""Question bank API against real temporary SQLite, with no provider calls."""
from copy import deepcopy
import json

import pytest
from app.core import db
from app.core.auth import create_token
from app.repositories import quiz_repository as quizzes, user_repository as users
from tests.test_quiz_attempts import api, create, submit, model

pytestmark = pytest.mark.asyncio
ROOT = '/api/v1/question-bank'


async def data(client, path='/entries', **params):
    response = await client.get(ROOT + path, params=params)
    assert response.status_code == 200, response.text
    return response.json()['data']


async def test_unanswered_wrong_corrected_and_history(api, model):
    client, uid, body = api
    entries = await data(client)
    assert entries['total'] == 5
    assert all(e['is_correct'] is None for e in entries['items'])
    assert (await data(client, '/stats'))['wrong'] == 0
    attempt = await create(client, body)
    assert (await submit(client, attempt, body)).status_code == 200
    assert (await submit(client, attempt, body)).status_code == 200
    wrong = await data(client, scope='wrong')
    assert wrong['total'] == 1
    entry = wrong['items'][0]
    assert entry['question']['id'] == 'q3' and entry['wrong_count'] == entry['attempt_count'] == 1
    model.side_effect = RuntimeError('failed')
    await client.post(f"/api/v1/quiz/attempts/{attempt['attempt_id']}/report", json={})
    assert (await data(client, scope='wrong'))['total'] == 1
    changed = deepcopy(body)
    changed['answer_records'][2]['selected_answers'] = ['B']
    second = await create(client, body, 'second')
    await submit(client, second, changed)
    assert (await data(client, scope='wrong'))['total'] == 0
    ever = await data(client, scope='ever_wrong')
    assert ever['total'] == 1 and ever['items'][0]['is_correct'] is True
    history = await data(client, f"/entries/{entry['id']}/history", page_size=1)
    assert history['total'] == 2 and history['items'][0]['attempt_id'] == second['attempt_id']
    assert (await data(client, '/stats'))['ever_wrong'] == 1
    third = await create(client, body, 'third')
    await submit(client, third, body)
    entry = (await data(client, scope='wrong'))['items'][0]
    assert entry['attempt_count'] == 3 and entry['wrong_count'] == 2
    assert (await users.get_user_by_id(uid))['total_xp'] == 18


async def test_bookmarks_categories_search_and_pagination(api):
    client, uid, body = api
    entries = await data(client, page_size=2, sort='oldest')
    page2 = await data(client, page_size=2, page=2, sort='oldest')
    assert entries['total'] == page2['total'] == 5
    assert not {e['id'] for e in entries['items']} & {e['id'] for e in page2['items']}
    eid = entries['items'][0]['id']
    assert (await client.put(f'{ROOT}/entries/{eid}', json={'bookmarked': True})).status_code == 200
    assert (await data(client, scope='bookmarked'))['total'] == 1
    result = await client.post(ROOT + '/categories', json={'name': '  Math  '})
    assert result.status_code == 200, result.text
    cid = result.json()['data']['id']
    assert (await client.post(ROOT + '/categories', json={'name': 'math'})).status_code == 409
    assert (await client.post(ROOT + '/categories', json={'name': '   '})).status_code == 422
    for _ in range(2):
        assert (await client.put(f'{ROOT}/entries/{eid}/categories/{cid}', json={})).status_code == 200
    assert (await data(client, category_id=cid))['total'] == 1
    assert (await data(client, scope='uncategorized'))['total'] == 4
    assert (await data(client, '/categories'))['items'][0]['entry_count'] == 1
    assert (await client.put(f'{ROOT}/categories/{cid}', json={'name': '数学'})).status_code == 200
    assert (await data(client, f'/entries/{eid}'))['categories'][0]['name'] == '数学'
    assert (await client.delete(f'{ROOT}/categories/{cid}')).status_code == 200
    assert (await data(client, scope='uncategorized'))['total'] == 5
    assert (await data(client, search='%'))['total'] == 0
    assert (await data(client, search='RAG'))['total'] == 5
    assert (await client.get(ROOT + '/entries', params={'page_size': 101})).status_code == 422
    assert (await client.put(f'{ROOT}/entries/{eid}', json={'is_correct': True})).status_code == 422
    await db.close_db()
    await db.init_db()
    assert (await data(client, scope='bookmarked'))['total'] == 1


async def test_versions_literal_search_and_owner_isolation(api):
    client, uid, body = api
    initial = await data(client)
    eid = initial['items'][0]['id']
    cid = (await client.post(ROOT + '/categories', json={'name': '私有'})).json()['data']['id']
    altered = deepcopy(body['questions'])
    altered[0]['stem'] = '50% a_b \\ literal'
    await quizzes.save_quiz_session('other-quiz', uid, 'other', '', '', altered)
    assert (await data(client, search='%'))['total'] == 1
    assert (await data(client, search='_'))['total'] == 1
    assert (await data(client, search='\\'))['total'] == 1
    assert (await data(client))['total'] == 10
    with db.transaction() as cur:
        cur.execute('UPDATE quiz_sessions SET questions_json=? WHERE quiz_id=?', (json.dumps(altered), body['quiz_id']))
    attempt = await create(client, body)
    await submit(client, attempt, body)
    assert (await data(client))['total'] == 11  # Only changed q1 gains another version.
    other = (await users.create_user('bank-outsider'))['id']
    client.headers['authorization'] = 'Bearer ' + create_token(other, 'bank-outsider')
    assert (await data(client))['total'] == 0 and (await data(client, '/stats'))['total'] == 0
    assert (await data(client, '/categories'))['items'] == []
    for method, path, payload in [
        ('GET', f'/entries/{eid}', None), ('GET', f'/entries/{eid}/history', None),
        ('PUT', f'/entries/{eid}', {'bookmarked': False}),
        ('PUT', f'/categories/{cid}', {'name': 'hijack'}), ('DELETE', f'/categories/{cid}', None),
        ('PUT', f'/entries/{eid}/categories/{cid}', {}), ('DELETE', f'/entries/{eid}/categories/{cid}', None),
    ]:
        assert (await client.request(method, ROOT + path, json=payload)).status_code == 404
    del client.headers['authorization']
    assert (await client.get(ROOT + '/entries')).status_code == 401


async def test_bank_projection_failure_rolls_back_submission(api):
    import sqlite3
    from app.repositories import attempt_repository as attempts
    from app.models.attempt import AttemptAnswer
    client, uid, body = api
    attempt = await create(client, body)
    with db.transaction() as cur:
        cur.execute("CREATE TRIGGER fail_bank BEFORE INSERT ON question_bank_attempts BEGIN SELECT RAISE(ABORT,'failure'); END")
    with pytest.raises(sqlite3.IntegrityError):
        await attempts.submit_attempt(attempt['attempt_id'], uid, 0,
                                      [AttemptAnswer.model_validate(a) for a in body['answer_records']])
    assert (await attempts.get_attempt(attempt['attempt_id'], uid))['status'] == 'draft'
    assert (await users.get_user_by_id(uid))['total_xp'] == 0
    assert (await data(client, '/stats'))['wrong'] == 0


async def test_category_cannot_link_to_other_users_entry_or_category(api):
    client, uid, body = api
    eid = (await data(client))['items'][0]['id']
    cid = (await client.post(ROOT + '/categories', json={'name': 'mine'})).json()['data']['id']
    other = (await users.create_user('other-bank'))['id']
    await quizzes.save_quiz_session('other-bank-quiz', other, 'Other', '', '', body['questions'])
    client.headers['authorization'] = 'Bearer ' + create_token(other, 'other-bank')
    other_entry = (await data(client))['items'][0]['id']
    other_category = (await client.post(ROOT + '/categories', json={'name': 'mine'})).json()['data']['id']
    assert (await client.put(f'{ROOT}/entries/{eid}/categories/{other_category}', json={})).status_code == 404
    assert (await client.put(f'{ROOT}/entries/{other_entry}/categories/{cid}', json={})).status_code == 404
    assert (await client.get(ROOT + '/entries', params={'category_id': cid})).status_code == 404


async def test_history_follows_submission_order_when_timestamps_tie(api):
    client, uid, body = api
    first = await create(client, body, 'first')
    second = await create(client, body, 'second')
    fixed = deepcopy(body)
    fixed['answer_records'][2]['selected_answers'] = ['B']
    await submit(client, second, fixed)
    await submit(client, first, body)  # Earlier-created attempt submits last.
    with db.transaction() as cur:
        cur.execute("UPDATE quiz_attempts SET submitted_at='2026-09-18 00:00:00.000'")
    entry = (await data(client, scope='wrong'))['items'][0]
    history = await data(client, f"/entries/{entry['id']}/history")
    assert history['items'][0]['attempt_id'] == entry['latest_attempt_id'] == first['attempt_id']


async def test_explicit_category_overrides_uncategorized_as_upstream(api):
    client, uid, body = api
    eid = (await data(client))['items'][0]['id']
    cid = (await client.post(ROOT + '/categories', json={'name': 'explicit'})).json()['data']['id']
    await client.put(f'{ROOT}/entries/{eid}/categories/{cid}', json={})
    result = await data(client, scope='uncategorized', category_id=cid)
    assert result['total'] == 1 and result['items'][0]['id'] == eid
