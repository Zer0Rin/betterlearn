"""知识库路由集成测试"""

from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.auth import create_token
from app.core.exceptions import KnowledgeBaseError
from app.main import app
from app.models.knowledge import (
    KnowledgeContentResponse,
    KnowledgeDocumentItem,
    KnowledgeListResponse,
    KnowledgeStatusResponse,
    KnowledgeUploadResponse,
)


@pytest.fixture
def auth_header():
    token = create_token(user_id=1, openid="test_openid_123")
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
class TestKnowledgeUploadAPI:
    async def test_upload_requires_auth(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/v1/knowledge/documents",
                files={"file": ("a.txt", b"hello", "text/plain")},
            )
        assert resp.status_code == 401

    async def test_upload_success(self, auth_header):
        mock_result = KnowledgeUploadResponse(
            doc_id="doc_abc123", file_name="a.txt", status="uploaded"
        )
        with patch(
            "app.api.v1.routes.knowledge.knowledge_service.handle_upload",
            AsyncMock(return_value=mock_result),
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                resp = await client.post(
                    "/api/v1/knowledge/documents",
                    files={"file": ("a.txt", b"hello", "text/plain")},
                    headers=auth_header,
                )
        assert resp.status_code == 200
        body = resp.json()
        assert body["code"] == 0
        assert body["data"]["doc_id"] == "doc_abc123"
        assert body["data"]["status"] == "uploaded"

    async def test_upload_rejects_invalid_document(self, auth_header):
        with patch(
            "app.api.v1.routes.knowledge.knowledge_service.handle_upload",
            AsyncMock(side_effect=KnowledgeBaseError("不支持的文件格式：xlsx")),
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                resp = await client.post(
                    "/api/v1/knowledge/documents",
                    files={"file": ("a.xlsx", b"hello", "application/octet-stream")},
                    headers=auth_header,
                )
        assert resp.status_code == 400
        body = resp.json()
        assert body["code"] == 4001
        assert "不支持的文件格式" in body["message"]


@pytest.mark.asyncio
class TestKnowledgeListAPI:
    async def test_list_documents(self, auth_header):
        mock_result = KnowledgeListResponse(
            items=[
                KnowledgeDocumentItem(
                    doc_id="doc_1",
                    file_name="a.txt",
                    file_type="txt",
                    file_size=100,
                    status="ready",
                    chunk_count=3,
                    error_message=None,
                    created_at="2026-01-01T00:00:00",
                )
            ]
        )
        with patch(
            "app.api.v1.routes.knowledge.knowledge_service.list_documents",
            AsyncMock(return_value=mock_result),
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                resp = await client.get(
                    "/api/v1/knowledge/documents", headers=auth_header
                )
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["data"]["items"]) == 1
        assert body["data"]["items"][0]["doc_id"] == "doc_1"


@pytest.mark.asyncio
class TestKnowledgeStatusAPI:
    async def test_get_status_success(self, auth_header):
        mock_result = KnowledgeStatusResponse(
            doc_id="doc_1", file_name="a.txt", status="ready", chunk_count=3, error_message=None
        )
        with patch(
            "app.api.v1.routes.knowledge.knowledge_service.get_document_status",
            AsyncMock(return_value=mock_result),
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                resp = await client.get(
                    "/api/v1/knowledge/documents/doc_1", headers=auth_header
                )
        assert resp.status_code == 200
        assert resp.json()["data"]["status"] == "ready"

    async def test_get_status_not_found(self, auth_header):
        with patch(
            "app.api.v1.routes.knowledge.knowledge_service.get_document_status",
            AsyncMock(side_effect=KnowledgeBaseError("文档不存在")),
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                resp = await client.get(
                    "/api/v1/knowledge/documents/doc_missing", headers=auth_header
                )
        assert resp.status_code == 400
        assert resp.json()["code"] == 4001


@pytest.mark.asyncio
class TestKnowledgeContentAPI:
    async def test_get_content_success(self, auth_header):
        mock_result = KnowledgeContentResponse(
            doc_id="doc_1",
            file_name="notes.md",
            file_type="md",
            media_type="text/markdown",
            text="# 标题\n\n正文内容",
            character_count=11,
            byte_size=len("# 标题\n\n正文内容".encode("utf-8")),
        )
        with patch(
            "app.api.v1.routes.knowledge.knowledge_service.get_document_content",
            AsyncMock(return_value=mock_result),
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                resp = await client.get(
                    "/api/v1/knowledge/documents/doc_1/content", headers=auth_header
                )
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["text"] == "# 标题\n\n正文内容"
        assert data["media_type"] == "text/markdown"
        assert data["character_count"] == 11

    async def test_get_content_not_found(self, auth_header):
        with patch(
            "app.api.v1.routes.knowledge.knowledge_service.get_document_content",
            AsyncMock(side_effect=KnowledgeBaseError("文档不存在")),
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                resp = await client.get(
                    "/api/v1/knowledge/documents/doc_missing/content", headers=auth_header
                )
        assert resp.status_code == 400
        assert resp.json()["code"] == 4001

    async def test_get_content_requires_auth(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/v1/knowledge/documents/doc_1/content")
        assert resp.status_code == 401


@pytest.mark.asyncio
class TestKnowledgeDeleteAPI:
    async def test_delete_success(self, auth_header):
        with patch(
            "app.api.v1.routes.knowledge.knowledge_service.delete_document",
            AsyncMock(return_value=None),
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                resp = await client.delete(
                    "/api/v1/knowledge/documents/doc_1", headers=auth_header
                )
        assert resp.status_code == 200
        assert resp.json()["code"] == 0

    async def test_delete_requires_auth(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.delete("/api/v1/knowledge/documents/doc_1")
        assert resp.status_code == 401


@pytest.mark.asyncio
async def test_vectorize_route_requires_auth_and_explicit_post(auth_header):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url='http://test') as client:
        assert (await client.post('/api/v1/knowledge/documents/doc_1/vectorize')).status_code == 401
        with patch('app.services.knowledge_service.start_vectorization', new_callable=AsyncMock) as start:
            start.return_value = KnowledgeStatusResponse(doc_id='doc_1', file_name='a.txt', status='processing', chunk_count=0)
            response = await client.post('/api/v1/knowledge/documents/doc_1/vectorize', headers=auth_header)
            assert response.status_code == 200
            start.assert_awaited_once_with(1, 'doc_1')
