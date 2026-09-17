from unittest.mock import AsyncMock, patch
import pytest
from httpx import ASGITransport, AsyncClient
from app.main import app
from app.core.config import get_settings
from app.models.user import LoginResponse, UserBrief

@pytest.mark.asyncio
async def test_managed_service_requires_private_header_even_for_health():
    settings = get_settings().model_copy(update={'managed_host_token': 'private-host-token'})
    with patch('app.main.get_settings', return_value=settings):
        async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
            response = await client.get('/api/v1/health')
            assert response.status_code == 403
            response = await client.get('/api/v1/health', headers={'X-BetterLearn-Host': 'private-host-token'})
            assert response.status_code == 200

@pytest.mark.asyncio
async def test_host_session_requires_managed_mode_and_returns_login():
    transport = ASGITransport(app=app, client=('127.0.0.1', 1234))
    async with AsyncClient(transport=transport, base_url='http://test') as client:
        assert (await client.post('/api/v1/user/host-session')).status_code == 403
    settings = get_settings().model_copy(update={'managed_host_token': 'private-host-token'})
    login = LoginResponse(token='test-jwt', user=UserBrief(id=1, nickname='学习者', avatar_url='', total_xp=0))
    with patch('app.main.get_settings', return_value=settings), patch('app.api.v1.routes.user.get_settings', return_value=settings), patch('app.api.v1.routes.user.user_service.handle_local_login', AsyncMock(return_value=login)):
        async with AsyncClient(transport=transport, base_url='http://test') as client:
            response = await client.post('/api/v1/user/host-session', headers={'X-BetterLearn-Host': 'private-host-token'})
            assert response.status_code == 200
            assert response.json()['data']['token'] == 'test-jwt'

@pytest.mark.asyncio
async def test_missing_document_content_has_http_404_for_host_adapter():
    from app.core.auth import create_token
    token = create_token(1, 'local')
    with patch('app.services.knowledge_service.knowledge_repository.get_document', AsyncMock(return_value=None)):
        async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
            response = await client.get('/api/v1/knowledge/documents/doc_missing/content', headers={'Authorization': f'Bearer {token}'})
            assert response.status_code == 404
