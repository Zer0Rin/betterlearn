"""知识库文档业务服务：上传、解析、状态查询、删除"""

from __future__ import annotations

import asyncio
import os
import uuid

import structlog

from app.core.config import get_settings
from app.core.exceptions import KnowledgeBaseError, KnowledgeDocumentNotFound
from app.models.knowledge import (
    KnowledgeContentResponse,
    KnowledgeDocumentItem,
    KnowledgeListResponse,
    KnowledgeStatusResponse,
    KnowledgeUploadResponse,
)
from app.repositories import knowledge_repository
from app.services import document_loader_service, vector_store_service

logger = structlog.get_logger()

SUPPORTED_EXTENSIONS = {"pdf", "docx", "md", "txt"}


def _get_extension(filename: str) -> str:
    _, ext = os.path.splitext(filename)
    return ext.lstrip(".").lower()


async def handle_upload(user_id: int, filename: str, content: bytes) -> KnowledgeUploadResponse:
    """校验并保存上传的文档，后台异步解析处理"""
    settings = get_settings()

    file_type = _get_extension(filename)
    if file_type not in SUPPORTED_EXTENSIONS:
        raise KnowledgeBaseError(
            f"不支持的文件格式：{file_type or '未知'}，仅支持 PDF/Word/Markdown/文本文件"
        )

    max_size_bytes = settings.kb_max_file_size_mb * 1024 * 1024
    if len(content) > max_size_bytes:
        raise KnowledgeBaseError(f"文件大小超过限制（最大 {settings.kb_max_file_size_mb}MB）")

    existing_count = await knowledge_repository.count_documents(user_id)
    if existing_count >= settings.kb_max_documents_per_user:
        raise KnowledgeBaseError(
            f"知识库文档数量已达上限（最多 {settings.kb_max_documents_per_user} 篇），请先删除部分文档"
        )

    doc_id = f"doc_{uuid.uuid4().hex[:12]}"

    os.makedirs(settings.kb_upload_dir, exist_ok=True)
    file_path = os.path.join(settings.kb_upload_dir, f"{doc_id}.{file_type}")
    with open(file_path, "wb") as f:
        f.write(content)

    await knowledge_repository.create_document(
        doc_id=doc_id,
        user_id=user_id,
        file_name=filename,
        file_type=file_type,
        file_size=len(content),
    )

    asyncio.create_task(_process_document(doc_id, user_id, file_path, file_type))

    return KnowledgeUploadResponse(doc_id=doc_id, file_name=filename, status="processing")


async def _process_document(doc_id: str, user_id: int, file_path: str, file_type: str) -> None:
    """后台异步解析文档：加载分块 -> 向量化写入 -> 更新状态"""
    try:
        logger.info("kb_document_processing_started", doc_id=doc_id, user_id=user_id)

        chunks = await asyncio.to_thread(document_loader_service.load_and_split, file_path, file_type)
        if not chunks:
            raise KnowledgeBaseError("文档解析后未提取到任何内容")

        chunk_count = await asyncio.to_thread(vector_store_service.add_document_chunks, user_id, doc_id, chunks)

        await knowledge_repository.update_document_status(
            doc_id, "ready", chunk_count=chunk_count
        )
        logger.info(
            "kb_document_processing_completed", doc_id=doc_id, user_id=user_id, chunk_count=chunk_count
        )
    except Exception as e:
        logger.error("kb_document_processing_failed", doc_id=doc_id, user_id=user_id, error_type=type(e).__name__)
        message = str(e) if isinstance(e, KnowledgeBaseError) else "文档处理失败，请检查文档格式、向量模型配置和本地存储后重试"
        if getattr(e, "status_code", None) == 401:
            message = "向量模型授权失败（401）。请检查 quiz.env 中的 DASHSCOPE_API_KEY 与 DASHSCOPE_BASE_URL，重启 BetterLearn后重新上传文档。"
        await knowledge_repository.update_document_status(
            doc_id, "failed", error_message=message
        )


