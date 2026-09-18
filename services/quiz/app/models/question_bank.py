from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator


class BankQuery(BaseModel):
    model_config = ConfigDict(extra='forbid')
    page: int = Field(default=1, ge=1, le=1000000)
    page_size: int = Field(default=20, ge=1, le=100)
    scope: Literal['all', 'wrong', 'ever_wrong', 'bookmarked', 'uncategorized'] = 'all'
    category_id: int | None = Field(default=None, ge=1, le=9223372036854775807)
    quiz_id: str | None = Field(default=None, pattern=r'^[A-Za-z0-9_-]{1,100}$')
    search: str = Field(default='', max_length=200)
    sort: Literal['recent', 'oldest'] = 'recent'


class BookmarkUpdate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    bookmarked: bool = Field(strict=True)


class CategoryName(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: str = Field(min_length=1, max_length=100)

    @field_validator('name')
    @classmethod
    def clean_name(cls, value):
        cleaned = value.strip()
        if not cleaned:
            raise ValueError('分类名称不能为空')
        return cleaned
