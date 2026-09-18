"""Persisted questions, not browser flags or LLM output, determine scores."""
from copy import deepcopy
from unittest.mock import AsyncMock

import pytest

from app.core.exceptions import AttemptError
from app.models.report import ReportGenerateRequest, ReportOutput
from app.repositories import quiz_repository as quizzes, user_repository as users
from app.services import report_service


@pytest.fixture
def reporter(monkeypatch):
    mock = AsyncMock(return_value=ReportOutput(
        accuracy=99, mastered_points=[], weak_points=[], three_line_summary=[],
        advice=[], share_quote='',
    ))
    monkeypatch.setattr(report_service, 'generate_report', mock)
    return mock


async def seed(body):
    uid = (await users.create_user('grading'))['id']
    await quizzes.save_quiz_session(body['quiz_id'], uid, body['topic'], '', '', body['questions'])
    return uid


@pytest.mark.asyncio
async def test_saved_answers_override_browser_and_llm(database, sample_report_request, reporter):
    body = deepcopy(sample_report_request)
    uid = await seed(body)
    body['topic'] = 'forged title'
    body['questions'][2]['answer'] = ['A']
    body['answer_records'][2]['is_correct'] = True
    # Multiple choices are order independent.
    body['answer_records'][3]['selected_answers'] = ['D', 'B', 'A']
    result = await report_service.handle_report_generate(ReportGenerateRequest(**body), uid)
    assert result.accuracy == 80
    args = reporter.call_args.kwargs
    assert args['topic'] == sample_report_request['topic']
    assert args['questions'][2].answer == ['B']
    assert args['answer_records'][2].is_correct is False
    detail = await quizzes.get_quiz_detail(body['quiz_id'], uid)
    assert detail['answer_records'][2]['is_correct'] is False
    assert detail['report']['accuracy'] == 80
    assert (await users.get_user_by_id(uid))['total_xp'] == 18
    # Retry must neither call the model nor award XP again.
    assert await report_service.handle_report_generate(ReportGenerateRequest(**body), uid) == result
    assert reporter.await_count == 1
    assert (await users.get_user_by_id(uid))['total_xp'] == 18


@pytest.mark.asyncio
@pytest.mark.parametrize('invalid', ['duplicate', 'missing', 'unknown', 'option', 'repeated_option', 'single_multiple'])
async def test_invalid_submission_never_calls_model_or_writes(database, sample_report_request, reporter, invalid):
    body = deepcopy(sample_report_request)
    uid = await seed(body)
    records = body['answer_records']
    if invalid == 'duplicate':
        records[-1] = deepcopy(records[0])
    elif invalid == 'missing':
        records.pop()
    elif invalid == 'unknown':
        records[0]['question_id'] = 'unknown'
    elif invalid == 'option':
        records[0]['selected_answers'] = ['Z']
    elif invalid == 'repeated_option':
        records[0]['selected_answers'] = ['A', 'A']
    else:
        records[0]['selected_answers'] = ['A', 'B']
    with pytest.raises(AttemptError):
        await report_service.handle_report_generate(ReportGenerateRequest(**body), uid)
    reporter.assert_not_awaited()
    assert 'answer_records' not in await quizzes.get_quiz_detail(body['quiz_id'], uid)
    assert (await users.get_user_by_id(uid))['total_xp'] == 0


@pytest.mark.asyncio
async def test_wrong_owner_cannot_grade(database, sample_report_request, reporter):
    await seed(sample_report_request)
    outsider = (await users.create_user('outsider'))['id']
    with pytest.raises(AttemptError):
        await report_service.handle_report_generate(ReportGenerateRequest(**sample_report_request), outsider)
    reporter.assert_not_awaited()
