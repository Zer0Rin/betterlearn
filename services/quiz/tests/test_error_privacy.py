"""Provider and storage failures must not echo private details to API/state/logs."""
from unittest.mock import AsyncMock

import pytest
from structlog.testing import capture_logs

from app.core.exceptions import QuizGenerationError, ReportGenerationError
from app.models.quiz import QuizGenerateRequest
from app.models.report import ReportGenerateRequest
from app.repositories import task_repository, knowledge_repository, user_repository
from app.services import quiz_service, report_service, knowledge_service

SECRET = 'sentinel-fake-secret-provider-token'


@pytest.mark.asyncio
async def test_quiz_exception_api_message_and_logs_are_safe(monkeypatch, sample_quiz_request):
    monkeypatch.setattr(quiz_service, '_fetch_context', AsyncMock(return_value=''))
    monkeypatch.setattr(quiz_service, 'generate_quiz', AsyncMock(side_effect=RuntimeError(SECRET)))
    with capture_logs() as logs, pytest.raises(QuizGenerationError) as error:
        await quiz_service.handle_quiz_generate(QuizGenerateRequest(**sample_quiz_request))
    assert SECRET not in str(error.value)
    assert SECRET not in repr(logs)
    assert '设置' in str(error.value)


@pytest.mark.asyncio
@pytest.mark.parametrize("storage_failure", [False, True])
async def test_report_exception_api_message_and_logs_are_safe(monkeypatch, sample_report_request, storage_failure):
    monkeypatch.setattr(report_service, 'generate_report', AsyncMock(side_effect=RuntimeError(SECRET)))
    if storage_failure:
        monkeypatch.setattr(report_service.quiz_repository, 'get_saved_report', AsyncMock(side_effect=RuntimeError(SECRET)))
    with capture_logs() as logs, pytest.raises(ReportGenerationError) as error:
        await report_service.handle_report_generate(ReportGenerateRequest(**sample_report_request), 1 if storage_failure else None)
    assert SECRET not in str(error.value)
    assert SECRET not in repr(logs)


@pytest.mark.asyncio
async def test_background_task_status_never_persists_provider_error(database, monkeypatch, sample_quiz_request):
    uid = (await user_repository.create_user('privacy-task'))['id']
    req = QuizGenerateRequest(**sample_quiz_request)
    await task_repository.create_task('privacy_task', uid, req.user_input, req.question_count, req.difficulty)
    monkeypatch.setattr(quiz_service, '_fetch_context', AsyncMock(return_value=''))
    monkeypatch.setattr(quiz_service, 'generate_quiz', AsyncMock(side_effect=RuntimeError(SECRET)))
    with capture_logs() as logs:
        await quiz_service._run_quiz_task('privacy_task', req, uid)
    status = await quiz_service.get_quiz_task_status('privacy_task')
    assert status.status == 'failed'
    assert SECRET not in status.model_dump_json()
    assert SECRET not in repr(logs)
    assert SECRET not in repr(await task_repository.get_task('privacy_task'))


@pytest.mark.asyncio
async def test_document_status_never_persists_embedding_error(database, monkeypatch):
    uid = (await user_repository.create_user('privacy-doc'))['id']
    await knowledge_repository.create_document('privacy_doc', uid, 'doc.txt', 'txt', 1)
    monkeypatch.setattr(knowledge_service.document_loader_service, 'load_and_split', lambda *args: ['chunk'])
    def fail(*args):
        raise RuntimeError(SECRET)
    monkeypatch.setattr(knowledge_service.vector_store_service, 'add_document_chunks', fail)
    with capture_logs() as logs:
        await knowledge_service._process_document('privacy_doc', uid, '/unused', 'txt')
    status = await knowledge_service.get_document_status(uid, 'privacy_doc')
    assert status.status == 'failed'
    assert SECRET not in status.model_dump_json()
    assert SECRET not in repr(logs)


@pytest.mark.asyncio
async def test_configuration_error_remains_actionable(monkeypatch, sample_quiz_request):
    monkeypatch.setattr(quiz_service, '_fetch_context', AsyncMock(return_value=''))
    message = '请先在设置中配置文本模型 API Key'
    monkeypatch.setattr(quiz_service, 'generate_quiz', AsyncMock(side_effect=QuizGenerationError(message)))
    with pytest.raises(QuizGenerationError, match=message):
        await quiz_service.handle_quiz_generate(QuizGenerateRequest(**sample_quiz_request))


@pytest.mark.asyncio
async def test_provider_exception_never_reaches_http_responses(monkeypatch, sample_quiz_request, sample_report_request):
    from httpx import ASGITransport, AsyncClient
    from app.main import app
    monkeypatch.setattr(quiz_service, '_fetch_context', AsyncMock(return_value=''))
    monkeypatch.setattr(quiz_service, 'generate_quiz', AsyncMock(side_effect=RuntimeError(SECRET)))
    monkeypatch.setattr(report_service, 'generate_report', AsyncMock(side_effect=RuntimeError(SECRET)))
    with capture_logs() as logs:
        async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
            for path, body in [('quiz', sample_quiz_request), ('report', sample_report_request)]:
                response = await client.post(f'/api/v1/{path}/generate', json=body)
                assert response.status_code == 500
                assert SECRET not in response.text
    assert SECRET not in repr(logs)


@pytest.mark.asyncio
async def test_generic_api_handler_does_not_log_private_exception():
    from starlette.requests import Request
    from app.main import unhandled_exception_handler
    request = Request({'type': 'http', 'method': 'GET', 'path': '/api/test', 'headers': []})
    with capture_logs() as logs:
        response = await unhandled_exception_handler(request, RuntimeError(SECRET))
    assert SECRET.encode() not in response.body
    assert SECRET not in repr(logs)
    assert not any(event.get('exc_info') for event in logs)


@pytest.mark.asyncio
async def test_document_parser_exception_message_and_log_are_safe(tmp_path, monkeypatch):
    from app.core.config import get_settings
    from app.core.exceptions import KnowledgeBaseError
    settings = get_settings().model_copy(update={'kb_upload_dir': str(tmp_path)})
    (tmp_path / 'doc.txt').write_text('content')
    monkeypatch.setattr(knowledge_service, 'get_settings', lambda: settings)
    monkeypatch.setattr(knowledge_repository, 'get_document', AsyncMock(return_value={'file_type': 'txt'}))
    def fail(*args):
        raise RuntimeError(SECRET)
    monkeypatch.setattr(knowledge_service.document_loader_service, 'load_text', fail)
    with capture_logs() as logs, pytest.raises(KnowledgeBaseError) as error:
        await knowledge_service.get_document_content(1, 'doc')
    assert SECRET not in str(error.value)
    assert SECRET not in repr(logs)


@pytest.mark.asyncio
async def test_search_provider_error_payload_not_logged(monkeypatch):
    from types import SimpleNamespace
    from langchain_core.messages import ToolMessage, AIMessage
    from app.services import search_service
    from app.core.config import get_settings
    monkeypatch.setattr(search_service, 'get_settings', lambda: get_settings().model_copy(update={'enable_web_search': True, 'tavily_api_key': 'configured'}))
    result = {'messages': [ToolMessage(content='{"error":"' + SECRET + '"}', tool_call_id='t'), AIMessage(content='summary')]}
    monkeypatch.setattr(search_service, '_build_agent', lambda: (SimpleNamespace(ainvoke=AsyncMock(return_value=result)), None))
    with capture_logs() as logs, pytest.raises(QuizGenerationError) as error:
        await search_service.fetch_knowledge_context('plants')
    assert SECRET not in str(error.value)
    assert SECRET not in repr(logs)
