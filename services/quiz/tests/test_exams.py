"""Self-exams use temporary SQLite, server time, frozen bank questions and fake reports."""
import asyncio
import hashlib
from datetime import datetime, timedelta, timezone
import uuid

import pytest
from app.core import db
from app.models.question_source import canonical
from app.core.auth import create_token
from app.repositories import user_repository as users
from tests.test_quiz_attempts import api, model
from tests.test_question_sources import source, managed
from tests.test_knowledge_stats import bind

pytestmark = pytest.mark.asyncio
P = '/api/v1/exam-papers'
S = '/api/v1/exam-sessions'


def exam_source(n):
    value = source(n) | {'knowledge_point_id': 'kp_' + n * 20}
    content = {k: value[k] for k in ('knowledge_point_id', 'type', 'title', 'statement', 'evidence')}
    value['content_version'] = hashlib.sha256(canonical(content).encode()).hexdigest()
    return value


async def setup_paper(client, monkeypatch):
    managed(client, monkeypatch)
    entries = (await client.get('/api/v1/question-bank/entries?sort=oldest')).json()['data']['items']
    for i, entry in enumerate(entries):
        await bind(client, entry, exam_source('1' if i < 3 else '2'))
    return dict(request_id=str(uuid.uuid4()), title='综合自测', duration_seconds=60,
                allocations=[dict(knowledge_point_id=exam_source(n)['knowledge_point_id'],
                                  content_version=exam_source(n)['content_version'], count=count)
                             for n, count in [('1', 3), ('2', 2)]])


async def ok(response):
    assert response.status_code == 200, response.text
    return response.json()['data']


async def paper(client, payload):
    return await ok(await client.post(P, json=payload))


async def approve(client, value, approved=True, revision=0):
    return await client.put(P + '/' + value['paper_id'] + '/review', json={
        'expected_revision': revision, 'reviews': [dict(question_id=q['question']['id'],
            approved=approved, note='已核对来源') for q in value['items']]})


async def start(client, value, request_id=None):
    return await client.post(P + '/' + value['paper_id'] + '/sessions', json={
        'request_id': request_id or str(uuid.uuid4()), 'expected_revision': value['revision']})


def answers(value):
    return [dict(question_id=i['question']['id'], selected_answers=i['question']['answer'], duration_ms=100)
            for i in value['items']]


async def test_preview_review_freezing_idempotency_and_isolation(api, monkeypatch):
    client, uid, body = api
    payload = await setup_paper(client, monkeypatch)
    with db.transaction() as cur:
        before = cur.connection.total_changes
    preview = await ok(await client.post(P + '/preview', json={k: v for k, v in payload.items() if k != 'request_id'}))
    assert preview['ready'] is True and preview['total_questions'] == 5
    with db.transaction() as cur:
        assert cur.connection.total_changes == before
    a, b = await asyncio.gather(paper(client, payload), paper(client, payload))
    assert a == b and a['revision'] == 0 and a['status'] == 'draft'
    assert (await start(client, a)).status_code == 409
    assert (await client.post(P, json=payload | {'title': 'changed'})).status_code == 409
    rejected = await ok(await approve(client, a, False))
    assert rejected['status'] == 'draft'
    reviewed = await ok(await approve(client, a, revision=1))
    assert reviewed['status'] == 'approved' and reviewed['revision'] == 2
    assert await ok(await approve(client, a, revision=1)) == reviewed
    assert (await approve(client, a)).status_code == 409
    # Frozen version survives source reassignment.
    with db.transaction() as cur:
        cur.execute('DELETE FROM question_bank_sources')
    assert await paper(client, payload) == reviewed
    assert await ok(await client.get(P + '/' + a['paper_id'])) == reviewed
    key = str(uuid.uuid4())
    first, replay = await asyncio.gather(start(client, reviewed, key), start(client, reviewed, key))
    assert (await ok(first)) == (await ok(replay))
    assert (await approve(client, a, revision=2)).status_code == 409
    other = (await users.create_user('exam-other'))['id']
    headers = {'authorization': 'Bearer ' + create_token(other, 'exam-other')}
    assert (await client.get(P + '/' + a['paper_id'], headers=headers)).status_code == 404
    assert (await client.get(S + '/' + first.json()['data']['session_id'], headers=headers)).status_code == 404


