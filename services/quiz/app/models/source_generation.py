from typing import Literal
from pydantic import BaseModel, ConfigDict, Field
from app.models.question_source import CoreSource


class SourceGenerateRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,100}$')
    source: CoreSource
    user_input: str = Field(default='围绕所选知识点出题', min_length=1, max_length=2000)
    question_count: int = Field(default=5, strict=True, ge=3, le=10)
    difficulty: Literal['easy', 'medium', 'hard', 'mixed'] = 'mixed'
    generate_images: bool = Field(default=False, strict=True)
