"""Owned goals: Host-frozen creation, readonly progress and archival CAS."""
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from app.api.v1.routes.user import _require_managed_host
from app.core.auth import get_current_user
from app.models.common import ApiResponse
from app.models.learning_goal import GOAL_PATTERN, UUID_PATTERN, GoalCreate, GoalArchive, GoalList
from app.repositories import learning_goal_repository as goals

router = APIRouter(prefix='/learning-goals', tags=['learning-goals'])
User = Annotated[int, Depends(get_current_user)]
GoalId = Annotated[str, Path(pattern=GOAL_PATTERN)]
RequestId = Annotated[str, Path(pattern=UUID_PATTERN)]


def _query(request, listing=False):
    keys = [key for key, _ in request.query_params.multi_items()]
    if len(keys) != len(set(keys)) or (keys and not listing):
        raise HTTPException(status_code=422, detail='Invalid query parameters')


@router.post('')
async def create(user_id: User, body: GoalCreate, request: Request):
    _require_managed_host(request)
    _query(request)
    return ApiResponse.success(data=await goals.create(user_id, body))


@router.get('')
async def listing(user_id: User, query: Annotated[GoalList, Query()], request: Request):
    _query(request, listing=True)
    return ApiResponse.success(data=await goals.listing(user_id, query))


@router.get('/request/{request_id}')
async def lookup(user_id: User, request_id: RequestId, request: Request):
    _require_managed_host(request)
    _query(request)
    return ApiResponse.success(data=await goals.lookup(user_id, request_id))


@router.get('/{goal_id}')
async def detail(user_id: User, goal_id: GoalId, request: Request):
    _query(request)
    return ApiResponse.success(data=await goals.detail(user_id, goal_id))


@router.put('/{goal_id}/archive')
async def archive(user_id: User, goal_id: GoalId, body: GoalArchive, request: Request):
    _query(request)
    return ApiResponse.success(data=await goals.archive(user_id, goal_id, body))
