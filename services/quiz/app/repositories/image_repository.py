"""题目配图生成记录数据访问层（用于每日生图次数限制）"""

from __future__ import annotations

from typing import Optional

import structlog

from app.core.db import transaction

logger = structlog.get_logger()


async def get_today_usage_count(user_id: int) -> int:
    """获取用户当天（服务器本地日期）已成功生成的图片数量。

    数据库必须已经初始化。
    """
    with transaction() as cur:
        cur.execute(
            "SELECT COUNT(*) FROM image_generation_logs "
            "WHERE user_id = ? AND created_at >= date('now')",
            (user_id,),
        )
        row = cur.fetchone()
        return row[0] if row else 0


async def log_image_generation(
    user_id: int,
    quiz_id: Optional[str],
    question_id: Optional[str],
    image_url: str,
) -> None:
    """记录一次成功的生图，用于每日次数统计。"""
    with transaction() as cur:
        cur.execute(
            "INSERT INTO image_generation_logs (user_id, quiz_id, question_id, image_url) "
            "VALUES (?, ?, ?, ?)",
            (user_id, quiz_id, question_id, image_url),
        )
