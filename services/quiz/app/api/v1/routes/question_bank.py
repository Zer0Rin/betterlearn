"""Owned question inventory; writes organize entries but cannot alter scores."""
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from app.core.auth import get_current_user
from app.models.common import ApiResponse
from app.models.question_bank import BankQuery, BookmarkUpdate, CategoryName
from app.models.question_source import SourceUpdate
from app.models.knowledge_stats import KnowledgeStatsQuery, KnowledgeHistoryQuery, KnowledgeAssessmentQuery
from app.repositories import knowledge_stats_repository as knowledge_stats
from app.repositories import question_bank_repository as bank

router = APIRouter(prefix='/question-bank', tags=['question-bank'])
User = Annotated[int, Depends(get_current_user)]
Id = Annotated[int, Path(ge=1, le=9223372036854775807)]


@router.get('/entries')
async def entries(user_id: User, query: Annotated[BankQuery, Query()]):
    return ApiResponse.success(data=await bank.list_entries(user_id, query))


@router.get('/stats')
async def stats(user_id: User):
    return ApiResponse.success(data=await bank.stats(user_id))


@router.get('/entries/{entry_id}')
async def detail(user_id: User, entry_id: Id):
    return ApiResponse.success(data=await bank.get_entry(user_id, entry_id))


@router.get('/entries/{entry_id}/history')
async def history(user_id: User, entry_id: Id, page: int = Query(1, ge=1, le=1000000), page_size: int = Query(20, ge=1, le=100)):
    return ApiResponse.success(data=await bank.history(user_id, entry_id, page, page_size))


@router.put('/entries/{entry_id}')
async def bookmark(user_id: User, entry_id: Id, req: BookmarkUpdate):
    return ApiResponse.success(data=await bank.bookmark(user_id, entry_id, req.bookmarked))


@router.get('/categories')
async def categories(user_id: User):
    return ApiResponse.success(data={'items': await bank.list_categories(user_id)})


@router.post('/categories')
async def create_category(user_id: User, req: CategoryName):
    return ApiResponse.success(data=await bank.save_category(user_id, req.name))


@router.put('/categories/{category_id}')
async def rename_category(user_id: User, category_id: Id, req: CategoryName):
    return ApiResponse.success(data=await bank.save_category(user_id, req.name, category_id))


@router.delete('/categories/{category_id}')
async def delete_category(user_id: User, category_id: Id):
    return ApiResponse.success(data=await bank.delete_category(user_id, category_id))


@router.put('/entries/{entry_id}/categories/{category_id}')
async def link_category(user_id: User, entry_id: Id, category_id: Id):
    return ApiResponse.success(data=await bank.categorize(user_id, entry_id, category_id, True))


@router.delete('/entries/{entry_id}/categories/{category_id}')
async def unlink_category(user_id: User, entry_id: Id, category_id: Id):
    return ApiResponse.success(data=await bank.categorize(user_id, entry_id, category_id, False))


@router.get('/entries/{entry_id}/source')
async def source_detail(user_id: User, entry_id: Id):
    from app.repositories.question_source_repository import get_source
    return ApiResponse.success(data=await get_source(user_id, entry_id))


@router.put('/entries/{entry_id}/source')
async def source_update(user_id: User, entry_id: Id, req: SourceUpdate, request: Request):
    from app.api.v1.routes.user import _require_managed_host
    from app.repositories.question_source_repository import update_source
    _require_managed_host(request)
    return ApiResponse.success(data=await update_source(user_id, entry_id, req))


@router.get('/knowledge-stats')
async def knowledge_statistics(user_id: User, query: Annotated[KnowledgeStatsQuery, Query()]):
    return ApiResponse.success(data=await knowledge_stats.statistics(user_id, query))


@router.get('/knowledge-stats/history')
async def knowledge_history(user_id: User, query: Annotated[KnowledgeHistoryQuery, Query()]):
    return ApiResponse.success(data=await knowledge_stats.history(user_id, query))


@router.get('/knowledge-assessment')
async def knowledge_assessment(user_id: User, query: Annotated[KnowledgeAssessmentQuery, Query()], request: Request):
    keys = [key for key, _ in request.query_params.multi_items()]
    if len(keys) != len(set(keys)):
        raise HTTPException(status_code=422, detail='Duplicate query parameter')
    return ApiResponse.success(data=await knowledge_stats.assessment(user_id, query))
