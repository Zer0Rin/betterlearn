"""knowledge_service 单元测试"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain_core.documents import Document

from app.core.exceptions import KnowledgeBaseError
from app.services import knowledge_service


def _patch_settings(**overrides):
    settings = MagicMock()
    settings.kb_max_file_size_mb = overrides.get("kb_max_file_size_mb", 10)
    settings.kb_max_documents_per_user = overrides.get("kb_max_documents_per_user", 10)
    settings.kb_upload_dir = overrides.get("kb_upload_dir", "./data/uploads")
    return settings


@pytest.mark.asyncio
async def test_handle_upload_rejects_unsupported_extension():
    with pytest.raises(KnowledgeBaseError, match="不支持的文件格式"):
        await knowledge_service.handle_upload(1, "sample.xlsx", b"content")


@pytest.mark.asyncio
async def test_handle_upload_rejects_oversized_file():
    settings = _patch_settings(kb_max_file_size_mb=1)
    with patch("app.services.knowledge_service.get_settings", return_value=settings):
        big_content = b"x" * (2 * 1024 * 1024)
        with pytest.raises(KnowledgeBaseError, match="文件大小超过限制"):
            await knowledge_service.handle_upload(1, "sample.txt", big_content)


@pytest.mark.asyncio
async def test_handle_upload_rejects_when_quota_reached():
    settings = _patch_settings(kb_max_documents_per_user=2)
    with patch("app.services.knowledge_service.get_settings", return_value=settings), patch(
        "app.services.knowledge_service.knowledge_repository.count_documents",
        AsyncMock(return_value=2),
    ):
        with pytest.raises(KnowledgeBaseError, match="数量已达上限"):
            await knowledge_service.handle_upload(1, "sample.txt", b"content")


@pytest.mark.asyncio
async def test_handle_upload_success_saves_file_and_creates_record(tmp_path):
    settings = _patch_settings(kb_upload_dir=str(tmp_path))
    create_document_mock = AsyncMock()

    with patch("app.services.knowledge_service.get_settings", return_value=settings), patch(
        "app.services.knowledge_service.knowledge_repository.count_documents",
        AsyncMock(return_value=0),
    ), patch(
        "app.services.knowledge_service.knowledge_repository.create_document",
        create_document_mock,
    ), patch(
        "app.services.knowledge_service.asyncio.create_task"
    ) as mock_create_task:
        result = await knowledge_service.handle_upload(1, "sample.txt", b"hello world")

    assert result.status == "processing"
    assert result.file_name == "sample.txt"
    assert result.doc_id.startswith("doc_")

    create_document_mock.assert_called_once()
    mock_create_task.assert_called_once()
    # asyncio.create_task 被 mock 掉，需手动关闭协程避免 "never awaited" 警告
    mock_create_task.call_args[0][0].close()

    saved_file = tmp_path / f"{result.doc_id}.txt"
    assert saved_file.exists()
    assert saved_file.read_bytes() == b"hello world"


@pytest.mark.asyncio
async def test_process_document_success_updates_status_ready():
    fake_chunks = [Document(page_content="内容分块", metadata={})]
    update_status_mock = AsyncMock()

    with patch(
        "app.services.knowledge_service.document_loader_service.load_and_split",
        return_value=fake_chunks,
    ), patch(
        "app.services.knowledge_service.vector_store_service.add_document_chunks",
        return_value=1,
    ), patch(
        "app.services.knowledge_service.knowledge_repository.update_document_status",
        update_status_mock,
    ):
        await knowledge_service._process_document("doc_1", 1, "/tmp/doc_1.txt", "txt")

    update_status_mock.assert_called_once_with("doc_1", "ready", chunk_count=1)


@pytest.mark.asyncio
async def test_process_document_no_chunks_marks_failed():
    update_status_mock = AsyncMock()

    with patch(
        "app.services.knowledge_service.document_loader_service.load_and_split",
        return_value=[],
    ), patch(
        "app.services.knowledge_service.knowledge_repository.update_document_status",
        update_status_mock,
    ):
        await knowledge_service._process_document("doc_1", 1, "/tmp/doc_1.txt", "txt")

    args, kwargs = update_status_mock.call_args
    assert args[0] == "doc_1"
    assert args[1] == "failed"
    assert "error_message" in kwargs


@pytest.mark.asyncio
async def test_process_document_loader_exception_marks_failed():
    update_status_mock = AsyncMock()

    with patch(
        "app.services.knowledge_service.document_loader_service.load_and_split",
        side_effect=ValueError("解析失败"),
    ), patch(
        "app.services.knowledge_service.knowledge_repository.update_document_status",
        update_status_mock,
    ):
        await knowledge_service._process_document("doc_1", 1, "/tmp/doc_1.txt", "txt")

    args, kwargs = update_status_mock.call_args
    assert args[0] == "doc_1"
    assert args[1] == "failed"
    assert kwargs["error_message"] == "文档处理失败，请检查文档格式、向量模型配置和本地存储后重试"


@pytest.mark.asyncio
async def test_get_document_status_raises_when_not_found():
    with patch(
        "app.services.knowledge_service.knowledge_repository.get_document",
        AsyncMock(return_value=None),
    ):
        with pytest.raises(KnowledgeBaseError, match="文档不存在"):
            await knowledge_service.get_document_status(1, "doc_missing")


@pytest.mark.asyncio
async def test_get_document_status_returns_data_when_found():
    row = {
        "doc_id": "doc_1",
        "file_name": "a.txt",
        "status": "ready",
        "chunk_count": 3,
        "error_message": None,
    }
    with patch(
        "app.services.knowledge_service.knowledge_repository.get_document",
        AsyncMock(return_value=row),
    ):
        result = await knowledge_service.get_document_status(1, "doc_1")

    assert result.doc_id == "doc_1"
    assert result.status == "ready"
    assert result.chunk_count == 3


@pytest.mark.asyncio
async def test_get_document_content_raises_when_not_found():
    with patch(
        "app.services.knowledge_service.knowledge_repository.get_document",
        AsyncMock(return_value=None),
    ):
        with pytest.raises(KnowledgeBaseError, match="文档不存在"):
            await knowledge_service.get_document_content(1, "doc_missing")


@pytest.mark.asyncio
async def test_get_document_content_raises_when_file_missing(tmp_path):
    row = {"doc_id": "doc_1", "file_name": "a.txt", "file_type": "txt"}
    settings = _patch_settings(kb_upload_dir=str(tmp_path))

    with patch("app.services.knowledge_service.get_settings", return_value=settings), patch(
        "app.services.knowledge_service.knowledge_repository.get_document",
        AsyncMock(return_value=row),
    ):
        with pytest.raises(KnowledgeBaseError, match="原始文件已丢失"):
            await knowledge_service.get_document_content(1, "doc_1")


@pytest.mark.asyncio
async def test_get_document_content_returns_contiguous_text(tmp_path):
    row = {"doc_id": "doc_1", "file_name": "a.md", "file_type": "md"}
    content = "# 标题\n\n正文内容。"
    (tmp_path / "doc_1.md").write_text(content, encoding="utf-8")
    settings = _patch_settings(kb_upload_dir=str(tmp_path))

    with patch("app.services.knowledge_service.get_settings", return_value=settings), patch(
        "app.services.knowledge_service.knowledge_repository.get_document",
        AsyncMock(return_value=row),
    ):
        result = await knowledge_service.get_document_content(1, "doc_1")

    assert result.text == content
    assert result.media_type == "text/markdown"
    assert result.character_count == len(content)
    assert result.byte_size == len(content.encode("utf-8"))


@pytest.mark.asyncio
async def test_get_document_content_rejects_blank_text(tmp_path):
    row = {"doc_id": "doc_1", "file_name": "a.txt", "file_type": "txt"}
    (tmp_path / "doc_1.txt").write_text("   \n  ", encoding="utf-8")
    settings = _patch_settings(kb_upload_dir=str(tmp_path))

    with patch("app.services.knowledge_service.get_settings", return_value=settings), patch(
        "app.services.knowledge_service.knowledge_repository.get_document",
        AsyncMock(return_value=row),
    ):
        with pytest.raises(KnowledgeBaseError, match="未提取到任何文字内容"):
            await knowledge_service.get_document_content(1, "doc_1")


@pytest.mark.asyncio
async def test_get_document_content_wraps_load_failure(tmp_path):
    row = {"doc_id": "doc_1", "file_name": "a.txt", "file_type": "txt"}
    (tmp_path / "doc_1.txt").write_text("content", encoding="utf-8")
    settings = _patch_settings(kb_upload_dir=str(tmp_path))

    with patch("app.services.knowledge_service.get_settings", return_value=settings), patch(
        "app.services.knowledge_service.knowledge_repository.get_document",
        AsyncMock(return_value=row),
    ), patch(
        "app.services.knowledge_service.document_loader_service.load_text",
        MagicMock(side_effect=ValueError("不支持的文件格式: xlsx")),
    ):
        with pytest.raises(KnowledgeBaseError, match="文档解析失败"):
            await knowledge_service.get_document_content(1, "doc_1")


@pytest.mark.asyncio
async def test_delete_document_raises_when_not_found():
    with patch(
        "app.services.knowledge_service.knowledge_repository.get_document",
        AsyncMock(return_value=None),
    ):
        with pytest.raises(KnowledgeBaseError, match="文档不存在"):
            await knowledge_service.delete_document(1, "doc_missing")


@pytest.mark.asyncio
async def test_delete_document_success_cascades(tmp_path):
    row = {"doc_id": "doc_1", "file_name": "a.txt", "file_type": "txt", "status": "ready"}
    file_path = tmp_path / "doc_1.txt"
    file_path.write_text("content")

    settings = _patch_settings(kb_upload_dir=str(tmp_path))
    delete_vectors_mock = MagicMock()
    delete_db_mock = AsyncMock()

    with patch("app.services.knowledge_service.get_settings", return_value=settings), patch(
        "app.services.knowledge_service.knowledge_repository.get_document",
        AsyncMock(return_value=row),
    ), patch(
        "app.services.knowledge_service.vector_store_service.delete_document_vectors",
        delete_vectors_mock,
    ), patch(
        "app.services.knowledge_service.knowledge_repository.delete_document",
        delete_db_mock,
    ):
        await knowledge_service.delete_document(1, "doc_1")

    delete_vectors_mock.assert_called_once_with(1, "doc_1")
    delete_db_mock.assert_called_once_with("doc_1", 1)
    assert not file_path.exists()


@pytest.mark.asyncio
async def test_delete_document_preserves_metadata_and_file_on_vector_failure(tmp_path):
    row = {"doc_id": "doc_1", "file_name": "a.txt", "file_type": "txt", "status": "ready"}
    file_path = tmp_path / "doc_1.txt"
    file_path.write_text("content")

    settings = _patch_settings(kb_upload_dir=str(tmp_path))
    delete_db_mock = AsyncMock()

    with patch("app.services.knowledge_service.get_settings", return_value=settings), patch(
        "app.services.knowledge_service.knowledge_repository.get_document",
        AsyncMock(return_value=row),
    ), patch(
        "app.services.knowledge_service.vector_store_service.delete_document_vectors",
        side_effect=RuntimeError("chroma unavailable"),
    ), patch(
        "app.services.knowledge_service.knowledge_repository.delete_document",
        delete_db_mock,
    ):
        with pytest.raises(KnowledgeBaseError, match="向量删除失败.*重试"):
            await knowledge_service.delete_document(1, "doc_1")

    delete_db_mock.assert_not_awaited()
    assert file_path.exists()


@pytest.mark.asyncio
async def test_embedding_auth_failure_has_actionable_message():
    error = RuntimeError("provider rejected credentials")
    error.status_code = 401
    with (
        patch("app.services.knowledge_service.document_loader_service.load_and_split", return_value=[Document(page_content="test")]),
        patch("app.services.knowledge_service.vector_store_service.add_document_chunks", side_effect=error),
        patch("app.services.knowledge_service.knowledge_repository.update_document_status", new_callable=AsyncMock) as update,
    ):
        await knowledge_service._process_document("doc_1", 1, "/tmp/test.txt", "txt")
        assert update.await_args.args == ("doc_1", "failed")
        assert "DASHSCOPE_API_KEY" in update.await_args.kwargs["error_message"]


@pytest.mark.asyncio
@pytest.mark.parametrize('failure_stage', ['file', 'database'])
async def test_delete_failure_preserves_record_and_retry_finishes(database, tmp_path, monkeypatch, failure_stage):
    import sqlite3
    from app.core.config import get_settings
    from app.repositories import knowledge_repository, user_repository

    uid = (await user_repository.create_user('delete-retry'))['id']
    await knowledge_repository.create_document('doc_retry', uid, 'a.txt', 'txt', 7)
    await knowledge_repository.update_document_status('doc_retry', 'ready', 1)
    monkeypatch.setattr(get_settings(), 'kb_upload_dir', str(tmp_path))
    original = tmp_path / 'doc_retry.txt'
    original.write_text('content')
    vectors = {'doc_retry'}
    def delete_vectors(user_id, doc_id):
        vectors.discard(doc_id)  # Simulates the vector store's idempotent deletion.
    monkeypatch.setattr(knowledge_service.vector_store_service, 'delete_document_vectors', delete_vectors)

    if failure_stage == 'database':
        with sqlite3.connect(database) as conn:
            conn.execute("CREATE TRIGGER reject_delete BEFORE DELETE ON kb_documents BEGIN SELECT RAISE(ABORT, 'private database failure'); END")
        with pytest.raises(KnowledgeBaseError, match='^文档记录删除失败，请检查本地存储后重试删除$'):
            await knowledge_service.delete_document(uid, 'doc_retry')
        assert not original.exists()
        with sqlite3.connect(database) as conn:
            conn.execute('DROP TRIGGER reject_delete')
    else:
        with patch('app.services.knowledge_service.os.remove', side_effect=PermissionError('private path')):
            with pytest.raises(KnowledgeBaseError, match='^文档原始文件删除失败，请检查本地存储后重试删除$'):
                await knowledge_service.delete_document(uid, 'doc_retry')
        assert original.exists()

    assert await knowledge_repository.get_document('doc_retry', uid) is not None
    assert not vectors
    await knowledge_service.delete_document(uid, 'doc_retry')
    assert await knowledge_repository.get_document('doc_retry', uid) is None
    assert not original.exists()
    assert not vectors


@pytest.mark.asyncio
async def test_delete_processing_document_rejected_before_cleanup(database, tmp_path, monkeypatch):
    from app.core.config import get_settings
    from app.repositories import knowledge_repository, user_repository

    uid = (await user_repository.create_user('delete-processing'))['id']
    await knowledge_repository.create_document('doc_busy', uid, 'a.txt', 'txt', 7)
    monkeypatch.setattr(get_settings(), 'kb_upload_dir', str(tmp_path))
    original = tmp_path / 'doc_busy.txt'
    original.write_text('content')
    with patch('app.services.knowledge_service.vector_store_service.delete_document_vectors') as vectors:
        with pytest.raises(KnowledgeBaseError, match='正在处理中'):
            await knowledge_service.delete_document(uid, 'doc_busy')
        vectors.assert_not_called()
    assert original.read_text() == 'content'
    assert (await knowledge_repository.get_document('doc_busy', uid))['status'] == 'processing'
