"""Knowledge statistics use committed source snapshots, never current mappings."""
from copy import deepcopy
import hashlib
import json
import pytest
from app.core import db
from app.models.question_source import canonical
from tests.test_quiz_attempts import api, create, submit
from tests.test_question_bank import data, ROOT
from tests.test_question_sources import source, managed

pytestmark = pytest.mark.asyncio
STATS = ROOT + '/knowledge-stats'


async def get_stats(client, **query):
    response = await client.get(STATS, params=query)
    assert response.status_code == 200, response.text
    return response.json()['data']


async def bind(client, entry, snapshot, revision=0):
    response = await client.put(f"{ROOT}/entries/{entry['id']}/source",
        json={'expected_revision': revision, 'source': snapshot})
    assert response.status_code == 200, response.text


async def test_frozen_stats_distinguish_retries_and_source_versions(api, monkeypatch):
    client, uid, body = api
    managed(client, monkeypatch)
    assert (await get_stats(client))['total'] == 0
    entry = next(e for e in (await data(client))['items'] if e['question_id'] == 'q3')
    original = source()
    await bind(client, entry, original)
    first = await create(client, body)
    await submit(client, first, body)
    await submit(client, first, body)
    changed = deepcopy(body)
    changed['answer_records'][2]['selected_answers'] = ['B']
    second = await create(client, body, 'second')
    await submit(client, second, changed)
    await bind(client, entry, None, 1)
    third = await create(client, body, 'unlinked')
    await submit(client, third, body)
    stats = await get_stats(client)
    assert stats['total'] == 1
    item = stats['items'][0]
    assert item['answer_count'] == 2 and item['correct_count'] == 1
    assert item['distinct_question_count'] == 1 and item['repeated_answer_count'] == 1
    assert item['accuracy'] == 50 and item['first_accuracy'] == 0 and item['latest_accuracy'] == 100
    assert item['attempt_count'] == 2 and item['entry_count'] == 1
    newer = original | {'statement': '新版本'}
    newer['content_version'] = hashlib.sha256(canonical({k: newer[k] for k in
        ('knowledge_point_id', 'type', 'title', 'statement', 'evidence')}).encode()).hexdigest()
    await bind(client, entry, newer, 2)
    fourth = await create(client, body, 'new-version')
    await submit(client, fourth, body)
    assert (await get_stats(client))['total'] == 2
    old = await get_stats(client, knowledge_point_id=original['knowledge_point_id'], content_version=original['content_version'])
    assert old['items'][0] == item
    history = await client.get(STATS + '/history', params={
        'knowledge_point_id': original['knowledge_point_id'], 'content_version': original['content_version'], 'page_size': 1})
    assert history.status_code == 200, history.text
    result = history.json()['data']
    assert result['total'] == 2 and result['items'][0]['attempt_id'] == second['attempt_id']
    assert result['items'][0]['source'] == {k: v for k, v in original.items() if k != 'evidence'} and result['items'][0]['is_correct'] is True


