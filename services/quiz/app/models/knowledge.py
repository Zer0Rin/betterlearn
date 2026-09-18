"""知识库文档相关数据模型"""

from typing import Literal, Optional
from pydantic import BaseModel


class KnowledgeUploadResponse(BaseModel):
    """上传文档后的响应"""
    doc_id: str
    file_name: str
    status: Literal["uploaded", "processing", "ready", "failed"]


class KnowledgeDocumentItem(BaseModel):
    """知识库文档列表项"""
    doc_id: str
    file_name: str
    file_type: str
    file_size: int
    status: Literal["uploaded", "processing", "ready", "failed"]
    chunk_count: int
    error_message: Optional[str] = None
    created_at: str


class KnowledgeListResponse(BaseModel):
    """知识库文档列表响应"""
    items: list[KnowledgeDocumentItem]


class KnowledgeStatusResponse(BaseModel):
    """文档状态查询响应"""
    doc_id: str
    file_name: str
    status: Literal["uploaded", "processing", "ready", "failed"]
    chunk_count: int
    error_message: Optional[str] = None


class KnowledgeContentResponse(BaseModel):
    """文档连续正文响应（用于导出给外部提取器）"""
    doc_id: str
    file_name: str
    file_type: str
    media_type: Literal["text/plain", "text/markdown"]
    text: str
    character_count: int
    byte_size: int