async def list_documents(user_id: int) -> KnowledgeListResponse:
    rows = await knowledge_repository.list_documents(user_id)
    items = [KnowledgeDocumentItem.model_validate(row) for row in rows]
    return KnowledgeListResponse(items=items)


async def get_document_status(user_id: int, doc_id: str) -> KnowledgeStatusResponse:
    row = await knowledge_repository.get_document(doc_id, user_id)
    if row is None:
        raise KnowledgeBaseError("文档不存在")
    return KnowledgeStatusResponse(
        doc_id=row["doc_id"],
        file_name=row["file_name"],
        status=row["status"],
        chunk_count=row["chunk_count"],
        error_message=row.get("error_message"),
    )


async def get_document_content(user_id: int, doc_id: str) -> KnowledgeContentResponse:
    """读取文档的连续正文

    做法是按上传时的路径约定重新解析原始文件，而不是拼接向量库里的分块：
    分块经过语义切分，拼接后字符偏移量与原文对不上，外部工具基于偏移量的
    逐字引用校验会失败。
    """
    row = await knowledge_repository.get_document(doc_id, user_id)
    if row is None:
        raise KnowledgeDocumentNotFound("文档不存在")

    settings = get_settings()
    file_path = os.path.join(settings.kb_upload_dir, f"{doc_id}.{row['file_type']}")
    if not os.path.exists(file_path):
        raise KnowledgeDocumentNotFound("原始文件已丢失，无法读取正文，请删除后重新上传该文档")

    try:
        text = await asyncio.to_thread(
            document_loader_service.load_text, file_path, row["file_type"]
        )
    except Exception as e:
        logger.error("kb_document_content_failed", doc_id=doc_id, user_id=user_id, error_type=type(e).__name__)
        raise KnowledgeBaseError("文档解析失败，请检查文件是否完整及格式是否受支持") from None

    if not text.strip():
        raise KnowledgeBaseError("文档解析后未提取到任何文字内容")

    file_type = row["file_type"]
    return KnowledgeContentResponse(
        doc_id=doc_id,
        file_name=row["file_name"],
        file_type=file_type,
        media_type="text/markdown" if file_type == "md" else "text/plain",
        text=text,
        character_count=len(text),
        byte_size=len(text.encode("utf-8")),
    )


async def delete_document(user_id: int, doc_id: str) -> None:
    """先清理向量和原始文件，最后删除记录；失败保留记录以便重试。"""
    row = await knowledge_repository.get_document(doc_id, user_id)
    if row is None:
        raise KnowledgeBaseError("文档不存在")
    if row["status"] == "processing":
        raise KnowledgeBaseError("文档正在处理中，请等待处理结束后再删除")

    settings = get_settings()

    try:
        await asyncio.to_thread(vector_store_service.delete_document_vectors, user_id, doc_id)
    except Exception as e:
        logger.warning("kb_document_vector_delete_failed", doc_id=doc_id, error_type=type(e).__name__)
        raise KnowledgeBaseError("文档向量删除失败，请重试删除") from None

    try:
        file_path = os.path.join(settings.kb_upload_dir, f"{doc_id}.{row['file_type']}")
        try:
            os.remove(file_path)
        except FileNotFoundError:
            pass  # A previous attempt may already have removed the original file.
    except Exception as e:
        logger.warning("kb_document_file_delete_failed", doc_id=doc_id, error_type=type(e).__name__)
        raise KnowledgeBaseError("文档原始文件删除失败，请检查本地存储后重试删除") from None

    try:
        await knowledge_repository.delete_document(doc_id, user_id)
    except Exception as e:
        logger.warning("kb_document_db_delete_failed", doc_id=doc_id, error_type=type(e).__name__)
        raise KnowledgeBaseError("文档记录删除失败，请检查本地存储后重试删除") from None
