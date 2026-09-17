"""用户数据访问层"""

from __future__ import annotations

from typing import Optional

import structlog

from app.core.db import transaction

logger = structlog.get_logger()


async def find_user_by_openid(openid: str) -> Optional[dict]:
    with transaction() as cur:
        cur.execute(
            "SELECT id, openid, nickname, avatar_url, total_xp, created_at, updated_at "
            "FROM users WHERE openid = ?",
            (openid,),
        )
        row = cur.fetchone()
        if row is None:
            return None
        return {
            "id": row[0],
            "openid": row[1],
            "nickname": row[2],
            "avatar_url": row[3],
            "total_xp": row[4],
            "created_at": row[5],
            "updated_at": row[6],
        }


async def create_user(openid: str) -> dict:
    with transaction() as cur:
        cur.execute(
            "INSERT INTO users (openid) VALUES (?)",
            (openid,),
        )
        user_id = cur.lastrowid
        return {
            "id": user_id,
            "openid": openid,
            "nickname": "学习者",
            "avatar_url": "",
            "total_xp": 0,
        }


async def get_or_create_user(openid: str) -> dict:
    """借助 openid 唯一键原子地取得或创建用户。"""
    with transaction() as cur:
        cur.execute(
            "INSERT INTO users (openid) VALUES (?) "
            "ON CONFLICT(openid) DO NOTHING",
            (openid,),
        )
        cur.execute(
            "SELECT id, openid, nickname, avatar_url, total_xp, created_at, updated_at "
            "FROM users WHERE openid = ?",
            (openid,),
        )
        row = cur.fetchone()
        if row is None:
            raise RuntimeError("用户创建后无法读取")
        return {
            "id": row[0],
            "openid": row[1],
            "nickname": row[2],
            "avatar_url": row[3],
            "total_xp": row[4],
            "created_at": row[5],
            "updated_at": row[6],
        }


async def update_user_profile(user_id: int, nickname: Optional[str], avatar_url: Optional[str]) -> None:
    fields = []
    values = []
    if nickname is not None:
        fields.append("nickname = ?")
        values.append(nickname)
    if avatar_url is not None:
        fields.append("avatar_url = ?")
        values.append(avatar_url)
    if not fields:
        return
    values.append(user_id)
    with transaction() as cur:
        cur.execute(
            f"UPDATE users SET {', '.join(fields)} WHERE id = ?",
            tuple(values),
        )


async def add_user_xp(user_id: int, xp: int) -> None:
    with transaction() as cur:
        cur.execute(
            "UPDATE users SET total_xp = total_xp + ? WHERE id = ?",
            (xp, user_id),
        )


async def get_user_by_id(user_id: int) -> Optional[dict]:
    with transaction() as cur:
        cur.execute(
            "SELECT id, openid, nickname, avatar_url, total_xp FROM users WHERE id = ?",
            (user_id,),
        )
        row = cur.fetchone()
        if row is None:
            return None
        return {
            "id": row[0],
            "openid": row[1],
            "nickname": row[2],
            "avatar_url": row[3],
            "total_xp": row[4],
        }
