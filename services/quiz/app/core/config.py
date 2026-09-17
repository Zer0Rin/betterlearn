"""鱼皮AI闯关学习小程序 - 后端配置"""

from functools import lru_cache
import os

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    managed_host_token: str = ""
    # DeepSeek
    deepseek_api_key: str = "sk-xxx"
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-chat"

    # Tavily (Web Search)
    tavily_api_key: str = ""
    enable_web_search: bool = True

    # DashScope (百炼 Embedding，用于知识库 RAG)
    dashscope_api_key: str = ""
    dashscope_embedding_model: str = "text-embedding-v4"
    dashscope_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"

    # 知识库 / 向量存储
    chroma_persist_dir: str = "./data/chroma"
    kb_upload_dir: str = "./data/uploads"
    kb_max_documents_per_user: int = 10
    kb_max_file_size_mb: int = 10
    kb_chunk_size: int = 1000
    kb_chunk_overlap: int = 150
    kb_retrieve_top_k: int = 4

    # 题目配图（DashScope 千问-文生图 qwen-image）
    dashscope_image_model: str = "qwen-image-2.0"
    # 生图专用 API Key（留空时回退使用 dashscope_api_key）。
    # 注意：部分 sk-ws- 开头的工作空间 Key 按用途限定权限范围，Embedding 与生图可能需要各自的 Key。
    dashscope_image_api_key: str = ""
    # 图像生成使用的原生 DashScope API 地址（与 OpenAI 兼容模式的 dashscope_base_url 不同）
    # 留空时会自动从 dashscope_base_url 派生（将 /compatible-mode/v1 替换为 /api/v1）
    dashscope_image_base_url: str = ""
    image_gen_size: str = "512*512"
    image_gen_daily_limit: int = 20
    image_gen_max_concurrency: int = 5

    # 腾讯云 COS（用于持久化存储 AI 生成的题目配图）
    cos_secret_id: str = ""
    cos_secret_key: str = ""
    cos_region: str = ""
    cos_bucket: str = ""
    cos_upload_prefix: str = "quiz-images/"
    # 可选：自定义访问域名（如 CDN 加速域名），留空则使用 COS 默认域名
    cos_domain: str = ""

    # App
    app_host: str = "127.0.0.1"
    app_port: int = 8000
    app_debug: bool = True

    # 仅供本机 Web 迁移开发使用；生产环境必须保持关闭。
    local_login_enabled: bool = False
    local_login_trusted_origins: str = (
        "http://127.0.0.1:5173,http://localhost:5173,"
        "http://127.0.0.1:4173,http://localhost:4173"
    )

    # JWT
    jwt_secret: str = "change-me-in-production"
    jwt_expire_minutes: int = 43200  # 30 天

    # 微信小程序
    wechat_app_id: str = ""
    wechat_app_secret: str = ""

    # Local SQLite persistence
    quiz_db_path: str = "./data/quiz.sqlite3"
    local_image_dir: str = ""

    # Log
    log_level: str = "INFO"

    model_config = {"env_file": os.environ.get("BETTERLEARN_QUIZ_ENV_FILE", ".env"), "env_file_encoding": "utf-8", "extra": "ignore"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