async def test_submission_hidden_answers_report_and_history(api, monkeypatch, model):
    client, uid, body = api
    p = await paper(client, await setup_paper(client, monkeypatch))
    p = await ok(await approve(client, p))
    session = await ok(await start(client, p))
    path = S + '/' + session['session_id']
    assert session['status'] == 'running' and session['result'] is None
    assert all(set(q) <= {'id', 'type', 'stem', 'options', 'image_url'} for q in session['questions'])
    assert 'attempt_id' not in session and 'quiz_id' not in session
    response = await client.put(path + '/answers', json={'expected_revision': 0, 'answer_records': answers(p)[:2]})
    draft = await ok(response)
    assert draft['revision'] == 1 and all('is_correct' not in a for a in draft['answer_records'])
    assert await ok(await client.put(path + '/answers', json={'expected_revision': 0, 'answer_records': answers(p)[:2]})) == draft
    assert (await client.put(path + '/answers', json={'expected_revision': 0, 'answer_records': []})).status_code == 409
    submit = {'expected_revision': 1, 'answer_records': answers(p)[:4]}
    results = await asyncio.gather(*(client.post(path + '/submit', json=submit) for _ in range(3)))
    final = await ok(results[0])
    assert [await ok(r) for r in results] == [final] * len(results)
    assert final['status'] == 'submitted' and final['result']['accuracy'] == 80
    assert final['result']['correct_count'] == 4 and final['result']['unanswered_count'] == 1
    assert [g['accuracy'] for g in final['result']['by_source']] == [100, 50]
    assert (await client.post(path + '/submit', json=submit | {'answer_records': answers(p)})).status_code == 409
    assert (await users.get_user_by_id(uid))['total_xp'] == 0
    model.assert_not_awaited()
    attempt = final['result']['attempt_id']
    model.side_effect = RuntimeError('private provider failure')
    assert (await client.post('/api/v1/quiz/attempts/' + attempt + '/report', json={})).status_code == 500
    assert (await ok(await client.get(path)))['result'] == final['result']
    model.side_effect = None
    report = await ok(await client.post('/api/v1/quiz/attempts/' + attempt + '/report', json={}))
    assert report['accuracy'] == 80
    stats = await ok(await client.get('/api/v1/question-bank/knowledge-stats'))
    assert sum(g['answer_count'] for g in stats['items']) == 4
    await db.close_db()
    await db.init_db()
    assert await ok(await client.get(path)) == final


async def test_deadline_uses_saved_answers_and_restart_does_not_extend(api, monkeypatch):
    from app.repositories import exam_repository as exams
    client, uid, body = api
    now = datetime(2030, 1, 1, tzinfo=timezone.utc)
    monkeypatch.setattr(exams, 'utc_now', lambda: now)
    p = await paper(client, await setup_paper(client, monkeypatch))
    p = await ok(await approve(client, p))
    value = await ok(await start(client, p))
    path = S + '/' + value['session_id']
    await ok(await client.put(path + '/answers', json={'expected_revision': 0, 'answer_records': answers(p)[:1]}))
    now += timedelta(seconds=60)
    await db.close_db()
    await db.init_db()
    expired = await ok(await client.get(path))
    assert expired['status'] == 'expired' and expired['deadline_at'] == value['deadline_at']
    assert (await client.put(path + '/answers', json={'expected_revision': 1, 'answer_records': answers(p)})).status_code == 409
    final = await ok(await client.post(path + '/submit', json={'expected_revision': 0, 'answer_records': answers(p)}))
    assert final['result']['reason'] == 'timeout' and final['result']['accuracy'] == 20
    assert await ok(await client.post(path + '/submit', json={'expected_revision': 0, 'answer_records': []})) == final


async def test_shortage_preview_duplicate_content_invalid_keys_and_no_partial_creation(api, monkeypatch):
    from app.repositories import quiz_repository as quizzes
    from copy import deepcopy
    client, uid, body = api
    payload = await setup_paper(client, monkeypatch)
    # Duplicate copies cannot satisfy extra quota.
    await quizzes.save_quiz_session('copy', uid, 'copy', '', '', body['questions'])
    entries = (await client.get('/api/v1/question-bank/entries?quiz_id=copy')).json()['data']['items']
    for entry in entries:
        await bind(client, entry, exam_source('1'))
    shortage = deepcopy(payload)
    shortage['allocations'][0]['count'] = 4
    preview = await ok(await client.post(P + '/preview', json={k:v for k,v in shortage.items() if k != 'request_id'}))
    assert preview['ready'] is False and sum(c['missing'] for c in preview['coverage']) == 1
    assert (await client.post(P, json=shortage)).status_code == 409
    assert (await ok(await client.get(P)))['total'] == 0
    # Invalid answer keys are excluded rather than allowed to break finalization.
    with db.transaction() as cur:
        cur.execute("UPDATE question_bank_entries SET question_json=json_set(question_json,'$.answer',json('[\"Z\"]'))")
    preview = await ok(await client.post(P + '/preview', json={k:v for k,v in payload.items() if k != 'request_id'}))
    assert preview['ready'] is False and all(c['selected'] == 0 for c in preview['coverage'])
    assert sum(c['invalid_count'] for c in preview['coverage']) == 10


