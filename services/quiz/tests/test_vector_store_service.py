"""vector_store_service 单元测试（使用确定性伪 Embedding + 真实 Chroma 临时目录）"""

import pytest
from langchain_core.documents import Document
from langchain_core.embeddings import DeterministicFakeEmbedding

from app.services import vector_store_service


@pytest.fixture
def fake_embeddings():
    return DeterministicFakeEmbedding(size=64)


@pytest.fixture
def persist_dir(tmp_path, monkeypatch):
    dir_path = tmp_path / "chroma"
    monkeypatch.setattr(
        vector_store_service.get_settings(), "chroma_persist_dir", str(dir_path)
    )
    return str(dir_path)


def _make_chunks(text_variants):
    return [Document(page_content=text, metadata={}) for text in text_variants]


def test_add_document_chunks_returns_count(persist_dir, fake_embeddings):
    chunks = _make_chunks(["苹果是一种水果", "香蕉是一种水果"])

    count = vector_store_service.add_document_chunks(
        user_id=1, doc_id="doc-a", chunks=chunks, embeddings=fake_embeddings
    )

    assert count == 2


def test_add_document_chunks_empty_list_returns_zero(persist_dir, fake_embeddings):
    count = vector_store_service.add_document_chunks(
        user_id=1, doc_id="doc-a", chunks=[], embeddings=fake_embeddings
    )
    assert count == 0


def test_delete_all_allows_new_embedding_dimensions_without_key(persist_dir, monkeypatch):
    old = DeterministicFakeEmbedding(size=3)
    new = DeterministicFakeEmbedding(size=2)
    vector_store_service.add_document_chunks(1, "old", _make_chunks(["旧文档"]), old)

    def no_key():
        raise AssertionError("Deleting stored vectors must not need an API key")

    monkeypatch.setattr(vector_store_service, "get_embeddings", no_key)
    vector_store_service.delete_document_vectors(1, "old")
    # Retry after a later file/metadata deletion failure must remain safe.
    vector_store_service.delete_document_vectors(1, "old")
    assert vector_store_service.add_document_chunks(1, "new", _make_chunks(["新文档"]), new) == 1
    results = vector_store_service.similarity_search(1, "new", "新文档", embeddings=new)
    assert [item.page_content for item in results] == ["新文档"]


def test_similarity_search_filters_by_doc_id(persist_dir, fake_embeddings):
    chunks_a = _make_chunks(["文档A讲的是猫", "文档A讲的是狗"])
    chunks_b = _make_chunks(["文档B讲的是汽车", "文档B讲的是飞机"])

    vector_store_service.add_document_chunks(
        user_id=1, doc_id="doc-a", chunks=chunks_a, embeddings=fake_embeddings
    )
    vector_store_service.add_document_chunks(
        user_id=1, doc_id="doc-b", chunks=chunks_b, embeddings=fake_embeddings
    )

    results = vector_store_service.similarity_search(
        user_id=1, doc_id="doc-a", query="猫", k=5, embeddings=fake_embeddings
    )

    assert len(results) == 2
    assert all(r.metadata["doc_id"] == "doc-a" for r in results)


def test_similarity_search_isolates_users(persist_dir, fake_embeddings):
    chunks_user1 = _make_chunks(["用户1的私有内容"])
    chunks_user2 = _make_chunks(["用户2的私有内容"])

    vector_store_service.add_document_chunks(
        user_id=1, doc_id="doc-shared-id", chunks=chunks_user1, embeddings=fake_embeddings
    )
    vector_store_service.add_document_chunks(
        user_id=2, doc_id="doc-shared-id", chunks=chunks_user2, embeddings=fake_embeddings
    )

    results_user1 = vector_store_service.similarity_search(
        user_id=1, doc_id="doc-shared-id", query="内容", k=5, embeddings=fake_embeddings
    )

    assert len(results_user1) == 1
    assert results_user1[0].page_content == "用户1的私有内容"


def test_delete_document_vectors_removes_only_target_doc(persist_dir, fake_embeddings):
    chunks_a = _make_chunks(["要删除的文档内容"])
    chunks_b = _make_chunks(["保留的文档内容"])

    vector_store_service.add_document_chunks(
        user_id=1, doc_id="doc-del", chunks=chunks_a, embeddings=fake_embeddings
    )
    vector_store_service.add_document_chunks(
        user_id=1, doc_id="doc-keep", chunks=chunks_b, embeddings=fake_embeddings
    )

    vector_store_service.delete_document_vectors(
        user_id=1, doc_id="doc-del", embeddings=fake_embeddings
    )

    results_deleted = vector_store_service.similarity_search(
        user_id=1, doc_id="doc-del", query="内容", k=5, embeddings=fake_embeddings
    )
    results_kept = vector_store_service.similarity_search(
        user_id=1, doc_id="doc-keep", query="内容", k=5, embeddings=fake_embeddings
    )

    assert len(results_deleted) == 0
    assert len(results_kept) == 1


def test_get_embeddings_uses_dashscope_compatible_limits(monkeypatch):
    """百炼兼容模式对 batch size 有上限，chunk_size 必须不大于 10。

    回归保护：默认 chunk_size=1000 时，分块数超过 10 的文档会报
    "batch size is invalid, it should not be larger than 10"。
    """
    settings = vector_store_service.get_settings().model_copy(update={"dashscope_api_key": "test-embedding-key"})
    monkeypatch.setattr(vector_store_service, "get_settings", lambda: settings)
    vector_store_service.get_embeddings.cache_clear()
    try:
        embeddings = vector_store_service.get_embeddings()
        assert embeddings.chunk_size <= 10
        assert embeddings.check_embedding_ctx_length is False
        assert embeddings.model == vector_store_service.get_settings().dashscope_embedding_model
    finally:
        vector_store_service.get_embeddings.cache_clear()


def test_vector_stores_share_one_chroma_client_per_directory(persist_dir, fake_embeddings):
    """回归保护：同一目录下必须复用同一个 Chroma 客户端。

    RAG Agent 会并行发起多个 search_knowledge_base 工具调用，各自调用
    get_user_vector_store()。Chroma 1.5.x 每次新建 PersistentClient 都要读写
    tenant/database 元数据，并发时会竞争并抛
    "Could not connect to tenant default_tenant"（或直接卡死），
    表现为知识库检索整体失败。因此客户端必须按目录共享、且只创建一次。
    """
    first = vector_store_service.get_user_vector_store(1, embeddings=fake_embeddings)
    second = vector_store_service.get_user_vector_store(1, embeddings=fake_embeddings)

    assert first._client is second._client, "同一目录下重复创建了 Chroma 客户端"
    assert first._client is vector_store_service.get_chroma_client(persist_dir)


def test_different_directories_get_different_chroma_clients(tmp_path, monkeypatch, fake_embeddings):
    """按目录缓存，不能退化成全局单例（否则测试之间会互相污染）"""
    dir_a, dir_b = tmp_path / "a", tmp_path / "b"
    settings = vector_store_service.get_settings()

    monkeypatch.setattr(settings, "chroma_persist_dir", str(dir_a))
    client_a = vector_store_service.get_user_vector_store(1, embeddings=fake_embeddings)._client

    monkeypatch.setattr(settings, "chroma_persist_dir", str(dir_b))
    client_b = vector_store_service.get_user_vector_store(1, embeddings=fake_embeddings)._client

    assert client_a is not client_b
