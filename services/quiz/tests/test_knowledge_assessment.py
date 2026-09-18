"""Assessment uses first trusted answers per exact content, without writes."""
from copy import deepcopy
import hashlib

import pytest
from app.core import db
from app.core.auth import create_token
from app.models.question_source import canonical
from app.repositories import quiz_repository as quizzes, user_repository as users
from tests.test_quiz_attempts import api, create, submit
from tests.test_question_bank import data, ROOT
from tests.test_question_sources import source, managed
from tests.test_knowledge_stats import bind

ASSESSMENT = ROOT + '/knowledge-assessment'


def query(snapshot=None):
    snapshot = snapshot or source()
    return {k: snapshot[k] for k in ('knowledge_point_id', 'content_version')}


async def assess(client, snapshot=None):
    response = await client.get(ASSESSMENT, params=query(snapshot))
    assert response.status_code == 200, response.text
    return response.json()['data']


async def record(client, body, key, correct=False):
    answers = deepcopy(body)
    answers['answer_records'][2]['selected_answers'] = ['B'] if correct else ['A']
    attempt = await create(client, body, key)
    response = await submit(client, attempt, answers)
    assert response.status_code == 200, response.text
    return attempt


async def copied_entry(client, uid, body, suffix, new_content=False):
    copied = deepcopy(body)
    copied['quiz_id'] = 'quiz_assess_' + suffix
    for question in copied['questions']:
        question['id'] += suffix
        question['knowledge_point'] = 'different label'
        question['explanation'] += 'different explanation'
        question['options'].reverse()
        question['answer'].reverse()
        if new_content:
            question['stem'] += suffix
    for answer in copied['answer_records']:
        answer['question_id'] += suffix
    await quizzes.save_quiz_session(copied['quiz_id'], uid, 'different title', '', '', copied['questions'])
    entry = next(e for e in (await data(client, quiz_id=copied['quiz_id']))['items']
                 if e['question_id'] == 'q3' + suffix)
    return copied, entry


@pytest.mark.parametrize('values, expected', [
    ([], 0), ([True], .5), ([False], 0), ([True, True], .8),
    ([False, True], 1 / 1.95), ([True, False], .95 / 1.95),
    ([True] * 3, 1), ([False] * 7, 0),
    ([False, True, False, True, False, True], (0.5 + .85 + 1) / 4),
])
def test_upstream_weighting_and_small_sample_caps(values, expected):
    from app.services.evidence_scoring import compute_evidence_score
    assert compute_evidence_score(values) == pytest.approx(expected)


@pytest.mark.asyncio
async def test_empty_zero_and_retries_keep_first_evidence(api, monkeypatch):
    client, uid, body = api
    managed(client, monkeypatch)
    empty = await assess(client)
    assert empty == dict(query(), policy_version='distinct_first_v1', source=None,
        answer_count=0, distinct_question_count=0, repeated_answer_count=0,
        first_accuracy=None, latest_accuracy=None, evidence_score=None,
        window_count=0, window_limit=5, small_sample_cap=None,
        evidence_state='no_evidence', basis=[])
    entry = next(e for e in (await data(client))['items'] if e['question_id'] == 'q3')
    await bind(client, entry, source())
    first = await record(client, body, 'wrong-first')
    for i in range(9):
        await record(client, body, f'retry-{i}', True)
    result = await assess(client)
    assert result['answer_count'] == 10
    assert result['distinct_question_count'] == result['window_count'] == 1
    assert result['repeated_answer_count'] == 9
    assert result['first_accuracy'] == result['evidence_score'] == 0
    assert result['latest_accuracy'] == 100
    assert result['small_sample_cap'] == .5 and result['evidence_state'] == 'limited_evidence'
    assert result['basis'][0]['attempt_id'] == first['attempt_id']
    assert set(result['basis'][0]) == {'question_content_key', 'entry_id', 'attempt_id', 'is_correct', 'submitted_at'}
    assert result['source'] == {k: v for k, v in source().items() if k != 'evidence'}
    await db.close_db()
    await db.init_db()
    assert await assess(client) == result


@pytest.mark.asyncio
async def test_correct_copies_count_once_and_reads_do_not_write(api, monkeypatch):
    client, uid, body = api
    managed(client, monkeypatch)
    entry = next(e for e in (await data(client))['items'] if e['question_id'] == 'q3')
    await bind(client, entry, source())
    first = await record(client, body, 'first', True)
    for i in range(9):
        copied, entry = await copied_entry(client, uid, body, str(i))
        await bind(client, entry, source('2'))
        await record(client, copied, f'copy-{i}', True)
    with db.transaction() as cur:
        before = cur.connection.total_changes
    result = await assess(client)
    assert result['answer_count'] == 10 and result['distinct_question_count'] == 1
    assert result['evidence_score'] == .5 and result['basis'][0]['attempt_id'] == first['attempt_id']
    assert result['source']['course_id'] == source('2')['course_id']
    assert 'mastered' not in result
    with db.transaction() as cur:
        assert cur.connection.total_changes == before


