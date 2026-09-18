"""Client input carries selections, never authoritative grades."""
from pydantic import BaseModel, Field


class AttemptCreateRequest(BaseModel):
    request_id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,100}$')


class AttemptAnswer(BaseModel):
    question_id: str = Field(min_length=1, max_length=100)
    selected_answers: list[str] = Field(min_length=1, max_length=100)
    duration_ms: int = Field(ge=0)


class AttemptAnswersRequest(BaseModel):
    expected_revision: int = Field(ge=0)
    answer_records: list[AttemptAnswer] = Field(max_length=100)