async def test_copied_questions_deduplicate_across_courses_and_quizzes(api, monkeypatch):
    from app.repositories import quiz_repository as quizzes
    client, uid, body = api
    managed(client, monkeypatch)
    base = next(e for e in (await data(client))['items'] if e['question_id'] == 'q3')
    await bind(client, base, source())
    first = await create(client, body)
    await submit(client, first, body)
    for suffix, changed_stem in [('copy', False), ('new', True)]:
        copied = deepcopy(body)
        copied['quiz_id'] = 'quiz_' + suffix
        for q in copied['questions']:
            q['id'] += suffix
            q['knowledge_point'] = '完全不同的自由标签'
            q['explanation'] += '讲解更新'
            q['options'].reverse()
            q['answer'].reverse()
            if changed_stem and q['id'] == 'q3' + suffix:
                q['stem'] += '另一个问题'
        for answer in copied['answer_records']:
            answer['question_id'] += suffix
            if answer['question_id'] == 'q3' + suffix:
                answer['selected_answers'] = ['B']
        await quizzes.save_quiz_session(copied['quiz_id'], uid, body['topic'], '', '', copied['questions'])
        entry = next(e for e in (await data(client, quiz_id=copied['quiz_id']))['items'] if e['question_id'] == 'q3' + suffix)
        await bind(client, entry, source('2'))
        attempt = await create(client, copied, suffix)
        await submit(client, attempt, copied)
    with db.transaction() as cur:
        cur.execute("UPDATE quiz_attempts SET submitted_at='2026-09-18 00:00:00'")
        before = cur.connection.total_changes
    stats = (await get_stats(client))['items'][0]
    assert stats['answer_count'] == 3 and stats['correct_count'] == 2
    assert stats['distinct_question_count'] == 2 and stats['repeated_answer_count'] == 1
    assert stats['entry_count'] == 3 and stats['attempt_count'] == 3
    assert stats['accuracy'] == 66.67 and stats['first_accuracy'] == 50 and stats['latest_accuracy'] == 100
    assert stats['source']['course_id'] == source('2')['course_id']
    history = (await client.get(STATS + '/history', params={
        'knowledge_point_id': source()['knowledge_point_id'], 'content_version': source()['content_version']})).json()['data']
    assert history['items'][1]['question_content_key'] == history['items'][2]['question_content_key']
    assert history['items'][0]['question_content_key'] != history['items'][1]['question_content_key']
    with db.transaction() as cur:
        assert cur.connection.total_changes == before


async def test_stats_owner_pagination_and_old_data_exclusion(api, monkeypatch):
    from app.core.auth import create_token
    from app.repositories import user_repository as users
    client, uid, body = api
    managed(client, monkeypatch)
    entries = (await data(client))['items'][:2]
    snapshots = []
    for i, entry in enumerate(entries, 1):
        snapshot = source()
        snapshot['knowledge_point_id'] = 'kp_' + str(i) * 20
        snapshot['content_version'] = hashlib.sha256(canonical({k: snapshot[k] for k in
            ('knowledge_point_id', 'type', 'title', 'statement', 'evidence')}).encode()).hexdigest()
        snapshots.append(snapshot)
        await bind(client, entry, snapshot)
    draft = await create(client, body)
    assert (await get_stats(client))['total'] == 0
    await submit(client, draft, body)
    page1 = await get_stats(client, page_size=1)
    page2 = await get_stats(client, page_size=1, page=2)
    assert page1['total'] == page2['total'] == 2
    assert page1['items'][0]['source']['knowledge_point_id'] != page2['items'][0]['source']['knowledge_point_id']
    assert (await get_stats(client, page=3, page_size=1))['items'] == []
    assert (await get_stats(client, knowledge_point_id=snapshots[0]['knowledge_point_id']))['total'] == 1
    assert (await get_stats(client, knowledge_point_id=snapshots[0]['knowledge_point_id'], content_version='0' * 64))['total'] == 0
    other = await users.create_user('stats-other')
    token = client.headers['authorization']
    client.headers['authorization'] = 'Bearer ' + create_token(other['id'], 'stats-other')
    assert (await get_stats(client))['total'] == 0
    query = {k: snapshots[0][k] for k in ('knowledge_point_id', 'content_version')}
    assert (await client.get(STATS + '/history', params=query)).json()['data']['total'] == 0
    client.headers['authorization'] = token
    with db.transaction() as cur:
        # Pre-v4 histories have no captured mapping; old client-scored records
        # cannot become trusted even if an association was mistakenly injected.
        cur.execute('UPDATE question_bank_attempts SET source_revision=NULL WHERE entry_id=?', (entries[0]['id'],))
        cur.execute("UPDATE quiz_attempts SET legacy_records_json='[]' WHERE attempt_id=?", (draft['attempt_id'],))
    assert (await get_stats(client))['total'] == 0


@pytest.mark.parametrize('query', [{'page': 0}, {'page_size': 101}, {'knowledge_point_id': 'bad'},
    {'content_version': 'a' * 64}, {'knowledge_point_id': 'kp_' + '1' * 20, 'content_version': 'bad'}, {'user_id': 1}])
async def test_invalid_stats_query(api, query):
    client, _, _ = api
    assert (await client.get(STATS, params=query)).status_code == 422
    assert (await client.get(STATS + '/history')).status_code == 422
