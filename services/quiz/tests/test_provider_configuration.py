"""Unconfigured providers stay offline; transient failures are not retried."""
from unittest.mock import patch

import httpx
import openai
import pytest

from app.core.config import get_settings
from app.core.exceptions import KnowledgeBaseError, QuizGenerationError
from app.llm import langchain_factory
from app.services import rag_service, search_service, vector_store_service


@pytest.fixture(autouse=True)
def clear_provider_caches():
    langchain_factory.get_chat_model.cache_clear()
    vector_store_service.get_embeddings.cache_clear()
    yield
    langchain_factory.get_chat_model.cache_clear()
    vector_store_service.get_embeddings.cache_clear()


@pytest.mark.parametrize('builder', [langchain_factory.get_chat_model, lambda: rag_service._build_agent(1, 'doc'), search_service._build_agent])
def test_missing_text_key_fails_before_client_creation(monkeypatch, builder):
    monkeypatch.setattr(get_settings(), 'deepseek_api_key', '  ')
    with patch('langchain_openai.ChatOpenAI') as client:
        with pytest.raises(QuizGenerationError, match='设置.*文本模型 API Key'):
            builder()
        client.assert_not_called()


def test_missing_embedding_key_fails_before_client_creation(monkeypatch):
    monkeypatch.setattr(get_settings(), 'dashscope_api_key', '')
    with patch('langchain_openai.OpenAIEmbeddings') as client:
        with pytest.raises(KnowledgeBaseError, match='设置.*向量模型 API Key'):
            vector_store_service.get_embeddings()
        client.assert_not_called()


@pytest.mark.parametrize('provider', ['text', 'embedding', 'rag', 'search'])
def test_transient_provider_failure_is_one_http_attempt(monkeypatch, provider):
    settings = get_settings()
    monkeypatch.setattr(settings, 'deepseek_api_key', 'test-key')
    monkeypatch.setattr(settings, 'dashscope_api_key', 'test-key')
    monkeypatch.setattr(settings, 'tavily_api_key', 'test-key')
    calls = []
    def unavailable(request):
        calls.append(request)
        return httpx.Response(503, json={'error': {'message': 'unavailable', 'type': 'server_error'}})
    with httpx.Client(transport=httpx.MockTransport(unavailable)) as http_client:
        import langchain_openai
        chat = langchain_openai.ChatOpenAI
        embedding = langchain_openai.OpenAIEmbeddings
        if provider == 'embedding':
            with patch('langchain_openai.OpenAIEmbeddings', side_effect=lambda **kw: embedding(http_client=http_client, **kw)):
                model = vector_store_service.get_embeddings()
            operation = lambda: model.embed_query('test')
        elif provider == 'text':
            with patch.object(langchain_factory, 'ChatOpenAI', side_effect=lambda **kw: chat(http_client=http_client, **kw)):
                model = langchain_factory.get_chat_model()
            operation = lambda: model.invoke('test')
        else:
            with patch('langchain_openai.ChatOpenAI', side_effect=lambda **kw: chat(http_client=http_client, **kw)), patch('langgraph.prebuilt.create_react_agent', side_effect=lambda model, **kw: model):
                model = rag_service._build_agent(1, 'doc') if provider == 'rag' else search_service._build_agent()[0]
            operation = lambda: model.invoke('test')
        with pytest.raises(openai.InternalServerError):
            operation()
    assert len(calls) == 1