async def test_allocation_backtracks_when_two_sources_share_only_candidate(api, monkeypatch):
    from app.repositories import quiz_repository as quizzes
    client, uid, body = api
    payload = await setup_paper(client, monkeypatch)
    # Source 1 offers q1,q2,q3; source 2 offers only a copy of q1. A greedy
    # assignment to source 1 must be displaced to fulfill source 2's slot.
    with db.transaction() as cur:
        cur.execute("DELETE FROM question_bank_sources WHERE json_extract(source_json,'$.knowledge_point_id')=?", (exam_source('2')['knowledge_point_id'],))
    await quizzes.save_quiz_session('shared', uid, 'shared', '', '', body['questions'][:1])
    entry = (await client.get('/api/v1/question-bank/entries?quiz_id=shared')).json()['data']['items'][0]
    await bind(client, entry, exam_source('2'))
    for allocation in payload['allocations']:
        allocation['count'] = 1
    value = await paper(client, payload)
    assert value['items'][0]['question']['stem'] != value['items'][1]['question']['stem']
    assert value['items'][1]['question']['stem'] == body['questions'][0]['stem']


@pytest.mark.parametrize('change', [
    {'title': ' '}, {'duration_seconds': True}, {'duration_seconds': 59}, {'duration_seconds': 14401},
    {'request_id': 'not-a-uuid'}, {'user_id': 2}, {'source': {}}, {'allocations': []},
])
async def test_strict_creation_rejects_invalid_or_injected_fields(api, monkeypatch, change):
    client, uid, body = api
    payload = await setup_paper(client, monkeypatch)
    assert (await client.post(P, json=payload | change)).status_code == 422


async def test_answer_validation_empty_multi_select_and_atomic_projection(api, monkeypatch):
    from app.services import exam_result
    client, uid, body = api
    p = await paper(client, await setup_paper(client, monkeypatch))
    p = await ok(await approve(client, p))
    session = await ok(await start(client, p))
    path = S + '/' + session['session_id']
    valid = answers(p)
    for invalid in [valid + [valid[0]], [valid[0] | {'question_id': 'q99'}],
                    [valid[0] | {'selected_answers': ['Z']}], [valid[0] | {'selected_answers': ['A', 'A']}],
                    [valid[0] | {'is_correct': True}], [valid[0] | {'duration_ms': -1}]]:
        assert (await client.put(path + '/answers', json={'expected_revision': 0, 'answer_records': invalid})).status_code == 422
    original = exam_result.persist
    def fail(*args):
        original(*args)
        raise RuntimeError('injected rollback')
    monkeypatch.setattr(exam_result, 'persist', fail)
    request = {'expected_revision': 0, 'answer_records': valid}
    with pytest.raises(RuntimeError):
        await client.post(path + '/submit', json=request)
    assert (await ok(await client.get(path)))['status'] == 'running'
    with db.transaction() as cur:
        assert cur.execute('SELECT COUNT(*) FROM quiz_attempts').fetchone()[0] == 0
        assert cur.execute('SELECT COUNT(*) FROM quiz_sessions').fetchone()[0] == 1
    monkeypatch.setattr(exam_result, 'persist', original)
    # Unordered multiple choice is correct; explicit empty equals unanswered.
    multiple = next(i for i, q in enumerate(p['items']) if q['question']['type'] == 'multiple')
    valid[multiple]['selected_answers'].reverse()
    empty = next(i for i in range(5) if i != multiple)
    valid[empty]['selected_answers'] = []
    result = (await ok(await client.post(path + '/submit', json=request)))['result']
    assert result['accuracy'] == 80 and result['unanswered_count'] == 1
    with db.transaction() as cur:
        assert cur.execute('SELECT COUNT(*) FROM quiz_attempts').fetchone()[0] == 1
        assert cur.execute('SELECT COUNT(*) FROM question_bank_attempts').fetchone()[0] == 5


