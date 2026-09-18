"""One frozen user-selected source; model output never supplies source IDs."""
import asyncio
import json
import uuid
from app.core.exceptions import ContentFilterError
from app.core.security import check_content
from app.models.quiz import QuizGenerateResponse, QuizTaskCreateResponse, AnswerRecord
from app.services.scoring_service import grade_answer_records
from app.models.source_generation import SourceGenerateRequest
from app.models.attempt import AttemptAnswer
from app.repositories import source_generation_repository as repository, quiz_repository
from app.services import quiz_service


async def create(request, user_id):
    if not check_content(request.user_input):
        raise ContentFilterError('输入内容包含不当内容，请修改后重试')
    task_id, fresh = await repository.create(user_id, request)
    if fresh:
        asyncio.create_task(run(task_id))
    return QuizTaskCreateResponse(task_id=task_id)


async def run(task_id):
    saved = await repository.claim(task_id)
    if saved is None:
        return
    try:
        request = SourceGenerateRequest.model_validate(json.loads(saved['request_json']))
        source = request.source
        context = '用户明确选择的出题范围，仅围绕以下冻结知识点与证据出题：\n' + json.dumps({
            'type': source.type, 'title': source.title, 'statement': source.statement,
            'evidence': source.evidence.model_dump(),
        }, ensure_ascii=False)
        output = await quiz_service.generate_quiz(user_input=request.user_input,
            question_count=request.question_count, difficulty=request.difficulty, search_context=context)
        if len(output.questions) != request.question_count or len({q.id for q in output.questions}) != len(output.questions):
            raise ValueError('invalid generated question inventory')
        # Pure preflight against the existing canonical grading rules.
        # These reference answers are never persisted as learner attempts.
        references = [AnswerRecord(**AttemptAnswer(question_id=q.id,
            selected_answers=q.answer, duration_ms=0).model_dump(), is_correct=False)
            for q in output.questions]
        if not all(record.is_correct for record in grade_answer_records(output.questions, references)):
            raise ValueError('generated references cannot be graded')
        quiz_id = 'quiz_' + uuid.uuid4().hex[:12]
        notice = await quiz_service._maybe_generate_images(output, quiz_id, saved['user_id'], request.generate_images)
        result = QuizGenerateResponse(quiz_id=quiz_id, title=output.title, summary=output.summary,
                                      questions=output.questions, image_notice=notice)
        await quiz_repository.save_quiz_session(quiz_id, saved['user_id'], output.title, output.summary,
            request.user_input, [q.model_dump() for q in output.questions],
            source_task_id=task_id, task_result=result.model_dump())
    except asyncio.CancelledError:
        await repository.fail(task_id, '出题任务被中断，请显式创建新请求')
        raise
    except Exception:
        await repository.fail(task_id, '题库生成或保存失败，请检查模型配置和本地存储')
