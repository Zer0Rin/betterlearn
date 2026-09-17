"""题库 / 答题 / 报告数据访问层"""

from __future__ import annotations

import json
from typing import Optional

import structlog

from app.core.db import transaction, format_timestamp

logger = structlog.get_logger()


async def save_quiz_session(
    quiz_id: str,
    user_id: Optional[int],
    title: str,
    summary: str,
    user_input: str,
    questions_json: list,
) -> None:
    with transaction() as cur:
        cur.execute(
            "INSERT INTO quiz_sessions (quiz_id, user_id, title, summary, user_input, questions_json) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                quiz_id,
                user_id,
                title,
                summary,
                user_input,
                json.dumps(questions_json, ensure_ascii=False),
            ),
        )


async def save_answer_record(
    quiz_id: str,
    user_id: Optional[int],
    records_json: list,
    total_questions: int,
    correct_count: int,
    accuracy: float,
) -> None:
    with transaction() as cur:
        cur.execute(
            "INSERT INTO answer_records (quiz_id, user_id, records_json, total_questions, correct_count, accuracy) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                quiz_id,
                user_id,
                json.dumps(records_json, ensure_ascii=False),
                total_questions,
                correct_count,
                accuracy,
            ),
        )


async def save_report(
    quiz_id: str,
    user_id: Optional[int],
    report_json: dict,
) -> None:
    with transaction() as cur:
        cur.execute(
            "INSERT INTO reports (quiz_id, user_id, report_json) VALUES (?, ?, ?)",
            (
                quiz_id,
                user_id,
                json.dumps(report_json, ensure_ascii=False),
            ),
        )


async def get_user_quiz_count(user_id: int) -> int:
    with transaction() as cur:
        cur.execute(
            "SELECT COUNT(*) FROM quiz_sessions WHERE user_id = ?",
            (user_id,),
        )
        row = cur.fetchone()
        return row[0] if row else 0


async def get_user_answer_stats(user_id: int) -> dict:
    """获取用户答题统计：总答对题数、平均正确率。"""
    with transaction() as cur:
        cur.execute(
            "SELECT COALESCE(SUM(correct_count), 0), COALESCE(AVG(accuracy), 0) "
            "FROM answer_records WHERE user_id = ?",
            (user_id,),
        )
        row = cur.fetchone()
        return {
            "correct_count": int(row[0]) if row else 0,
            "average_accuracy": round(float(row[1])) if row else 0,
        }


async def get_user_quiz_list(user_id: int, page: int, page_size: int) -> tuple[list[dict], int]:
    """分页获取用户闯关历史。返回 (items, total)。"""
    with transaction() as cur:
        # 总数
        cur.execute(
            "SELECT COUNT(*) FROM quiz_sessions WHERE user_id = ?",
            (user_id,),
        )
        total = (cur.fetchone())[0]

        # 列表
        offset = (page - 1) * page_size
        cur.execute(
            "SELECT qs.quiz_id, qs.title, "
            "COALESCE(ar.accuracy, 0), COALESCE(ar.total_questions, 0), "
            "qs.created_at "
            "FROM quiz_sessions qs "
            "LEFT JOIN answer_records ar ON qs.quiz_id = ar.quiz_id "
            "WHERE qs.user_id = ? "
            "ORDER BY qs.created_at DESC "
            "LIMIT ? OFFSET ?",
            (user_id, page_size, offset),
        )
        rows = cur.fetchall()
        items = [
            {
                "quiz_id": r[0],
                "title": r[1],
                "accuracy": float(r[2]),
                "question_count": r[3],
                "created_at": format_timestamp(r[4]),
            }
            for r in rows
        ]
        return items, total


async def get_quiz_detail(quiz_id: str, user_id: int) -> Optional[dict]:
    """获取单次闯关完整详情。"""
    with transaction() as cur:
        cur.execute(
            "SELECT quiz_id, title, summary, user_input, questions_json, created_at "
            "FROM quiz_sessions WHERE quiz_id = ? AND user_id = ?",
            (quiz_id, user_id),
        )
        qs_row = cur.fetchone()
        if qs_row is None:
            return None

        result = {
            "quiz_id": qs_row[0],
            "title": qs_row[1],
            "summary": qs_row[2],
            "user_input": qs_row[3],
            "questions": json.loads(qs_row[4]) if isinstance(qs_row[4], str) else qs_row[4],
            "created_at": format_timestamp(qs_row[5]),
        }

        # 答题记录
        cur.execute(
            "SELECT records_json FROM answer_records WHERE quiz_id = ?",
            (quiz_id,),
        )
        ar_row = cur.fetchone()
        if ar_row:
            result["answer_records"] = json.loads(ar_row[0]) if isinstance(ar_row[0], str) else ar_row[0]

        # 报告
        cur.execute(
            "SELECT report_json FROM reports WHERE quiz_id = ?",
            (quiz_id,),
        )
        rp_row = cur.fetchone()
        if rp_row:
            result["report"] = json.loads(rp_row[0]) if isinstance(rp_row[0], str) else rp_row[0]

        return result


async def get_saved_report(quiz_id: str, user_id: int) -> Optional[dict]:
    """Read a persisted report only for its owning user."""
    with transaction() as cur:
        cur.execute('SELECT report_json FROM reports WHERE quiz_id = ? AND user_id = ?', (quiz_id, user_id))
        row = cur.fetchone()
        return json.loads(row[0]) if row else None


async def save_report_atomic(
    quiz_id: str,
    user_id: int,
    records_json: list,
    total_questions: int,
    correct_count: int,
    accuracy: float,
    report_json: dict,
    xp_gain: int,
) -> dict:
    """Commit answers, report and XP exactly once, returning the winning report."""
    with transaction() as cur:
        cur.execute('SELECT user_id FROM quiz_sessions WHERE quiz_id = ?', (quiz_id,))
        owner = cur.fetchone()
        if owner is None or owner[0] != user_id:
            raise ValueError('闯关记录不存在或不属于当前用户')
        cur.execute('SELECT report_json FROM reports WHERE quiz_id = ?', (quiz_id,))
        existing = cur.fetchone()
        if existing:
            return json.loads(existing[0])
        cur.execute(
            'INSERT INTO answer_records (quiz_id, user_id, records_json, total_questions, correct_count, accuracy) VALUES (?, ?, ?, ?, ?, ?)',
            (quiz_id, user_id, json.dumps(records_json, ensure_ascii=False), total_questions, correct_count, accuracy),
        )
        cur.execute('INSERT INTO reports (quiz_id, user_id, report_json) VALUES (?, ?, ?)',
                    (quiz_id, user_id, json.dumps(report_json, ensure_ascii=False)))
        cur.execute('UPDATE users SET total_xp = total_xp + ? WHERE id = ?', (xp_gain, user_id))
        return report_json
