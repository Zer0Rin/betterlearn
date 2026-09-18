"""AI reports are optional derivatives of an already committed attempt."""
import asyncio
from typing import Optional
import structlog

from app.core.exceptions import AttemptError, ReportGenerationError, QuizGenerationError
from app.llm.report_chain import generate_report
from app.models.report import ReportGenerateRequest, ReportGenerateResponse
from app.models.quiz import Question, AnswerRecord
from app.services.scoring_service import compute_score_summary, grade_answer_records
from app.repositories import quiz_repository, attempt_repository

logger = structlog.get_logger()


async def handle_attempt_report(attempt_id: str, user_id: int) -> ReportGenerateResponse:
    attempt, token = await attempt_repository.claim_report(attempt_id, user_id)
    if token is None:
        return ReportGenerateResponse(**attempt['report'])
    try:
        questions = [Question.model_validate(q) for q in attempt['questions']]
        records = [AnswerRecord.model_validate(r) for r in attempt['answer_records']]
        summary = compute_score_summary(records)
        # Migrated historical scores remain facts even if old client flags were
        # inconsistent. New submissions always have server-graded records.
        summary.update(total=attempt['total_questions'], correct=attempt['correct_count'],
                       wrong=attempt['total_questions'] - attempt['correct_count'], accuracy=attempt['accuracy'])
        output = (await generate_report(topic=attempt['title'], questions=questions,
                                       answer_records=records, score_summary=summary)).model_dump()
        output['accuracy'] = attempt['accuracy']
        result = ReportGenerateResponse(**output)
        await attempt_repository.finish_report(attempt_id, user_id, token, result.model_dump())
        return result
    except asyncio.CancelledError:
        await attempt_repository.finish_report(attempt_id, user_id, token)
        raise
    except Exception as exc:
        await attempt_repository.finish_report(attempt_id, user_id, token)
        logger.error('report_generation_failed', error_type=type(exc).__name__)
        raise ReportGenerationError('报告生成失败，成绩已保存，请检查模型配置后重试报告') from None


async def handle_report_generate(req: ReportGenerateRequest, user_id: Optional[int] = None) -> ReportGenerateResponse:
    """Compatibility endpoint: persist the owned submission before requesting AI."""
    try:
        if user_id is not None:
            existing = await quiz_repository.get_saved_report(req.quiz_id, user_id)
            if existing is not None:
                return ReportGenerateResponse(**existing)
            attempt = await attempt_repository.submit_legacy(req.quiz_id, user_id, req.answer_records)
            return await handle_attempt_report(attempt['attempt_id'], user_id)
        # Anonymous legacy reports never persist scores or XP.
        records = grade_answer_records(req.questions, req.answer_records)
        summary = compute_score_summary(records)
        output = (await generate_report(topic=req.topic, questions=req.questions,
                                       answer_records=records, score_summary=summary)).model_dump()
        output['accuracy'] = summary['accuracy']
        return ReportGenerateResponse(**output)
    except ReportGenerationError:
        raise
    except AttemptError as exc:
        raise ReportGenerationError(str(exc)) from None
    except QuizGenerationError as exc:
        raise ReportGenerationError(str(exc)) from None
    except Exception as exc:
        logger.error('report_generation_failed', error_type=type(exc).__name__)
        raise ReportGenerationError('报告生成失败，请检查模型配置和本地存储后重试') from None
