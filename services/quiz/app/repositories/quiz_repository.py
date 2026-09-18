"""题库 / 答题 / 报告数据访问层"""

from __future__ import annotations

import json
from typing import Optional

import structlog

from app.core.db import transaction, format_timestamp
from app.services.question_bank_projection import index_questions

logger = structlog.get_logger()


async def save_quiz_session(
    quiz_id: str,
    user_id: Optional[int],
    title: str,
    summary: str,
    user_input: str,
    questions_json: list,
    *, source_task_id: str | None = None, task_result: dict | None = None,
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
        entries = index_questions(cur, quiz_id, user_id, title, questions_json)
        if source_task_id is not None:
            task = cur.execute('''SELECT s.request_json FROM quiz_source_tasks s
                JOIN quiz_tasks t ON t.task_id=s.task_id
                WHERE s.task_id=? AND s.user_id=? AND t.user_id=? AND t.status='running' ''',
                (source_task_id, user_id, user_id)).fetchone()
            if task is None or task_result is None or not entries or len(entries) != len(questions_json):
                raise ValueError('source task is not available')
            source = json.loads(task['request_json'])['source']
            for entry_id in entries.values():
                cur.execute('INSERT INTO question_bank_sources(entry_id,revision,source_json) VALUES(?,1,?)',
                            (entry_id, json.dumps(source, ensure_ascii=False)))
            cur.execute('''UPDATE quiz_tasks SET status='completed',result_json=?,error_message=NULL WHERE task_id=?''',
                        (json.dumps(task_result, ensure_ascii=False), source_task_id))


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
            "FROM quiz_attempts WHERE user_id = ? AND status = 'submitted'",
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
            "qs.created_at, ar.attempt_id, ar.submitted_at "
            "FROM quiz_sessions qs "
            "LEFT JOIN quiz_attempts ar ON ar.id = (SELECT a.id FROM quiz_attempts a "
            "WHERE a.quiz_id=qs.quiz_id AND a.user_id=qs.user_id AND a.status='submitted' "
            "ORDER BY a.submitted_at DESC, a.id DESC LIMIT 1) "
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
                "attempt_id": r[5],
                "submitted_at": format_timestamp(r[6]) if r[6] else None,
                "status": "submitted" if r[5] else "unsubmitted",
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
            "summary": qs_row[2] if qs_row[2] is not None else "",
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

        cur.execute("SELECT * FROM quiz_attempts WHERE quiz_id=? AND user_id=? AND legacy_source=1",
                    (quiz_id, user_id))
        attempt = cur.fetchone()
        if attempt:
            from app.repositories.attempt_repository import _read
            saved = _read(cur, attempt)
            result['answer_records'] = saved['answer_records']
            result['attempt_id'] = saved['attempt_id']
            result['report_status'] = saved['report_status']
            if saved['report'] is not None:
                result['report'] = saved['report']
        return result


async def get_saved_report(quiz_id: str, user_id: int) -> Optional[dict]:
    """Read a persisted report only for its owning user."""
    with transaction() as cur:
        cur.execute('SELECT report_json FROM reports WHERE quiz_id = ? AND user_id = ?', (quiz_id, user_id))
        row = cur.fetchone()
        if row:
            return json.loads(row[0])
        cur.execute('''SELECT r.report_json FROM quiz_attempts a
            JOIN quiz_attempt_reports r ON r.attempt_id=a.attempt_id
            JOIN quiz_sessions q ON q.quiz_id=a.quiz_id
            WHERE a.quiz_id=? AND a.user_id=? AND q.user_id=? AND a.legacy_source=1 AND r.status='completed' ''',
            (quiz_id, user_id, user_id))
        row = cur.fetchone()
        return json.loads(row[0]) if row else None
