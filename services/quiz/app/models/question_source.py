"""Only managed Host may supply a verified, frozen Core unit snapshot."""
import hashlib
import json
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'))


class QuoteEvidence(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['quote']
    quote: str = Field(max_length=262144)
    contextBefore: str = Field(max_length=262144)
    contextAfter: str = Field(max_length=262144)
    textStart: int = Field(strict=True, ge=0)
    textEnd: int = Field(strict=True, ge=0)


class SummaryEvidence(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['summary']
    text: str = Field(max_length=2000)


class CoreSource(BaseModel):
    model_config = ConfigDict(extra='forbid')
    schema_version: Literal[1]
    course_id: str = Field(pattern=r'^course_[0-9a-f]{20}$')
    unit_id: str = Field(pattern=r'^unit_[0-9a-f]{20}$')
    knowledge_point_id: str = Field(pattern=r'^kp_[0-9a-f]{20}$')
    type: Literal['concept', 'process', 'comparison', 'formula', 'fact', 'code']
    title: str = Field(min_length=1, max_length=120)
    statement: str = Field(min_length=1, max_length=2000)
    evidence: QuoteEvidence | SummaryEvidence
    content_version: str = Field(pattern=r'^[0-9a-f]{64}$')

    @model_validator(mode='after')
    def verify_content_version(self):
        content = self.model_dump(include={'knowledge_point_id', 'type', 'title', 'statement', 'evidence'})
        if hashlib.sha256(canonical(content).encode()).hexdigest() != self.content_version:
            raise ValueError('来源快照版本不匹配')
        return self


class SourceUpdate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    expected_revision: int = Field(strict=True, ge=0, le=9007199254740990)
    source: CoreSource | None