async def test_queries_reviews_and_concurrent_writes_are_bounded(api, monkeypatch):
    client, uid, body = api
    payload = await setup_paper(client, monkeypatch)
    p = await paper(client, payload)
    for query in ['?page=0', '?page=1&page=2', '?user_id=1', '?page_size=101', '?page=1.0']:
        assert (await client.get(P + query)).status_code == 422
    assert (await client.get(P + '/' + p['paper_id'] + '?page=1')).status_code == 422
    assert (await client.put(P + '/' + p['paper_id'] + '/review', json={'expected_revision': 0, 'reviews': []})).status_code == 422
    assert (await client.put(P + '/' + p['paper_id'] + '/review', json={'expected_revision': 0, 'reviews': [dict(question_id='q1', approved=True)] * 5})).status_code == 422
    p = await ok(await approve(client, p))
    key = str(uuid.uuid4())
    session = await ok(await start(client, p, key))
    p2 = await paper(client, payload | {'request_id': str(uuid.uuid4())})
    p2 = await ok(await approve(client, p2))
    assert (await start(client, p2, key)).status_code == 409
    path = S + '/' + session['session_id']
    results = await asyncio.gather(*(client.put(path + '/answers', json={'expected_revision': 0, 'answer_records': answers(p)[:i]}) for i in (1, 2)))
    assert sorted(r.status_code for r in results) == [200, 409]
    listing = await ok(await client.get(S + '?page=1&page_size=1'))
    assert listing['total'] == 1 and 'questions' not in listing['items'][0]


async def test_blank_answer_key_is_not_a_usable_exam_candidate(api, monkeypatch):
    client, uid, body = api
    payload = await setup_paper(client, monkeypatch)
    with db.transaction() as cur:
        cur.execute('''UPDATE question_bank_entries SET question_json=json_set(question_json,
            '$.options',json('[{"key":" ","text":"bad"}]'),'$.answer',json('[" "]'))''')
    preview = await ok(await client.post(P + '/preview', json={k:v for k,v in payload.items() if k != 'request_id'}))
    assert preview['ready'] is False and sum(c['selected'] for c in preview['coverage']) == 0


async def test_large_frozen_snapshots_reject_before_invisible_partial_creation(api, monkeypatch):
    from app.repositories import exam_paper_repository as papers
    client, uid, body = api
    payload = await setup_paper(client, monkeypatch)
    monkeypatch.setattr(papers, 'MAX_SNAPSHOT_BYTES', 1024, raising=False)
    assert (await client.post(P + '/preview', json={k:v for k,v in payload.items() if k != 'request_id'})).status_code == 422
    assert (await client.post(P, json=payload)).status_code == 422
    assert (await ok(await client.get(P)))['total'] == 0


async def test_exam_projection_opens_history_detail_without_optional_summary(api, monkeypatch):
    client, uid, body = api
    created = await paper(client, await setup_paper(client, monkeypatch))
    approved = await ok(await approve(client, created))
    session = await ok(await start(client, approved))
    submitted = await ok(await client.post(S + '/' + session['session_id'] + '/submit', json={
        'expected_revision': 0, 'answer_records': answers(approved)}))
    detail = await ok(await client.get('/api/v1/user/quizzes/' + submitted['result']['quiz_id']))
    assert detail['summary'] == ''
    assert len(detail['questions']) == 5


@pytest.mark.parametrize('explicit_empty', [False, True])
async def test_unanswered_preserves_exam_grade_and_bank_but_not_learning_evidence(api, monkeypatch, explicit_empty):
    from tests.test_learning_goals import payload, create_goal, detail
    client, uid, _ = api
    p = await paper(client, await setup_paper(client, monkeypatch))
    p = await ok(await approve(client, p))
    session = await ok(await start(client, p))
    records = answers(p)
    if explicit_empty:
        for record in records[1:]:
            record['selected_answers'] = []
    else:
        records = records[:1]
    request = {'expected_revision': 0, 'answer_records': records}
    path = S + '/' + session['session_id'] + '/submit'
    final = await ok(await client.post(path, json=request))
    assert final['result']['unanswered_count'] == 4
    assert final['result']['accuracy'] == 20
    assert await ok(await client.post(path, json=request)) == final
    # Keep old full projections, including explicit clearing, and reopen them.
    with db.transaction() as cur:
        assert cur.execute('SELECT COUNT(*) FROM question_bank_attempts').fetchone()[0] == 5
    await db.close_db()
    await db.init_db()
    stats = await ok(await client.get('/api/v1/question-bank/knowledge-stats'))
    assert sum(s['answer_count'] for s in stats['items']) == 1
    assert sum(s['distinct_question_count'] for s in stats['items']) == 1
    scope = {k: exam_source('1')[k] for k in ['knowledge_point_id', 'content_version']}
    evidence = await ok(await client.get('/api/v1/question-bank/knowledge-assessment', params=scope))
    assert evidence['answer_count'] == evidence['distinct_question_count'] == len(evidence['basis']) == 1
    history = await ok(await client.get('/api/v1/question-bank/knowledge-stats/history', params=scope))
    assert history['total'] == 1
    goal = await create_goal(client, payload(source=exam_source('1'), target_percent=10, min_distinct_questions=3))
    progress = (await detail(client, goal))['progress']
    assert progress['distinct_question_count'] == 1 and not progress['criteria_met']
