"""Paper review and self-exam delivery: separate from answer-bearing practice APIs."""
from typing import Annotated
from fastapi import APIRouter, Depends, Path, Request
from app.core.auth import get_current_user
from app.core.exceptions import BankError
from app.models.common import ApiResponse
from app.models.exam import PaperPreview, PaperCreate, PaperReview, ExamStart, ExamAnswers
from app.repositories import exam_paper_repository as papers, exam_repository as exams


async def query_boundary(request: Request):
    query = request.query_params
    if request.method == 'GET' and request.url.path in ('/api/v1/exam-papers', '/api/v1/exam-sessions'):
        seen = set()
        for key, value in query.multi_items():
            if key in seen or key not in ('page', 'page_size') or not 1 <= len(value) <= 7 or value.startswith('0') or not value.isascii() or not value.isdecimal() or not 1 <= int(value) <= (1000000 if key == 'page' else 100):
                raise BankError('分页参数无效', 422)
            seen.add(key)
    elif query:
        raise BankError('不接受查询参数', 422)


router = APIRouter(tags=['exams'], dependencies=[Depends(query_boundary)])
User = Annotated[int, Depends(get_current_user)]
PaperID = Annotated[str, Path(pattern=r'^paper_[0-9a-f]{32}$')]
ExamID = Annotated[str, Path(pattern=r'^exam_[0-9a-f]{32}$')]


@router.post('/exam-papers/preview')
async def preview(req: PaperPreview, user_id: User):
    return ApiResponse.success(data=await papers.preview(user_id, req))


@router.post('/exam-papers')
async def create(req: PaperCreate, user_id: User):
    return ApiResponse.success(data=await papers.create(user_id, req))


@router.get('/exam-papers')
async def list_papers(request: Request, user_id: User):
    return ApiResponse.success(data=await papers.listing(user_id, int(request.query_params.get('page', '1')), int(request.query_params.get('page_size', '20'))))


@router.get('/exam-papers/{paper_id}')
async def get_paper(paper_id: PaperID, user_id: User):
    return ApiResponse.success(data=await papers.get(user_id, paper_id))


@router.put('/exam-papers/{paper_id}/review')
async def review(paper_id: PaperID, req: PaperReview, user_id: User):
    return ApiResponse.success(data=await papers.review(user_id, paper_id, req))


@router.post('/exam-papers/{paper_id}/sessions')
async def start(paper_id: PaperID, req: ExamStart, user_id: User):
    return ApiResponse.success(data=await exams.start(user_id, paper_id, req))


@router.get('/exam-sessions')
async def list_exams(request: Request, user_id: User):
    return ApiResponse.success(data=await exams.listing(user_id, int(request.query_params.get('page', '1')), int(request.query_params.get('page_size', '20'))))


@router.get('/exam-sessions/{session_id}')
async def get_exam(session_id: ExamID, user_id: User):
    return ApiResponse.success(data=await exams.get(user_id, session_id))


@router.put('/exam-sessions/{session_id}/answers')
async def save(session_id: ExamID, req: ExamAnswers, user_id: User):
    return ApiResponse.success(data=await exams.save(user_id, session_id, req))


@router.post('/exam-sessions/{session_id}/submit')
async def submit(session_id: ExamID, req: ExamAnswers, user_id: User):
    return ApiResponse.success(data=await exams.submit(user_id, session_id, req))
