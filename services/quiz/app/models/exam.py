"""Strict inputs for bank-backed self-exams; no client scores or source snapshots."""
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


class Allocation(StrictModel):
    knowledge_point_id: str = Field(pattern=r'^kp_[0-9a-f]{20}$')
    content_version: str = Field(pattern=r'^[0-9a-f]{64}$')
    count: int = Field(strict=True, ge=1, le=100)


class PaperPreview(StrictModel):
    title: str = Field(min_length=1, max_length=120)
    duration_seconds: int = Field(strict=True, ge=60, le=14400)
    allocations: list[Allocation] = Field(min_length=1, max_length=20)

    @field_validator('title')
    @classmethod
    def title_trim(cls, value):
        if not value.strip():
            raise ValueError('标题不能为空')
        return value.strip()

    @model_validator(mode='after')
    def bounds(self):
        keys = [(a.knowledge_point_id, a.content_version) for a in self.allocations]
        if len(set(keys)) != len(keys) or sum(a.count for a in self.allocations) > 100:
            raise ValueError('来源不能重复，总题数不得超过100')
        return self


class PaperCreate(PaperPreview):
    request_id: UUID


class Revision(StrictModel):
    expected_revision: int = Field(strict=True, ge=0, le=9007199254740990)


class Review(StrictModel):
    question_id: str = Field(pattern=r'^q[1-9][0-9]{0,2}$')
    approved: bool = Field(strict=True)
    note: str = Field(default='', max_length=1000)


class PaperReview(Revision):
    reviews: list[Review] = Field(min_length=1, max_length=100)


class ExamStart(Revision):
    request_id: UUID


class ExamAnswer(StrictModel):
    question_id: str = Field(pattern=r'^q[1-9][0-9]{0,2}$')
    selected_answers: list[str] = Field(max_length=100)
    duration_ms: int = Field(strict=True, ge=0, le=14400000)


class ExamAnswers(Revision):
    answer_records: list[ExamAnswer] = Field(max_length=100)
