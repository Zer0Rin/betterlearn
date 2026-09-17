"""用户系统 API 集成测试"""

from unittest.mock import AsyncMock, patch, MagicMock

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.auth import create_token, decode_token
from app.core.config import get_settings
from app.main import app


@pytest.fixture
def auth_header():
    """生成一个有效的 JWT token 用于测试。"""
    token = create_token(user_id=1, openid="test_openid_123")
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
class TestLoginAPI:
    async def test_login_success(self):
        """模拟微信登录成功"""
        mock_user = {
            "id": 1,
            "openid": "mock_openid",
            "nickname": "学习者",
            "avatar_url": "",
            "total_xp": 0,
        }

        with patch(
            "app.services.user_service.wx_code_to_openid",
            new_callable=AsyncMock,
            return_value="mock_openid",
        ), patch(
            "app.services.user_service.user_repository.find_user_by_openid",
            new_callable=AsyncMock,
            return_value=None,
        ), patch(
            "app.services.user_service.user_repository.create_user",
            new_callable=AsyncMock,
            return_value=mock_user,
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                resp = await client.post(
                    "/api/v1/user/login",
                    json={"code": "mock_wx_code"},
                )
            assert resp.status_code == 200
            body = resp.json()
            assert body["code"] == 0
            assert "token" in body["data"]
            assert body["data"]["user"]["nickname"] == "学习者"

    async def test_login_existing_user(self):
        """已注册用户登录"""
        mock_user = {
            "id": 5,
            "openid": "existing_openid",
            "nickname": "鱼皮同学",
            "avatar_url": "https://example.com/avatar.png",
            "total_xp": 100,
        }

        with patch(
            "app.services.user_service.wx_code_to_openid",
            new_callable=AsyncMock,
            return_value="existing_openid",
        ), patch(
            "app.services.user_service.user_repository.find_user_by_openid",
            new_callable=AsyncMock,
            return_value=mock_user,
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                resp = await client.post(
                    "/api/v1/user/login",
                    json={"code": "mock_wx_code"},
                )
            assert resp.status_code == 200
            body = resp.json()
            assert body["data"]["user"]["id"] == 5
            assert body["data"]["user"]["total_xp"] == 100

    async def test_login_empty_code_rejected(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/api/v1/user/login", json={"code": ""})
        assert resp.status_code == 422


@pytest.mark.asyncio
class TestLocalLoginAPI:
    endpoint = "/api/v1/user/local-login"
    trusted_headers = {
        "Host": "127.0.0.1:8000",
        "Origin": "http://127.0.0.1:5173",
    }

    @pytest.fixture(autouse=True)
    def restore_local_login_settings(self):
        settings = get_settings()
        old_enabled = getattr(settings, "local_login_enabled", None)
        old_origins = getattr(settings, "local_login_trusted_origins", None)
        yield settings
        if old_enabled is not None:
            settings.local_login_enabled = old_enabled
        if old_origins is not None:
            settings.local_login_trusted_origins = old_origins

    async def _post(self, *, headers=None, client_address=("127.0.0.1", 12345)):
        transport = ASGITransport(app=app, client=client_address)
        async with AsyncClient(transport=transport, base_url="http://127.0.0.1:8000") as client:
            return await client.post(self.endpoint, headers=headers)

    async def test_local_login_denied_when_disabled(self, restore_local_login_settings):
        restore_local_login_settings.local_login_enabled = False
        resp = await self._post(headers=self.trusted_headers)
        assert resp.status_code == 403

    async def test_local_login_denied_for_remote_peer(self, restore_local_login_settings):
        restore_local_login_settings.local_login_enabled = True
        headers = {**self.trusted_headers, "X-Forwarded-For": "127.0.0.1"}
        resp = await self._post(headers=headers, client_address=("192.0.2.10", 12345))
        assert resp.status_code == 403

    @pytest.mark.parametrize(
        "headers",
        [
            {"Host": "127.0.0.1:8000"},
            {"Host": "127.0.0.1:8000", "Origin": "https://evil.example"},
            {"Host": "evil.example", "Origin": "http://127.0.0.1:5173"},
        ],
    )
    async def test_local_login_denied_for_untrusted_request(
        self, restore_local_login_settings, headers
    ):
        restore_local_login_settings.local_login_enabled = True
        resp = await self._post(headers=headers)
        assert resp.status_code == 403

    async def test_local_login_returns_token_for_stable_user(
        self, restore_local_login_settings
    ):
        restore_local_login_settings.local_login_enabled = True
        mock_user = {
            "id": 23,
            "openid": "local:web-single-user",
            "nickname": "学习者",
            "avatar_url": "",
            "total_xp": 17,
        }
        with patch(
            "app.services.user_service.user_repository.get_or_create_user",
            new_callable=AsyncMock,
            return_value=mock_user,
        ) as provision:
            first = await self._post(headers=self.trusted_headers)
            second = await self._post(headers=self.trusted_headers)

        assert first.status_code == second.status_code == 200
        first_data = first.json()["data"]
        second_data = second.json()["data"]
        assert first_data["user"]["id"] == second_data["user"]["id"] == 23
        assert decode_token(first_data["token"])["openid"] == "local:web-single-user"
        assert decode_token(second_data["token"])["user_id"] == 23
        assert provision.await_count == 2
        provision.assert_awaited_with("local:web-single-user")


@pytest.mark.asyncio
class TestProfileAPI:
    async def test_get_profile_success(self, auth_header):
        mock_user = {
            "id": 1,
            "openid": "test_openid_123",
            "nickname": "测试用户",
            "avatar_url": "",
            "total_xp": 18,
        }

        with patch(
            "app.services.user_service.user_repository.get_user_by_id",
            new_callable=AsyncMock,
            return_value=mock_user,
        ), patch(
            "app.services.user_service.quiz_repository.get_user_quiz_count",
            new_callable=AsyncMock,
            return_value=3,
        ), patch(
            "app.services.user_service.quiz_repository.get_user_answer_stats",
            new_callable=AsyncMock,
            return_value={"correct_count": 12, "average_accuracy": 80},
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                resp = await client.get("/api/v1/user/profile", headers=auth_header)
            assert resp.status_code == 200
            body = resp.json()
            assert body["code"] == 0
            assert body["data"]["quiz_count"] == 3
            assert body["data"]["correct_count"] == 12
            assert body["data"]["average_accuracy"] == 80

    async def test_get_profile_unauthorized(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/v1/user/profile")
        assert resp.status_code == 401

    async def test_update_profile_success(self, auth_header):
        with patch(
            "app.services.user_service.user_repository.update_user_profile",
            new_callable=AsyncMock,
        ) as mock_update:
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                resp = await client.put(
                    "/api/v1/user/profile",
                    json={"nickname": "新昵称"},
                    headers=auth_header,
                )
            assert resp.status_code == 200
            mock_update.assert_called_once_with(1, "新昵称", None)


@pytest.mark.asyncio
class TestQuizHistoryAPI:
    async def test_get_quiz_list(self, auth_header):
        mock_items = [
            {
                "quiz_id": "quiz_abc123",
                "title": "RAG 入门闯关",
                "accuracy": 80.0,
                "question_count": 5,
                "created_at": "2026-04-08 10:00:00",
            }
        ]

        with patch(
            "app.services.history_service.quiz_repository.get_user_quiz_list",
            new_callable=AsyncMock,
            return_value=(mock_items, 1),
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                resp = await client.get(
                    "/api/v1/user/quizzes?page=1&page_size=10",
                    headers=auth_header,
                )
            assert resp.status_code == 200
            body = resp.json()
            assert body["code"] == 0
            assert len(body["data"]["items"]) == 1
            assert body["data"]["total"] == 1

    async def test_get_quiz_list_unauthorized(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/v1/user/quizzes")
        assert resp.status_code == 401

    async def test_get_quiz_detail(self, auth_header):
        mock_detail = {
            "quiz_id": "quiz_abc123",
            "title": "RAG 入门",
            "summary": "测试摘要",
            "user_input": "RAG",
            "questions": [{"id": "q1", "stem": "test"}],
            "answer_records": [{"question_id": "q1", "is_correct": True}],
            "report": {"accuracy": 100},
            "created_at": "2026-04-08 10:00:00",
        }

        with patch(
            "app.services.history_service.quiz_repository.get_quiz_detail",
            new_callable=AsyncMock,
            return_value=mock_detail,
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                resp = await client.get(
                    "/api/v1/user/quizzes/quiz_abc123",
                    headers=auth_header,
                )
            assert resp.status_code == 200
            body = resp.json()
            assert body["code"] == 0
            assert body["data"]["quiz_id"] == "quiz_abc123"

    async def test_get_quiz_detail_not_found(self, auth_header):
        with patch(
            "app.services.history_service.quiz_repository.get_quiz_detail",
            new_callable=AsyncMock,
            return_value=None,
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                resp = await client.get(
                    "/api/v1/user/quizzes/quiz_nonexist",
                    headers=auth_header,
                )
            assert resp.status_code == 200
            body = resp.json()
            assert body["code"] == 4004


@pytest.mark.asyncio
class TestQuizWithOptionalAuth:
    """确保出题接口在有/无 token 时都正常工作"""

    async def test_quiz_generate_without_token(self):
        """匿名模式应正常工作"""
        from app.models.quiz import QuizOutput, Question, QuestionOption

        mock_output = QuizOutput(
            title="Test",
            summary="Test summary",
            questions=[
                Question(
                    id="q1", type="single", stem="test?",
                    options=[
                        QuestionOption(key="A", text="a"),
                        QuestionOption(key="B", text="b"),
                    ],
                    answer=["A"], explanation="test", knowledge_point="test", difficulty="easy",
                ),
            ],
        )
        with patch(
            "app.services.quiz_service.generate_quiz",
            new_callable=AsyncMock,
            return_value=mock_output,
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                resp = await client.post(
                    "/api/v1/quiz/generate",
                    json={"user_input": "Python basic", "question_count": 3, "difficulty": "easy"},
                )
            assert resp.status_code == 200
            assert resp.json()["code"] == 0

    async def test_quiz_generate_with_token(self, auth_header):
        """有 token 时应正常工作且落库"""
        from app.models.quiz import QuizOutput, Question, QuestionOption

        mock_output = QuizOutput(
            title="Test",
            summary="Test summary",
            questions=[
                Question(
                    id="q1", type="single", stem="test?",
                    options=[
                        QuestionOption(key="A", text="a"),
                        QuestionOption(key="B", text="b"),
                    ],
                    answer=["A"], explanation="test", knowledge_point="test", difficulty="easy",
                ),
            ],
        )
        with patch(
            "app.services.quiz_service.generate_quiz",
            new_callable=AsyncMock,
            return_value=mock_output,
        ), patch(
            "app.services.quiz_service.quiz_repository.save_quiz_session",
            new_callable=AsyncMock,
        ) as mock_save:
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                resp = await client.post(
                    "/api/v1/quiz/generate",
                    json={"user_input": "Python basic", "question_count": 3, "difficulty": "easy"},
                    headers=auth_header,
                )
            assert resp.status_code == 200
            mock_save.assert_called_once()


@pytest.mark.asyncio
class TestReportWithOptionalAuth:
    """确保报告接口在有/无 token 时都正常工作"""

    async def test_report_generate_with_token_saves_data(self, auth_header, sample_report_request, database):
        from app.models.report import ReportOutput

        mock_output = ReportOutput(
            accuracy=80,
            mastered_points=["point1"],
            weak_points=["point2"],
            three_line_summary=["s1", "s2", "s3"],
            advice=["a1"],
            share_quote="quote",
        )
        from app.repositories import user_repository, quiz_repository
        user = await user_repository.create_user('report-api')
        assert user['id'] == 1
        await quiz_repository.save_quiz_session(sample_report_request['quiz_id'], 1, 'title', '', '', sample_report_request['questions'])
        with patch(
            "app.services.report_service.generate_report",
            new_callable=AsyncMock,
            return_value=mock_output,
        ) as provider:
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                responses = []
                for _ in range(2):
                    responses.append(await client.post(
                        "/api/v1/report/generate",
                        json=sample_report_request,
                        headers=auth_header,
                    ))
            assert all(response.status_code == 200 for response in responses)
            assert responses[0].json() == responses[1].json()
            provider.assert_awaited_once()
            assert (await user_repository.get_user_by_id(1))['total_xp'] == 18
            detail = await quiz_repository.get_quiz_detail(sample_report_request['quiz_id'], 1)
            assert detail['report']['accuracy'] == 80
            assert len(detail['answer_records']) == 5
