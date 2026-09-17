"""search_service 单元测试"""

import asyncio
import json
from langchain_core.messages import ToolMessage
from app.core.exceptions import QuizGenerationError
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


def successful_tool_message():
    return ToolMessage(content=json.dumps({"results": [{"url": "https://example.com/verified", "content": "Verified search material"}]}), tool_call_id="search-ok")


@pytest.fixture
def mock_settings_enabled():
    """搜索功能已启用的配置"""
    settings = MagicMock()
    settings.enable_web_search = True
    settings.tavily_api_key = "tvly-test-key"
    settings.deepseek_model = "deepseek-chat"
    settings.deepseek_base_url = "https://api.deepseek.com"
    settings.deepseek_api_key = "sk-test"
    return settings


@pytest.fixture
def mock_settings_disabled():
    """搜索功能已关闭的配置"""
    settings = MagicMock()
    settings.enable_web_search = False
    settings.tavily_api_key = "tvly-test-key"
    return settings


@pytest.fixture
def mock_settings_no_key():
    """未配置 API key"""
    settings = MagicMock()
    settings.enable_web_search = True
    settings.tavily_api_key = ""
    return settings


@pytest.mark.asyncio
async def test_fetch_returns_empty_when_disabled(mock_settings_disabled):
    """配置关闭时应返回空字符串"""
    with patch("app.services.search_service.get_settings", return_value=mock_settings_disabled):
        from app.services.search_service import fetch_knowledge_context

        result = await fetch_knowledge_context("Harness Engineering")
        assert result == ""


@pytest.mark.asyncio
async def test_fetch_returns_empty_when_no_api_key(mock_settings_no_key):
    """未配置 tavily_api_key 时应返回空字符串"""
    with patch("app.services.search_service.get_settings", return_value=mock_settings_no_key):
        from app.services.search_service import fetch_knowledge_context

        result = await fetch_knowledge_context("Harness Engineering")
        assert result == ""


@pytest.mark.asyncio
async def test_fetch_returns_context_on_success(mock_settings_enabled):
    """正常调用 Agent 应返回知识摘要"""
    mock_agent = AsyncMock()
    mock_message = MagicMock()
    mock_message.content = "Harness Engineering 是一种软件交付平台..."
    mock_agent.ainvoke.return_value = {"messages": [successful_tool_message(), mock_message]}

    with (
        patch("app.services.search_service.get_settings", return_value=mock_settings_enabled),
        patch("app.services.search_service._build_agent", return_value=(mock_agent, MagicMock())),
    ):
        from app.services.search_service import fetch_knowledge_context

        result = await fetch_knowledge_context("Harness Engineering")
        assert "Harness Engineering" in result
        mock_agent.ainvoke.assert_called_once()


@pytest.mark.asyncio
async def test_fetch_truncates_long_context(mock_settings_enabled):
    """超长结果应被截断到 MAX_CONTEXT_LENGTH"""
    mock_agent = AsyncMock()
    mock_message = MagicMock()
    mock_message.content = "x" * 8000
    mock_agent.ainvoke.return_value = {"messages": [successful_tool_message(), mock_message]}

    with (
        patch("app.services.search_service.get_settings", return_value=mock_settings_enabled),
        patch("app.services.search_service._build_agent", return_value=(mock_agent, MagicMock())),
    ):
        from app.services.search_service import fetch_knowledge_context, MAX_CONTEXT_LENGTH

        result = await fetch_knowledge_context("test")
        assert len(result) == MAX_CONTEXT_LENGTH


@pytest.mark.asyncio
async def test_fetch_fails_explicitly_on_timeout(mock_settings_enabled):
    """启用搜索后超时应停止，避免静默凭记忆出题。"""
    mock_agent = AsyncMock()
    mock_agent.ainvoke.side_effect = asyncio.TimeoutError()

    with (
        patch("app.services.search_service.get_settings", return_value=mock_settings_enabled),
        patch("app.services.search_service._build_agent", return_value=(mock_agent, MagicMock())),
    ):
        from app.services.search_service import fetch_knowledge_context

        with pytest.raises(QuizGenerationError):
            await fetch_knowledge_context("test")


@pytest.mark.asyncio
async def test_fetch_fails_explicitly_on_exception(mock_settings_enabled):
    """启用搜索后异常应明确报错。"""
    mock_agent = AsyncMock()
    mock_agent.ainvoke.side_effect = RuntimeError("API error")

    with (
        patch("app.services.search_service.get_settings", return_value=mock_settings_enabled),
        patch("app.services.search_service._build_agent", return_value=(mock_agent, MagicMock())),
    ):
        from app.services.search_service import fetch_knowledge_context

        with pytest.raises(QuizGenerationError):
            await fetch_knowledge_context("test")


@pytest.mark.asyncio
async def test_fetch_fails_explicitly_on_empty_response(mock_settings_enabled):
    """有效检索后摘要为空仍应报错。"""
    mock_agent = AsyncMock()
    mock_message = MagicMock()
    mock_message.content = ""
    mock_agent.ainvoke.return_value = {"messages": [successful_tool_message(), mock_message]}

    with (
        patch("app.services.search_service.get_settings", return_value=mock_settings_enabled),
        patch("app.services.search_service._build_agent", return_value=(mock_agent, MagicMock())),
    ):
        from app.services.search_service import fetch_knowledge_context

        with pytest.raises(QuizGenerationError):
            await fetch_knowledge_context("test")

@pytest.mark.asyncio
async def test_authorization_error_cannot_become_reference_material(mock_settings_enabled):
    from langchain_core.messages import AIMessage, ToolMessage
    from app.core.exceptions import QuizGenerationError
    from app.services.search_service import fetch_knowledge_context
    agent = AsyncMock()
    agent.ainvoke.return_value = {'messages': [
        ToolMessage(content="{'error': Exception('Error 401: Unauthorized')}", tool_call_id='failed'),
        AIMessage(content='搜索失败，未找到相关资料。'),
    ]}
    with patch('app.services.search_service.get_settings', return_value=mock_settings_enabled), patch('app.services.search_service._build_agent', return_value=(agent, MagicMock())):
        with pytest.raises(QuizGenerationError, match='401'):
            await fetch_knowledge_context('harness engineering 是什么')

@pytest.mark.asyncio
async def test_summary_without_actual_search_is_rejected(mock_settings_enabled):
    from langchain_core.messages import AIMessage
    from app.core.exceptions import QuizGenerationError
    from app.services.search_service import fetch_knowledge_context
    agent = AsyncMock()
    agent.ainvoke.return_value = {'messages': [AIMessage(content='这是凭记忆生成的知识。')]}
    with patch('app.services.search_service.get_settings', return_value=mock_settings_enabled), patch('app.services.search_service._build_agent', return_value=(agent, MagicMock())):
        with pytest.raises(QuizGenerationError, match='有效'):
            await fetch_knowledge_context('harness engineering 是什么')


@pytest.mark.asyncio
async def test_partial_search_failure_accepts_actual_evidence(mock_settings_enabled):
    from langchain_core.messages import AIMessage
    from app.services.search_service import fetch_knowledge_context
    agent = AsyncMock()
    agent.ainvoke.return_value = {"messages": [
        ToolMessage(content='{"error":"timeout"}', tool_call_id="failed"),
        successful_tool_message(), AIMessage(content="基于有效资料的摘要"),
    ]}
    with patch("app.services.search_service.get_settings", return_value=mock_settings_enabled), patch("app.services.search_service._build_agent", return_value=(agent, MagicMock())):
        assert await fetch_knowledge_context("topic") == "基于有效资料的摘要"
