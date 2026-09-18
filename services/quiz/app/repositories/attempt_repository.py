"""Short SQLite transactions own attempts, revisions, submission and report claims.

The grade-then-record flow follows DeepTutor learning/service.py; deterministic
choice grading reuses our attributed adaptation. No model runs in a transaction.
"""
from __future__ import annotations

import hashlib
import json
import uuid

from pydantic import ValidationError

from app.core.db import transaction
from app.core.exceptions import AttemptError, ReportGenerationError
from app.models.quiz import AnswerRecord, Question
from app.services.question_bank_projection import record_attempt
from app.services.scoring_service import compute_score_summary, grade_answer_records


def _quiz(cur, quiz_id, user_id):
    row = cur.execute('SELECT * FROM quiz_sessions WHERE quiz_id=? AND user_id=?', (quiz_id, user_id)).fetchone()
    if row is None:
        raise AttemptError('题卷或作答不存在', 404)
    return row


def _owned(cur, attempt_id, user_id):
    row = cur.execute('''SELECT a.* FROM quiz_attempts a JOIN quiz_sessions q ON q.quiz_id=a.quiz_id
        WHERE a.attempt_id=? AND a.user_id=? AND q.user_id=?''', (attempt_id, user_id, user_id)).fetchone()
    if row is None:
        raise AttemptError('题卷或作答不存在', 404)
    return row


def _read(cur, row):
    result = dict(row)
    result.pop('id')
    result.pop('submission_hash')
    legacy_records = result.pop('legacy_records_json')
    result['questions'] = json.loads(result.pop('questions_json'))
    records = cur.execute('SELECT * FROM quiz_attempt_answers WHERE attempt_id=?', (row['attempt_id'],)).fetchall()
    by_id = {r['question_id']: {'question_id': r['question_id'],
        'selected_answers': json.loads(r['selected_answers_json']), 'duration_ms': r['duration_ms'],
        'is_correct': bool(r['is_correct']) if r['is_correct'] is not None else None} for r in records}
    result['answer_records'] = (json.loads(legacy_records) if legacy_records is not None else
                                [by_id[q['id']] for q in result['questions'] if q['id'] in by_id])
    report = cur.execute('SELECT * FROM quiz_attempt_reports WHERE attempt_id=?', (row['attempt_id'],)).fetchone()
    result['report_status'] = report['status'] if report else 'not_requested'
    result['report'] = json.loads(report['report_json']) if report and report['report_json'] else None
    result['report_error'] = report['error_message'] if report else None
    return result


def _create(cur, quiz, user_id, request_id=None, legacy=False):
    attempt_id = 'attempt_' + uuid.uuid4().hex
    cur.execute('''INSERT INTO quiz_attempts(attempt_id,quiz_id,user_id,request_id,title,questions_json,status,legacy_source)
        VALUES (?,?,?,?,?,?,'draft',?)''',
        (attempt_id, quiz['quiz_id'], user_id, request_id, quiz['title'], quiz['questions_json'], int(legacy)))
    return _owned(cur, attempt_id, user_id)


async def create_attempt(quiz_id: str, user_id: int, request_id: str) -> dict:
    with transaction() as cur:
        quiz = _quiz(cur, quiz_id, user_id)
        old = cur.execute('SELECT * FROM quiz_attempts WHERE user_id=? AND request_id=?', (user_id, request_id)).fetchone()
        if old and old['quiz_id'] != quiz_id:
            raise AttemptError('此请求编号已用于另一份题卷')
        return _read(cur, old if old else _create(cur, quiz, user_id, request_id))


async def get_attempt(attempt_id: str, user_id: int) -> dict:
    with transaction() as cur:
        return _read(cur, _owned(cur, attempt_id, user_id))


async def list_attempts(quiz_id: str, user_id: int) -> list[dict]:
    with transaction() as cur:
        _quiz(cur, quiz_id, user_id)
        return [dict(r) for r in cur.execute('''SELECT attempt_id, quiz_id, status, revision, created_at,
            submitted_at, total_questions, correct_count, accuracy, xp_gain FROM quiz_attempts
            WHERE quiz_id=? AND user_id=? ORDER BY created_at DESC, id DESC''', (quiz_id, user_id)).fetchall()]


def _validated(row, answers, complete):
    try:
        questions = [Question.model_validate(q) for q in json.loads(row['questions_json'])]
        records = [AnswerRecord(question_id=a.question_id, selected_answers=a.selected_answers,
                                duration_ms=a.duration_ms, is_correct=False) for a in answers]
        if complete:
            return grade_answer_records(questions, records)
        ids = {r.question_id for r in records}
        if not ids <= {q.id for q in questions} or len(ids) != len(records):
            raise AttemptError('答题记录包含重复或未知题目', 422)
        return grade_answer_records([q for q in questions if q.id in ids], records) if records else []
    except (ReportGenerationError, ValidationError) as exc:
        raise AttemptError(str(exc) if isinstance(exc, ReportGenerationError) else '题目快照无效', 422) from None


