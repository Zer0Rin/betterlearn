from pydantic import BaseModel, ConfigDict, Field, model_validator


class KnowledgeStatsQuery(BaseModel):
    model_config = ConfigDict(extra='forbid')
    page: int = Field(default=1, ge=1, le=1000000)
    page_size: int = Field(default=20, ge=1, le=100)
    knowledge_point_id: str | None = Field(default=None, pattern=r'^kp_[0-9a-f]{20}$')
    content_version: str | None = Field(default=None, pattern=r'^[0-9a-f]{64}$')

    @model_validator(mode='after')
    def require_point_for_version(self):
        if self.content_version is not None and self.knowledge_point_id is None:
            raise ValueError('内容版本必须同时指定知识点 ID')
        return self


class KnowledgeHistoryQuery(KnowledgeStatsQuery):
    knowledge_point_id: str = Field(pattern=r'^kp_[0-9a-f]{20}$')
    content_version: str = Field(pattern=r'^[0-9a-f]{64}$')


class KnowledgeAssessmentQuery(BaseModel):
    model_config = ConfigDict(extra='forbid')
    knowledge_point_id: str = Field(pattern=r'^kp_[0-9a-f]{20}$')
    content_version: str = Field(pattern=r'^[0-9a-f]{64}$')
