"""出题路由"""

from typing import Optional

from fastapi import APIRouter, Depends, Request, Path

from app.core.auth import get_optional_user, get_current_user
from app.models.common import ApiResponse
from app.models.quiz import QuizGenerateRequest
from app.models.source_generation import SourceGenerateRequest
from app.services.quiz_service import (
    handle_quiz_generate,
    create_quiz_task,
    get_quiz_task_status,
)

router = APIRouter(prefix="/quiz", tags=["quiz"])


@router.post("/generate", response_model=ApiResponse)
async def quiz_generate(
    req: QuizGenerateRequest,
    user_id: Optional[int] = Depends(get_optional_user),
):
    result = await handle_quiz_generate(req, user_id=user_id)
    return ApiResponse.success(data=result.model_dump())


@router.post("/generate/async", response_model=ApiResponse)
async def quiz_generate_async(
    req: QuizGenerateRequest,
    user_id: Optional[int] = Depends(get_optional_user),
):
    """异步创建出题任务，立即返回 task_id"""
    result = await create_quiz_task(req, user_id=user_id)
    return ApiResponse.success(data=result.model_dump())


@router.get("/task/{task_id}", response_model=ApiResponse)
async def quiz_task_status(task_id: str, user_id: Optional[int] = Depends(get_optional_user)):
    """轮询查询任务状态"""
    from app.repositories.source_generation_repository import check_status_owner
    await check_status_owner(task_id, user_id)
    result = await get_quiz_task_status(task_id)
    return ApiResponse.success(data=result.model_dump())


@router.post('/generate/from-source', response_model=ApiResponse)
async def generate_from_source(req: SourceGenerateRequest, request: Request, user_id: int = Depends(get_current_user)):
    from app.api.v1.routes.user import _require_managed_host
    from app.services import source_generation
    _require_managed_host(request)
    result = await source_generation.create(req, user_id)
    return ApiResponse.success(data=result.model_dump())


@router.get('/source-request/{request_id}', response_model=ApiResponse)
async def source_request(request: Request, request_id: str = Path(pattern=r'^[A-Za-z0-9_-]{1,100}$'),
                         user_id: int = Depends(get_current_user)):
    from app.api.v1.routes.user import _require_managed_host
    from app.repositories.source_generation_repository import lookup
    _require_managed_host(request)
    return ApiResponse.success(data=await lookup(user_id, request_id))