def _hash(answers):
    normalized = sorted([{'question_id': a.question_id, 'selected_answers': sorted(a.selected_answers),
                          'duration_ms': a.duration_ms} for a in answers], key=lambda a: a['question_id'])
    return hashlib.sha256(json.dumps(normalized, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def _write_answers(cur, attempt_id, records, submitted):
    cur.execute('DELETE FROM quiz_attempt_answers WHERE attempt_id=?', (attempt_id,))
    cur.executemany('INSERT INTO quiz_attempt_answers VALUES (?,?,?,?,?)',
        [(attempt_id, r.question_id, json.dumps(r.selected_answers), r.duration_ms,
          int(r.is_correct) if submitted else None) for r in records])


async def save_answers(attempt_id: str, user_id: int, expected_revision: int, answers: list) -> dict:
    with transaction() as cur:
        row = _owned(cur, attempt_id, user_id)
        if row['status'] != 'draft' or row['revision'] != expected_revision:
            raise AttemptError('作答状态已变化，请重新读取后保存')
        records = _validated(row, answers, False)
        _write_answers(cur, attempt_id, records, False)
        cur.execute('UPDATE quiz_attempts SET revision=revision+1 WHERE attempt_id=?', (attempt_id,))
        return _read(cur, _owned(cur, attempt_id, user_id))


def _submit(cur, row, user_id, expected_revision, answers):
    digest = _hash(answers)
    if row['status'] == 'submitted':
        if row['submission_hash'] != digest:
            raise AttemptError('已交卷，不能修改答案；请创建新的作答轮次')
        return _read(cur, row)
    if row['revision'] != expected_revision:
        raise AttemptError('作答版本已变化，请重新读取后交卷')
    records = _validated(row, answers, True)
    summary = compute_score_summary(records)
    # Any previous submission (including imported v1 results) consumes the one
    # award for this quiz. Serialize this check with status transition and XP.
    awarded = cur.execute("SELECT 1 FROM quiz_attempts WHERE quiz_id=? AND status='submitted' LIMIT 1",
                          (row['quiz_id'],)).fetchone()
    legacy = cur.execute('SELECT 1 FROM answer_records WHERE quiz_id=?', (row['quiz_id'],)).fetchone()
    xp = 0 if awarded or legacy else 10 + summary['correct'] * 2
    _write_answers(cur, row['attempt_id'], records, True)
    cur.execute('''UPDATE quiz_attempts SET status='submitted', revision=revision+1,
        submitted_at=strftime('%Y-%m-%d %H:%M:%f','now'), total_questions=?, correct_count=?,
        accuracy=?, xp_gain=?, submission_hash=? WHERE attempt_id=?''',
        (summary['total'], summary['correct'], summary['accuracy'], xp, digest, row['attempt_id']))
    cur.execute('UPDATE users SET total_xp=total_xp+? WHERE id=?', (xp, user_id))
    saved = _owned(cur, row['attempt_id'], user_id)
    record_attempt(cur, saved)
    return _read(cur, saved)


async def submit_attempt(attempt_id: str, user_id: int, expected_revision: int, answers: list) -> dict:
    with transaction() as cur:
        return _submit(cur, _owned(cur, attempt_id, user_id), user_id, expected_revision, answers)


async def submit_legacy(quiz_id: str, user_id: int, answers: list) -> dict:
    """One compatibility round, created and submitted atomically; retry uses saved facts."""
    with transaction() as cur:
        quiz = _quiz(cur, quiz_id, user_id)
        row = cur.execute('SELECT * FROM quiz_attempts WHERE quiz_id=? AND user_id=? AND legacy_source=1',
                          (quiz_id, user_id)).fetchone()
        if row and row['status'] == 'submitted':
            return _read(cur, row)
        row = row or _create(cur, quiz, user_id, legacy=True)
        return _submit(cur, row, user_id, row['revision'], answers)


async def claim_report(attempt_id: str, user_id: int) -> tuple[dict, str | None]:
    with transaction() as cur:
        row = _owned(cur, attempt_id, user_id)
        if row['status'] != 'submitted':
            raise AttemptError('请先交卷，再生成报告')
        attempt = _read(cur, row)
        if attempt['report_status'] == 'completed':
            return attempt, None
        if attempt['report_status'] == 'running':
            raise AttemptError('报告正在生成，请稍后读取结果')
        token = uuid.uuid4().hex
        cur.execute('''INSERT INTO quiz_attempt_reports(attempt_id,status,generation_token)
            VALUES (?,'running',?) ON CONFLICT(attempt_id) DO UPDATE SET
            status='running', generation_token=excluded.generation_token, report_json=NULL,
            error_message=NULL, updated_at=CURRENT_TIMESTAMP''', (attempt_id, token))
        return attempt, token


async def finish_report(attempt_id: str, user_id: int, token: str, output: dict | None = None) -> None:
    with transaction() as cur:
        _owned(cur, attempt_id, user_id)
        cur.execute('''UPDATE quiz_attempt_reports SET status=?, report_json=?, error_message=?,
            updated_at=CURRENT_TIMESTAMP WHERE attempt_id=? AND generation_token=? AND status='running' ''',
            ('completed' if output is not None else 'failed', json.dumps(output, ensure_ascii=False) if output is not None else None,
             None if output is not None else '报告生成未完成，成绩已保存，可重试报告', attempt_id, token))
        if cur.rowcount != 1:
            raise AttemptError('报告状态已变化，请重新读取结果')
