from datetime import datetime, timedelta, timezone
import pytest
from nobei_core import learning
from nobei_core.errors import CoreProblem
from test_learning import _core, _seed_points, _sync, _find_assessment


def _key(n):
    return 'idem_' + f'{n:020x}'


def _correct(database, assessment):
    return database.one('SELECT correct_option_id FROM learning_assessments WHERE id=?', (assessment['assessmentId'],))['correct_option_id']


def _master(database, monkeypatch):
    now = datetime(2026, 9, 18, tzinfo=timezone.utc)
    monkeypatch.setattr(learning, '_now', lambda: now)
    core = _core(database)
    points = _seed_points(database)
    course = _sync(core, points)
    unit = course['units'][0]
    main = unit['check']['main']
    result = core.submit_learning_attempt({'assessmentId': main['assessmentId'], 'optionId': _correct(database, main), 'idempotencyKey': _key(1)})
    return core, course, result, now


def _command(item, option, n):
    return {'unitId': item['unitId'], 'assessmentId': item['assessment']['assessmentId'],
            'optionId': option, 'expectedAttemptId': item['expectedAttemptId'], 'idempotencyKey': _key(n)}


def test_due_review_replay_and_stale_version(database, monkeypatch):
    core, course, first, now = _master(database, monkeypatch)
    assert core.list_learning_reviews({})['total'] == 0
    main = course['units'][0]['check']['main']
    command = {'unitId': course['units'][0]['unitId'], 'assessmentId': main['assessmentId'],
               'optionId': _correct(database, main), 'expectedAttemptId': first['attempt']['attemptId'], 'idempotencyKey': _key(2)}
    with pytest.raises(CoreProblem, match='LEARNING_STATE_CONFLICT'):
        core.submit_learning_review(command)
    monkeypatch.setattr(learning, '_now', lambda: now + timedelta(days=3))
    queue = core.list_learning_reviews({})
    assert queue['total'] == 1 and queue['items'][0]['phase'] == 'review'
    assert queue['items'][0]['assessment']['attempt'] is None
    reviewed = core.submit_learning_review(command)
    assert reviewed['attempt']['correct'] is True
    assert reviewed['review']['roundId'] == reviewed['attempt']['attemptId']
    assert reviewed['course']['units'][0]['mastery']['dueAt'] == '2026-09-28T00:00:00Z'
    assert core.submit_learning_review(command) == reviewed
    assert core.list_learning_reviews({})['total'] == 0
    monkeypatch.setattr(learning, '_now', lambda: now + timedelta(days=10))
    with pytest.raises(CoreProblem, match='LEARNING_STATE_CONFLICT'):
        core.submit_learning_review(command | {'idempotencyKey': _key(3)})
    with pytest.raises(CoreProblem, match='IDEMPOTENCY_CONFLICT'):
        core.submit_learning_review(command | {'expectedAttemptId': reviewed['attempt']['attemptId']})
    assert database.scalar('SELECT COUNT(*) FROM learning_attempts') == 2


def test_wrong_review_remediation_and_future_review(database, monkeypatch):
    core, course, first, now = _master(database, monkeypatch)
    monkeypatch.setattr(learning, '_now', lambda: now + timedelta(days=3))
    item = core.list_learning_reviews({})['items'][0]
    wrong = next(o['optionId'] for o in item['assessment']['options'] if o['optionId'] != _correct(database, item['assessment']))
    failed = core.submit_learning_review(_command(item, wrong, 2))
    repair = core.list_learning_reviews({})['items'][0]
    assert repair['phase'] == 'remediation' and repair['assessment']['kind'] == 'evidence_choice'
    assert failed['course']['units'][0]['mastery']['status'] == 'remediation_required'
    # A stale ordinary page cannot bypass the review token.
    with pytest.raises(CoreProblem, match='LEARNING_STATE_CONFLICT'):
        core.submit_learning_attempt({'assessmentId': repair['assessment']['assessmentId'], 'optionId': _correct(database, repair['assessment']), 'idempotencyKey': _key(3)})
    passed = core.submit_learning_review(_command(repair, _correct(database, repair['assessment']), 4))
    assert passed['review']['roundId'] == failed['review']['roundId']
    assert passed['review']['schedule'] == failed['review']['schedule']
    assert passed['course']['units'][0]['mastery']['dueAt'] == '2026-09-24T00:00:00Z'
    assert core.list_learning_reviews({})['total'] == 0
    monkeypatch.setattr(learning, '_now', lambda: now + timedelta(days=6))
    next_item = core.list_learning_reviews({})['items'][0]
    assert next_item['expectedAttemptId'] == passed['attempt']['attemptId']
    assert next_item['phase'] == 'review'


def _wrong(database, assessment):
    return next(o['optionId'] for o in assessment['options'] if o['optionId'] != _correct(database, assessment))


def test_initial_remediation_repeated_failure_keeps_one_day(database, monkeypatch):
    core, course, _, now = _master(database, monkeypatch)
    main = course['units'][1]['check']['main']
    core.submit_learning_attempt({'assessmentId': main['assessmentId'], 'optionId': _wrong(database, main), 'idempotencyKey': _key(2)})
    item = core.list_learning_reviews({})['items'][0]
    core.submit_learning_review(_command(item, _wrong(database, item['assessment']), 3))
    item = core.list_learning_reviews({})['items'][0]
    result = core.submit_learning_review(_command(item, _correct(database, item['assessment']), 4))
    assert result['course']['units'][1]['mastery']['dueAt'] == '2026-09-19T00:00:00Z'


@pytest.mark.parametrize('params', [{'limit': True}, {'limit': 101}, {'offset': -1}, {'offset': 1.5}, {'now': '2099'}, {'courseId': 'bad'}])
def test_invalid_queue_params(database, params):
    with pytest.raises(CoreProblem, match='INVALID_PARAMS|INVALID_IDENTIFIER'):
        _core(database).list_learning_reviews(params)


