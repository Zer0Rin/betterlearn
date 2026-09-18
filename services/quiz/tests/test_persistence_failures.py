"""Storage failures must never be reported as successful quiz generation."""
import sqlite3
from unittest.mock import AsyncMock

import pytest

from app.core.exceptions import QuizGenerationError
from app.models.quiz import QuizGenerateRequest, QuizOutput
from app.repositories import task_repository, user_repository, knowledge_repository
from app.services import quiz_service


@pytest.mark.asyncio
@pytest.mark.parametrize('background', [False, True])
async def test_quiz_insert_failure_is_visible(database, monkeypatch, sample_quiz_request, sample_quiz_response_data, background):
    uid = (await user_repository.create_user('storage-failure'))['id']
    with sqlite3.connect(database) as conn:
        conn.execute("CREATE TRIGGER reject_quiz BEFORE INSERT ON quiz_sessions BEGIN SELECT RAISE(ABORT, 'private-storage-detail'); END")
    monkeypatch.setattr(quiz_service, '_fetch_context', AsyncMock(return_value=''))
    monkeypatch.setattr(quiz_service, 'generate_quiz', AsyncMock(return_value=QuizOutput.model_validate(sample_quiz_response_data)))
    req = QuizGenerateRequest(**sample_quiz_request)
    if background:
        await task_repository.create_task('task', uid, req.user_input, req.question_count, req.difficulty)
        await quiz_service._run_quiz_task('task', req, uid)
        task = await task_repository.get_task('task')
        assert task['status'] == 'failed'
        assert task['result_json'] is None
        assert task['error_message'] == '题库保存失败，请检查本地存储后重试'
    else:
        with pytest.raises(QuizGenerationError, match='^题库保存失败，请检查本地存储后重试$'):
            await quiz_service.handle_quiz_generate(req, uid)


@pytest.mark.asyncio
async def test_processing_document_counts_as_active_work(database):
    uid = (await user_repository.create_user('document-work'))['id']
    assert not await task_repository.has_active_tasks()
    await knowledge_repository.create_document('doc', uid, 'x.txt', 'txt', 1)
    assert not await task_repository.has_active_tasks()
    await knowledge_repository.claim_vectorization('doc', uid)
    assert await task_repository.has_active_tasks()
    await knowledge_repository.update_document_status('doc', 'ready', 1)
    assert not await task_repository.has_active_tasks()
