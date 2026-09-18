"""Owned practice attempts. These are practice APIs, not an exam delivery API."""
from typing import Annotated
from fastapi import APIRouter, Depends, Path

from app.core.auth import get_current_user
from app.models.attempt import AttemptCreateRequest, AttemptAnswersRequest
from app.models.common import ApiResponse
from app.repositories import attempt_repository as attempts
from app.services.report_service import handle_attempt_report

router = APIRouter(prefix='/quiz', tags=['attempts'])
Identifier = Annotated[str, Path(pattern=r'^[A-Za-z0-9_-]{1,100}$')]
User = Annotated[int, Depends(get_current_user)]


@router.post('/{quiz_id}/attempts')
async def create_attempt(quiz_id: Identifier, req: AttemptCreateRequest, user_id: User):
    return ApiResponse.success(data=await attempts.create_attempt(quiz_id, user_id, req.request_id))


@router.get('/{quiz_id}/attempts')
async def list_attempts(quiz_id: Identifier, user_id: User):
    return ApiResponse.success(data={'items': await attempts.list_attempts(quiz_id, user_id)})


@router.get('/attempts/{attempt_id}')
async def get_attempt(attempt_id: Identifier, user_id: User):
    return ApiResponse.success(data=await attempts.get_attempt(attempt_id, user_id))


@router.put('/attempts/{attempt_id}/answers')
async def save_answers(attempt_id: Identifier, req: AttemptAnswersRequest, user_id: User):
    return ApiResponse.success(data=await attempts.save_answers(attempt_id, user_id, req.expected_revision, req.answer_records))


@router.post('/attempts/{attempt_id}/submit')
async def submit_attempt(attempt_id: Identifier, req: AttemptAnswersRequest, user_id: User):
    return ApiResponse.success(data=await attempts.submit_attempt(attempt_id, user_id, req.expected_revision, req.answer_records))


@router.post('/attempts/{attempt_id}/report')
async def generate_report(attempt_id: Identifier, user_id: User):
    result = await handle_attempt_report(attempt_id, user_id)
    return ApiResponse.success(data=result.model_dump())