def test_queue_cross_course_pagination_and_archiving(database, monkeypatch):
    core, course, _, now = _master(database, monkeypatch)
    other = core.sync_learning_course({'clientBookId': 'book-another', 'title': 'Another',
        'knowledgePointIds': [course['units'][1]['knowledgePointId']]})
    main = other['units'][0]['check']['main']
    core.submit_learning_attempt({'assessmentId': main['assessmentId'], 'optionId': _wrong(database, main), 'idempotencyKey': _key(2)})
    monkeypatch.setattr(learning, '_now', lambda: now + timedelta(days=3))
    before = database.scalar('SELECT COUNT(*) FROM learning_attempts')
    queue = core.list_learning_reviews({'limit': 1})
    assert queue['total'] == 2 and queue['items'][0]['courseId'] == other['courseId']
    assert core.list_learning_reviews({'offset': 1})['items'][0]['courseId'] == course['courseId']
    assert core.list_learning_reviews({'courseId': course['courseId']})['total'] == 1
    assert database.scalar('SELECT COUNT(*) FROM learning_attempts') == before
    with database.write_transaction() as con:
        con.execute("UPDATE learning_courses SET status='archived' WHERE id=?", (other['courseId'],))
    assert core.list_learning_reviews({})['total'] == 1
    with pytest.raises(CoreProblem, match='LEARNING_STATE_CONFLICT'):
        core.submit_learning_review(_command(queue['items'][0], _correct(database, queue['items'][0]['assessment']), 3))


def test_review_concurrency_and_restart(database, monkeypatch, owned_root, ownership_token):
    from concurrent.futures import ThreadPoolExecutor
    from nobei_core.database import Phase1Database
    core, _, _, now = _master(database, monkeypatch)
    monkeypatch.setattr(learning, '_now', lambda: now + timedelta(days=3))
    item = core.list_learning_reviews({})['items'][0]
    command = _command(item, _correct(database, item['assessment']), 2)
    def submit(n):
        try:
            return core.submit_learning_review(command | {'idempotencyKey': _key(n)})
        except CoreProblem as exc:
            return str(exc)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(submit, [2, 3]))
    successes = [r for r in results if isinstance(r, dict)]
    assert len(successes) == 1
    assert any(isinstance(r, str) and 'LEARNING_STATE_CONFLICT' in r for r in results)
    assert database.scalar('SELECT COUNT(*) FROM learning_attempts') == 2
    winner = 2 if isinstance(results[0], dict) else 3
    database.close()
    reopened = Phase1Database.open(owned_root, ownership_token)
    try:
        restored = _core(reopened)
        assert restored.submit_learning_review(command | {'idempotencyKey': _key(winner)}) == successes[0]
        assert restored.list_learning_reviews({})['total'] == 0
    finally:
        reopened.close()


def test_review_storage_failure_rolls_back(database, monkeypatch):
    core, _, _, now = _master(database, monkeypatch)
    monkeypatch.setattr(learning, '_now', lambda: now + timedelta(days=3))
    item = core.list_learning_reviews({})['items'][0]
    command = _command(item, _correct(database, item['assessment']), 2)
    with database.write_transaction() as con:
        con.execute("CREATE TRIGGER fail_review BEFORE INSERT ON learning_attempts BEGIN SELECT RAISE(ABORT, 'test failure'); END")
    with pytest.raises(CoreProblem):
        core.submit_learning_review(command)
    assert database.scalar('SELECT COUNT(*) FROM learning_attempts') == 1
    assert core.list_learning_reviews({})['items'][0] == item
    with database.write_transaction() as con:
        con.execute('DROP TRIGGER fail_review')
    assert core.submit_learning_review(command)['attempt']['correct'] is True


def test_same_key_concurrency_and_replay_after_later_round(database, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    core, course, _, now = _master(database, monkeypatch)
    monkeypatch.setattr(learning, '_now', lambda: now + timedelta(days=3))
    item = core.list_learning_reviews({})['items'][0]
    command = _command(item, _correct(database, item['assessment']), 2)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: core.submit_learning_review(command), range(2)))
    assert results[0] == results[1]
    assert database.scalar('SELECT COUNT(*) FROM learning_attempts') == 2
    monkeypatch.setattr(learning, '_now', lambda: now + timedelta(days=10))
    item = core.list_learning_reviews({})['items'][0]
    second = core.submit_learning_review(_command(item, _correct(database, item['assessment']), 3))
    assert second['review']['schedule']['intervalIndex'] == 3
    assert core.submit_learning_review(command) == results[0]
    core.delete_learning_course({'courseId': course['courseId']})
    assert core.list_learning_reviews({})['total'] == 0
    assert database.scalar('SELECT COUNT(*) FROM learning_attempts') == 0


@pytest.mark.parametrize('point_type,first,maximum', [('fact', 1, 60), ('concept', 7, 30),
    ('comparison', 7, 30), ('process', 7, 14), ('formula', 7, 14), ('code', 7, 14)])
def test_schedule_type_mapping_bounds_and_failure(point_type, first, maximum):
    from nobei_core.learning_schedule import initial_state, advance, interval_days
    state = initial_state()
    next_state = advance(state, point_type, True)
    assert state == initial_state()
    assert interval_days(next_state, point_type) == first
    for _ in range(20):
        next_state = advance(next_state, point_type, True)
    assert interval_days(next_state, point_type) == maximum
    for _ in range(20):
        next_state = advance(next_state, point_type, False)
    assert next_state['intervalIndex'] == 0
    assert next_state['consecutiveCorrect'] == 0
    assert interval_days(next_state, point_type) >= 1
