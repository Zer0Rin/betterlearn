"""计分服务"""

from app.core.exceptions import ReportGenerationError
from app.models.quiz import AnswerRecord, Question
from app.services.choice_grading import grade_choice


def grade_answer_records(questions: list[Question], records: list[AnswerRecord]) -> list[AnswerRecord]:
    """Validate a complete submission and replace every client verdict."""
    by_id = {question.id: question for question in questions}
    record_ids = [record.question_id for record in records]
    if (not questions or len(by_id) != len(questions)
            or len(set(record_ids)) != len(record_ids) or set(record_ids) != set(by_id)):
        raise ReportGenerationError('答题记录与题目不匹配，请完成全部题目且每题仅提交一次')
    graded = []
    for record in records:
        question = by_id[record.question_id]
        options = {option.key for option in question.options}
        if (not question.answer or not set(question.answer) <= options
                or len(set(question.answer)) != len(question.answer)
                or len(options) != len(question.options)
                or len({key.strip().lower() for key in options}) != len(options)
                or (question.type != 'multiple' and len(question.answer) != 1)):
            raise ReportGenerationError('已保存的题目答案无效，无法判分')
        selected = record.selected_answers
        if (not selected or len(set(selected)) != len(selected)
                or not set(selected) <= options or record.duration_ms < 0
                or (question.type != 'multiple' and len(selected) != 1)):
            raise ReportGenerationError('答题选项或用时无效，请检查答题记录')
        graded.append(record.model_copy(update={'is_correct': grade_choice(selected, question.answer)}))
    return graded


def compute_score_summary(answer_records: list[AnswerRecord]) -> dict:
    total = len(answer_records)
    correct = sum(1 for r in answer_records if r.is_correct)
    accuracy = round(correct / total * 100) if total > 0 else 0
    avg_duration = (
        round(sum(r.duration_ms for r in answer_records) / total) if total > 0 else 0
    )

    return {
        "total": total,
        "correct": correct,
        "wrong": total - correct,
        "accuracy": accuracy,
        "avg_duration_ms": avg_duration,
    }
