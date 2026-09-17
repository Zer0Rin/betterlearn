"""向量存储服务 - 基于 Chroma 的知识库向量检索"""

from __future__ import annotations

import threading
from functools import lru_cache
from typing import Optional

import structlog
from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings

from app.core.config import get_settings

logger = structlog.get_logger()

_chroma_clients: dict[str, object] = {}
_chroma_client_lock = threading.Lock()


def get_chroma_client(persist_dir: str):
    """获取进程内共享的 Chroma 持久化客户端（按目录缓存，线程安全）

    Chroma 1.5.x 的 PersistentClient 在初始化时会读取/写入 tenant、database 等元数据，
    并发创建多个指向同一目录的客户端会互相竞争，抛
    "Could not connect to tenant default_tenant. Are you sure it exists?"。

    RAG Agent 会并行发起多个 search_knowledge_base 工具调用（LangGraph 把同一条
    AIMessage 里的多个 tool_call 并发执行），每次调用都新建客户端就会撞上这个竞争，
    表现为 kb_retrieval_failed error='Connection error.'，最终被上层判成
    "知识库检索未获取到有效文档内容"。因此同一目录全进程复用一个客户端。

    按目录作缓存键（而非单例），测试里 monkeypatch 出来的临时目录才能各自独立。
    """
    with _chroma_client_lock:
        client = _chroma_clients.get(persist_dir)
        if client is None:
            import chromadb
            from chromadb.config import Settings

            client = chromadb.PersistentClient(
                path=persist_dir,
                settings=Settings(anonymized_telemetry=False),
            )
            _chroma_clients[persist_dir] = client
        return client


@lru_cache
def get_embeddings() -> Embeddings:
    """获取百炼 text-embedding-v4 Embedding 实例（OpenAI 兼容模式）

    check_embedding_ctx_length=False：禁用 langchain_openai 默认的 tiktoken 分词/截断行为。
    该行为会把文本先编码成 token id 数组再发送，而非 OpenAI 官方模型的服务端（如 DashScope
    兼容模式端点）无法识别 token id 数组，会报 "contents is neither str nor list of str" 错误。

    chunk_size=10：DashScope 兼容模式对单次请求的 batch size 上限为 10 条，
    而 langchain_openai 默认按 1000 条分批，文档分块数超过 10 时会报
    "batch size is invalid, it should not be larger than 10"。这里按上限分批。
    """
    from langchain_openai import OpenAIEmbeddings

    settings = get_settings()
    return OpenAIEmbeddings(
        model=settings.dashscope_embedding_model,
        base_url=settings.dashscope_base_url,
        api_key=settings.dashscope_api_key,
        check_embedding_ctx_length=False,
        chunk_size=10,
    )


def get_user_vector_store(user_id: int, embeddings: Optional[Embeddings] = None):
    """获取指定用户的 Chroma 向量库实例（每用户一个 collection）"""
    from langchain_chroma import Chroma

    settings = get_settings()
    return Chroma(
        collection_name=f"kb_user_{user_id}",
        embedding_function=embeddings or get_embeddings(),
        client=get_chroma_client(settings.chroma_persist_dir),
    )


def add_document_chunks(
    user_id: int,
    doc_id: str,
    chunks: list[Document],
    embeddings: Optional[Embeddings] = None,
) -> int:
    """将文档分块写入用户向量库，返回写入的分块数量"""
    if not chunks:
        return 0

    vector_store = get_user_vector_store(user_id, embeddings=embeddings)

    for chunk in chunks:
        chunk.metadata = {
            **chunk.metadata,
            "doc_id": doc_id,
            "user_id": user_id,
        }

    ids = vector_store.add_documents(documents=chunks)
    logger.info("document_chunks_added", user_id=user_id, doc_id=doc_id, chunk_count=len(ids))
    return len(ids)


def delete_document_vectors(
    user_id: int,
    doc_id: str,
    embeddings: Optional[Embeddings] = None,
) -> None:
    """从用户向量库中删除指定文档的所有向量"""
    vector_store = get_user_vector_store(user_id, embeddings=embeddings)
    vector_store.delete(where={"doc_id": doc_id})
    logger.info("document_vectors_deleted", user_id=user_id, doc_id=doc_id)


def similarity_search(
    user_id: int,
    doc_id: str,
    query: str,
    k: Optional[int] = None,
    embeddings: Optional[Embeddings] = None,
) -> list[Document]:
    """在用户向量库中检索指定文档的相关分块"""
    settings = get_settings()
    k = k or settings.kb_retrieve_top_k

    vector_store = get_user_vector_store(user_id, embeddings=embeddings)
    return vector_store.similarity_search(query, k=k, filter={"doc_id": doc_id})
