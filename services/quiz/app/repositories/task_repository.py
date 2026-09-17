"""异步任务数据访问层"""

from __future__ import annotations

import json
from typing import Optional

import structlog

from app.core.db import transaction

logger = structlog.get_logger()


async def create_task(
    task_id: str,
    user_id: Optional[int],
    user_input: str,
    question_count: int,
    difficulty: str,
) -> None:
    with transaction() as cur:
        cur.execute(
            "INSERT INTO quiz_tasks (task_id, user_id, user_input, question_count, difficulty, status) "
            "VALUES (?, ?, ?, ?, ?, 'pending')",
            (task_id, user_id, user_input, question_count, difficulty),
        )


async def update_task_status(
    task_id: str,
    status: str,
    result_json: Optional[dict] = None,
    error_message: Optional[str] = None,
) -> None:
    with transaction() as cur:
        cur.execute(
            "UPDATE quiz_tasks SET status = ?, result_json = ?, error_message = ? WHERE task_id = ?",
            (
                status,
                json.dumps(result_json, ensure_ascii=False) if result_json else None,
                error_message,
                task_id,
            ),
        )


async def get_task(task_id: str) -> Optional[dict]:
    with transaction() as cur:
        cur.execute(
            "SELECT task_id, status, result_json, error_message FROM quiz_tasks WHERE task_id = ?",
            (task_id,),
        )
        record = cur.fetchone()
        row = dict(record) if record else None
        if row and row.get("result_json"):
            if isinstance(row["result_json"], str):
                row["result_json"] = json.loads(row["result_json"])
        return row




async def has_active_tasks() -> bool:
    with transaction() as cur:
        cur.execute("SELECT 1 FROM quiz_tasks WHERE status IN ('pending', 'running') LIMIT 1")
        return cur.fetchone() is not None