@pytest.mark.asyncio
async def test_last_five_first_contents_use_committed_order_not_wall_clock(api, monkeypatch):
    client, uid, body = api
    managed(client, monkeypatch)
    attempts = []
    for i, correct in enumerate([False, True, False, True, False, True]):
        copied, entry = await copied_entry(client, uid, body, str(i), True)
        await bind(client, entry, source())
        attempts.append(await record(client, copied, f'unique-{i}', correct))
        if i == 0:
            oldest_body = copied
        if i == 1:
            two = await assess(client)
            assert two['small_sample_cap'] == .8
            assert two['evidence_score'] == round(1 / 1.95, 6)
        if i == 2:
            assert (await assess(client))['evidence_state'] == 'available'
    # Later repeated content changes latest accuracy but not first-evidence order.
    await record(client, oldest_body, 'old-again', True)
    with db.transaction() as cur:
        cur.execute("UPDATE quiz_attempts SET submitted_at='2026-09-18 00:00:00'")
        cur.execute("UPDATE quiz_attempts SET submitted_at='2025-01-01 00:00:00' WHERE attempt_id=?", (attempts[-1]['attempt_id'],))
    result = await assess(client)
    assert result['distinct_question_count'] == 6 and result['window_count'] == 5
    assert result['answer_count'] == 7 and result['repeated_answer_count'] == 1
    assert result['evidence_score'] == .5875 and result['small_sample_cap'] == 1
    assert result['first_accuracy'] == 50 and result['latest_accuracy'] == 66.67
    assert [b['attempt_id'] for b in result['basis']] == [a['attempt_id'] for a in attempts[1:]]
    weights = [.5, .7, .85, .95, 1]
    assert result['evidence_score'] == round(sum(w * b['is_correct'] for w, b in zip(weights, result['basis'])) / sum(weights), 6)


@pytest.mark.asyncio
async def test_owner_versions_source_changes_and_untrusted_rows(api, monkeypatch):
    client, uid, body = api
    managed(client, monkeypatch)
    # Free labels/unattributed answers and drafts cannot provide evidence.
    await record(client, body, 'before-binding', True)
    entry = next(e for e in (await data(client))['items'] if e['question_id'] == 'q3')
    await bind(client, entry, source())
    await create(client, body, 'draft')
    assert (await assess(client))['evidence_score'] is None
    old = await record(client, body, 'old-version', True)
    original = await assess(client)
    newer = source() | {'statement': 'another version'}
    newer['content_version'] = hashlib.sha256(canonical({k: newer[k] for k in
        ('knowledge_point_id', 'type', 'title', 'statement', 'evidence')}).encode()).hexdigest()
    await bind(client, entry, newer, 1)
    current = await record(client, body, 'new-version')
    await bind(client, entry, None, 2)
    assert await assess(client) == original
    assert (await assess(client, newer))['evidence_score'] == 0
    token = client.headers['authorization']
    other = await users.create_user('assessment-other')
    client.headers['authorization'] = 'Bearer ' + create_token(other['id'], 'assessment-other')
    assert (await assess(client))['evidence_score'] is None
    client.headers['authorization'] = token
    with db.transaction() as cur:
        cur.execute("UPDATE quiz_attempts SET legacy_records_json='[]' WHERE attempt_id=?", (old['attempt_id'],))
        cur.execute('UPDATE question_bank_attempts SET source_revision=0 WHERE attempt_id=?', (current['attempt_id'],))
    assert (await assess(client))['evidence_score'] is None
    assert (await assess(client, newer))['evidence_score'] is None
    del client.headers['authorization']
    assert (await client.get(ASSESSMENT, params=query())).status_code == 401


@pytest.mark.asyncio
@pytest.mark.parametrize('params', [
    {}, {'knowledge_point_id': source()['knowledge_point_id']},
    query() | {'knowledge_point_id': 'bad'}, query() | {'content_version': 'x'},
    query() | {'page': 1}, query() | {'page_size': 1}, query() | {'user_id': 1},
    list(query().items()) + [('content_version', source()['content_version'])],
])
async def test_query_is_exact_and_read_only(api, params):
    client, _, _ = api
    assert (await client.get(ASSESSMENT, params=params)).status_code == 422
    assert (await client.post(ASSESSMENT, params=query(), json={})).status_code == 405
