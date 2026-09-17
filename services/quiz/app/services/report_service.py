"""报告服务"""
from typing import Optional
import structlog
from app.core.exceptions import ReportGenerationError, QuizGenerationError
from app.llm.report_chain import generate_report
from app.models.report import ReportGenerateRequest, ReportGenerateResponse
from app.services.scoring_service import compute_score_summary
from app.repositories import quiz_repository

logger = structlog.get_logger()


async def handle_report_generate(
    req: ReportGenerateRequest,
    user_id: Optional[int] = None,
) -> ReportGenerateResponse:
    score_summary = compute_score_summary(req.answer_records)
    try:
        if user_id is not None:
            existing = await quiz_repository.get_saved_report(req.quiz_id, user_id)
            if existing is not None:
                return ReportGenerateResponse(**existing)
            if await quiz_repository.get_quiz_detail(req.quiz_id, user_id) is None:
                raise ReportGenerationError('闯关记录不存在或不属于当前用户')
        report_output = await generate_report(
            topic=req.topic,
            questions=req.questions,
            answer_records=req.answer_records,
            score_summary=score_summary,
        )
        output = report_output.model_dump()
        if user_id is not None:
            output = await quiz_repository.save_report_atomic(
                quiz_id=req.quiz_id,
                user_id=user_id,
                records_json=[r.model_dump() for r in req.answer_records],
                total_questions=score_summary['total'],
                correct_count=score_summary['correct'],
                accuracy=score_summary['accuracy'],
                report_json=output,
                xp_gain=10 + score_summary['correct'] * 2,
            )
        return ReportGenerateResponse(**output)
    except ReportGenerationError:
        raise
    except QuizGenerationError as e:
        raise ReportGenerationError(str(e)) from None
    except Exception as e:
        logger.error('report_generation_failed', error_type=type(e).__name__)
        raise ReportGenerationError('报告生成失败，请检查模型配置和本地存储后重试') from None
