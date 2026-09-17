"""LangChain ChatOpenAI 工厂"""

from functools import lru_cache

from langchain_openai import ChatOpenAI

from app.core.config import get_settings
from app.core.exceptions import QuizGenerationError


@lru_cache()
def get_chat_model(temperature: float = 0.4) -> ChatOpenAI:
    settings = get_settings()
    if not settings.deepseek_api_key.strip():
        raise QuizGenerationError("请先在设置中配置文本模型 API Key")
    return ChatOpenAI(
        model=settings.deepseek_model,
        base_url=settings.deepseek_base_url,
        api_key=settings.deepseek_api_key,
        max_retries=0,
        temperature=temperature,
        max_tokens=4096,
    )
