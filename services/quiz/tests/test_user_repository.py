"""用户数据访问层测试。"""

import pytest

from app.repositories import user_repository


class FakeCursor:
    def __init__(self):
        self.executions = []
        self.lastrowid = 41

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def execute(self, sql, params):
        self.executions.append((" ".join(sql.split()), params))

    async def fetchone(self):
        return (41, "local:web-single-user", "学习者", "", 0, None, None)


class FakeConnection:
    def __init__(self, cursor):
        self._cursor = cursor

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def cursor(self):
        return self._cursor


class FakePool:
    def __init__(self, cursor):
        self._connection = FakeConnection(cursor)

    def acquire(self):
        return self._connection


@pytest.mark.asyncio
async def test_get_or_create_user_uses_atomic_unique_key_upsert(monkeypatch):
    cursor = FakeCursor()
    monkeypatch.setattr(user_repository, "get_mysql_pool", lambda: FakePool(cursor))

    user = await user_repository.get_or_create_user("local:web-single-user")

    assert user["id"] == 41
    assert user["openid"] == "local:web-single-user"
    assert len(cursor.executions) == 2
    assert "ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)" in cursor.executions[0][0]
    assert cursor.executions[0][1] == ("local:web-single-user",)
    assert "WHERE id = %s" in cursor.executions[1][0]
    assert cursor.executions[1][1] == (41,)
