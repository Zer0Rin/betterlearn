"""Immutable goal conditions and strictly bounded archive/list requests."""
from datetime import datetime, timezone
import re
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator
from app.models.question_source import CoreSource

UUID_PATTERN = r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
GOAL_PATTERN = r'^goal_[0-9a-f]{32}$'
_DATE = re.compile(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)', re.ASCII)


def utc_text(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def parse_utc(value: str) -> datetime:
    return datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(timezone.utc)


def normalize_due_at(value: str) -> str:
    if not _DATE.fullmatch(value):
        raise ValueError('截止时间必须为含时区的 RFC3339 时间，最多毫秒精度')
    try:
        # fromisoformat validates the calendar and timezone bounds as well.
        return utc_text(parse_utc(value))
    except (ValueError, OverflowError) as error:
        raise ValueError('截止时间无效') from error


class GoalCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_id: str = Field(pattern=UUID_PATTERN)
    title: str = Field(min_length=1, max_length=120)
    source: CoreSource
    target_percent: int = Field(default=90, strict=True, ge=1, le=100)
    min_distinct_questions: int = Field(default=5, strict=True, ge=3, le=100)
    due_at: str

    @field_validator('title', mode='before')
    @classmethod
    def trim_title(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator('request_id')
    @classmethod
    def normalize_uuid(cls, value):
        return value.lower()

    @field_validator('due_at')
    @classmethod
    def normalize_date(cls, value):
        return normalize_due_at(value)


class GoalArchive(BaseModel):
    model_config = ConfigDict(extra='forbid')
    expected_revision: int = Field(strict=True, ge=0, le=9007199254740990)
    archived: bool = Field(strict=True)


class GoalList(BaseModel):
    model_config = ConfigDict(extra='forbid')
    page: int = Field(default=1, ge=1, le=1000000)
    page_size: int = Field(default=20, ge=1, le=50)
    status: Literal['active', 'archived', 'all'] = 'active'
