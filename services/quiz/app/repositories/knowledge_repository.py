"""知识库文档数据访问层"""

from __future__ import annotations

from typing import Optional

import structlog

from app.core.db import transaction, format_timestamp

logger = structlog.get_logger()


async def create_document(
    doc_id: str,
    user_id: int,
    file_name: str,
    file_type: str,
    file_size: int,
) -> None:
    with transaction() as cur:
        cur.execute(
            "INSERT INTO kb_documents (doc_id, user_id, file_name, file_type, file_size, status) "
            "VALUES (?, ?, ?, ?, ?, 'uploaded')",
            (doc_id, user_id, file_name, file_type, file_size),
        )


async def update_document_status(
    doc_id: str,
    status: str,
    chunk_count: Optional[int] = None,
    error_message: Optional[str] = None,
) -> None:
    with transaction() as cur:
        cur.execute(
            "UPDATE kb_documents SET status = ?, chunk_count = ?, error_message = ? WHERE doc_id = ?",
            (status, chunk_count or 0, error_message, doc_id),
        )


async def get_document(doc_id: str, user_id: int) -> Optional[dict]:
    """获取文档详情，仅当文档属于该用户时返回。"""
    with transaction() as cur:
        cur.execute(
            "SELECT doc_id, user_id, file_name, file_type, file_size, status, "
            "chunk_count, error_message, created_at "
            "FROM kb_documents WHERE doc_id = ? AND user_id = ?",
            (doc_id, user_id),
        )
        row = cur.fetchone()
        if row is None:
            return None
        return {
            "doc_id": row[0],
            "user_id": row[1],
            "file_name": row[2],
            "file_type": row[3],
            "file_size": row[4],
            "status": row[5],
            "chunk_count": row[6],
            "error_message": row[7],
            "created_at": format_timestamp(row[8]),
        }


async def list_documents(user_id: int) -> list[dict]:
    with transaction() as cur:
        cur.execute(
            "SELECT doc_id, file_name, file_type, file_size, status, "
            "chunk_count, error_message, created_at "
            "FROM kb_documents WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,),
        )
        rows = cur.fetchall()
        return [
            {
                "doc_id": r[0],
                "file_name": r[1],
                "file_type": r[2],
                "file_size": r[3],
                "status": r[4],
                "chunk_count": r[5],
                "error_message": r[6],
                "created_at": format_timestamp(r[7]),
            }
            for r in rows
        ]


async def count_documents(user_id: int) -> int:
    with transaction() as cur:
        cur.execute(
            "SELECT COUNT(*) FROM kb_documents WHERE user_id = ?",
            (user_id,),
        )
        row = cur.fetchone()
        return row[0] if row else 0


async def delete_document(doc_id: str, user_id: int) -> None:
    with transaction() as cur:
        cur.execute(
            "DELETE FROM kb_documents WHERE doc_id = ? AND user_id = ?",
            (doc_id, user_id),
        )


async def claim_vectorization(doc_id: str, user_id: int) -> bool:
    """Only a never-started document can launch a paid job, even on request replay."""
    with transaction() as cur:
        cur.execute("UPDATE kb_documents SET status='processing', error_message=NULL "
                    "WHERE doc_id=? AND user_id=? AND status='uploaded'", (doc_id, user_id))
        return cur.rowcount == 1
