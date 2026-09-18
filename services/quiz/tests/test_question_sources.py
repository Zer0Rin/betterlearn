"""Owned, explicit Core source snapshots: no real model or daily home."""
import hashlib
import json
import pytest
from app.core.config import get_settings
from app.core import db
from tests.test_question_bank import data, ROOT
from tests.test_quiz_attempts import api, create, submit

pytestmark = pytest.mark.asyncio


def source(unit='1'):
    content = {'knowledge_point_id': 'kp_' + '1' * 20, 'type': 'concept',
               'title': '来源', 'statement': '冻结陈述',
               'evidence': {'kind': 'summary', 'text': '无证据'}}
    version = hashlib.sha256(json.dumps(content, sort_keys=True, ensure_ascii=False,
                                       separators=(',', ':')).encode()).hexdigest()
    return dict(content, schema_version=1, course_id='course_' + unit * 20,
                unit_id='unit_' + unit * 20, content_version=version)


def managed(client, monkeypatch):
    monkeypatch.setattr(get_settings(), 'managed_host_token', 'source-test-host')
    client.headers['x-betterlearn-host'] = 'source-test-host'


async def test_source_binding_history_replay_and_unlink(api, monkeypatch):
    client, uid, body = api
    managed(client, monkeypatch)
    entry = (await data(client))['items'][0]
    path = f"{ROOT}/entries/{entry['id']}/source"
    payload = {'expected_revision': 0, 'source': source()}
    response = await client.put(path, json=payload)
    assert response.status_code == 200, response.text
    assert response.json()['data']['source_revision'] == 1
    assert (await client.put(path, json=payload)).json() == response.json()
    attempt = await create(client, body)
    await submit(client, attempt, body)
    assert (await client.put(path, json={'expected_revision': 1, 'source': None})).status_code == 200
    await submit(client, attempt, body)
    history = await data(client, f"/entries/{entry['id']}/history")
    assert history['items'][0]['source'] == source()
    assert history['items'][0]['source_revision'] == 1
    assert (await client.get(path)).json()['data'] == {'source': None, 'source_revision': 2}
    assert (await data(client, f"/entries/{entry['id']}"))['source'] is None
    assert (await client.put(path, json=payload)).status_code == 409
    second = await create(client, body, 'next')
    await submit(client, second, body)
    history = await data(client, f"/entries/{entry['id']}/history")
    assert history['items'][0]['source'] is None
    assert history['items'][0]['source_revision'] == 2
    await db.close_db()
    await db.init_db()
    assert (await client.get(path)).json()['data']['source_revision'] == 2
    assert (await data(client, f"/entries/{entry['id']}/history")) == history


async def test_source_write_requires_managed_host_and_valid_snapshot(api, monkeypatch):
    client, uid, body = api
    eid = (await data(client))['items'][0]['id']
    path = f'{ROOT}/entries/{eid}/source'
    payload = {'expected_revision': 0, 'source': source()}
    assert (await client.put(path, json=payload)).status_code == 403
    managed(client, monkeypatch)
    for invalid in [payload | {'expected_revision': True},
                    payload | {'source': source() | {'content_version': '0' * 64}},
                    payload | {'source': source() | {'is_correct': True}},
                    payload | {'extra': True}]:
        assert (await client.put(path, json=invalid)).status_code == 422
    assert (await client.put(path, json=payload)).status_code == 200


async def test_source_owner_versions_and_no_retroactive_attribution(api, monkeypatch):
    from copy import deepcopy
    from app.core.auth import create_token
    from app.repositories import user_repository as users, quiz_repository as quizzes
    client, uid, body = api
    managed(client, monkeypatch)
    old_attempt = await create(client, body)
    await submit(client, old_attempt, body)
    entry = (await data(client))['items'][0]
    path = f"{ROOT}/entries/{entry['id']}/source"
    payload = {'expected_revision': 0, 'source': source()}
    assert (await client.put(path, json=payload)).status_code == 200
    old = (await data(client, f"/entries/{entry['id']}/history"))['items'][0]
    assert old['source'] is None and old['source_revision'] == 0
    # Same free-text label and ID, changed question content: independent mapping.
    questions = deepcopy(body['questions'])
    next(q for q in questions if q['id'] == entry['question_id'])['stem'] += '新版'
    from app.services.question_bank_projection import index_questions
    with db.transaction() as cur:
        index_questions(cur, body['quiz_id'], uid, body['topic'], questions)
    versions = [e for e in (await data(client))['items'] if e['question_id'] == entry['question_id']]
    assert len(versions) == 2
    assert next(e for e in versions if e['id'] != entry['id'])['source'] is None
    other = await users.create_user('source-other')
    token = client.headers['authorization']
    client.headers['authorization'] = 'Bearer ' + create_token(other['id'], 'source-other')
    assert (await client.get(path)).status_code == 404
    assert (await client.put(path, json=payload)).status_code == 404
    client.headers['authorization'] = token
    assert (await client.get(path)).json()['data']['source'] == source()


async def test_source_concurrent_writes_and_submission_rollback(api, monkeypatch):
    import asyncio
    from app.models.question_source import SourceUpdate
    from app.repositories.question_source_repository import update_source
    from app.core.exceptions import BankError
    client, uid, body = api
    managed(client, monkeypatch)
    entry = (await data(client))['items'][0]
    eid = entry['id']
    # Two actual DB worker threads, both expect revision zero.
    async def contender(unit):
        return await asyncio.to_thread(lambda: asyncio.run(update_source(uid, eid,
            SourceUpdate(expected_revision=0, source=source(unit)))))
    results = await asyncio.gather(contender('1'), contender('2'), return_exceptions=True)
    assert sum(isinstance(r, dict) for r in results) == 1
    assert sum(isinstance(r, BankError) for r in results) == 1
    attempt = await create(client, body)
    with db.transaction() as cur:
        cur.execute("CREATE TRIGGER source_fail BEFORE INSERT ON question_bank_attempts BEGIN SELECT RAISE(ABORT,'source failure'); END")
    import sqlite3
    with pytest.raises(sqlite3.IntegrityError, match='source failure'):
        await submit(client, attempt, body)
    assert (await data(client, f'/entries/{eid}/history'))['total'] == 0
    with db.transaction() as cur:
        assert cur.execute('SELECT total_xp FROM users WHERE id=?', (uid,)).fetchone()[0] == 0
        assert cur.execute('SELECT status FROM quiz_attempts WHERE attempt_id=?', (attempt['attempt_id'],)).fetchone()[0] == 'draft'
        cur.execute('DROP TRIGGER source_fail')
    assert (await submit(client, attempt, body)).status_code == 200
    winner = next(r for r in results if isinstance(r, dict))
    assert (await data(client, f'/entries/{eid}/history'))['items'][0]['source'] == winner['source']


async def test_cross_language_source_contract():
    from pathlib import Path
    from app.models.question_source import CoreSource
    snapshot = json.loads((Path(__file__).resolve().parents[3] / 'contracts/quiz-source-v1.json').read_text())
    assert CoreSource.model_validate(snapshot).model_dump() == snapshot
