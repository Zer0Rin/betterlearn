"""Goals own conditions, not mastery. No provider calls or cross-Core writes."""
from datetime import datetime, timezone
import hashlib
import json
import uuid
from app.core.db import transaction
from app.core.exceptions import BankError
from app.models.learning_goal import parse_utc, utc_text
from app.models.knowledge_stats import KnowledgeAssessmentQuery
from app.models.question_source import canonical
from app.repositories.knowledge_stats_repository import assessment_in_transaction, source_summary
from app.services.evidence_scoring import POLICY_VERSION


def utc_now():
    return datetime.now(timezone.utc)


def _owned(cur, user_id, goal_id):
    row = cur.execute('SELECT * FROM learning_goals WHERE user_id=? AND goal_id=?', (user_id, goal_id)).fetchone()
    if row is None:
        raise BankError('学习目标不存在', 404)
    return row


def _summary(row):
    result = {key: row[key] for key in ('goal_id', 'request_id', 'title', 'target_percent',
        'min_distinct_questions', 'due_at', 'policy_version', 'revision', 'created_at')}
    result['archived'] = bool(row['archived'])
    result['source'] = source_summary(json.loads(row['source_json']))
    return result


async def create(user_id, request):
    encoded = canonical(request.model_dump())
    digest = hashlib.sha256(encoded.encode()).hexdigest()
    with transaction() as cur:
        old = cur.execute('SELECT * FROM learning_goals WHERE user_id=? AND request_id=?',
                          (user_id, request.request_id)).fetchone()
        if old:
            if old['request_digest'] != digest:
                raise BankError('请求编号已用于不同的学习目标', 409)
            return _summary(old)
        now = utc_now()
        if parse_utc(request.due_at) <= now:
            raise BankError('新目标截止时间必须晚于当前时间', 422)
        goal_id = 'goal_' + uuid.uuid4().hex
        cur.execute('''INSERT INTO learning_goals(goal_id,user_id,request_id,request_digest,create_request_json,
            title,source_json,knowledge_point_id,content_version,target_percent,min_distinct_questions,
            due_at,policy_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
            (goal_id, user_id, request.request_id, digest, encoded, request.title,
             canonical(request.source.model_dump()), request.source.knowledge_point_id, request.source.content_version,
             request.target_percent, request.min_distinct_questions, request.due_at, POLICY_VERSION, utc_text(now)))
        return _summary(_owned(cur, user_id, goal_id))


async def lookup(user_id, request_id):
    with transaction() as cur:
        row = cur.execute('SELECT goal_id,create_request_json FROM learning_goals WHERE user_id=? AND request_id=?',
                          (user_id, request_id.lower())).fetchone()
        if row is None:
            raise BankError('学习目标请求不存在', 404)
        return {'goal_id': row['goal_id'], 'request': json.loads(row['create_request_json'])}


async def listing(user_id, query):
    where, values = 'user_id=?', [user_id]
    if query.status != 'all':
        where += ' AND archived=?'
        values.append(int(query.status == 'archived'))
    with transaction() as cur:
        total = cur.execute('SELECT COUNT(*) FROM learning_goals WHERE ' + where, values).fetchone()[0]
        rows = cur.execute('SELECT * FROM learning_goals WHERE ' + where + ' ORDER BY id DESC LIMIT ? OFFSET ?',
                           [*values, query.page_size, (query.page - 1) * query.page_size])
        return {'items': [_summary(row) for row in rows], 'total': total, 'page': query.page, 'page_size': query.page_size}


async def detail(user_id, goal_id):
    with transaction() as cur:
        row = _owned(cur, user_id, goal_id)
        if row['policy_version'] != POLICY_VERSION:
            raise BankError('目标评估政策不可用', 503)
        # Match the stored millisecond precision throughout one snapshot.
        now = parse_utc(utc_text(utc_now()))
        due = parse_utc(row['due_at'])
        cutoff = min(now, due)
        progress = assessment_in_transaction(cur, user_id, KnowledgeAssessmentQuery(
            knowledge_point_id=row['knowledge_point_id'], content_version=row['content_version']), cutoff)
        score, count = progress['evidence_score'], progress['distinct_question_count']
        progress.update(evaluated_at=utc_text(now), evidence_cutoff_at=utc_text(cutoff),
            deadline_passed=now >= due,
            criteria_met=score is not None and score >= row['target_percent'] / 100 and count >= row['min_distinct_questions'],
            remaining_distinct_questions=max(0, row['min_distinct_questions'] - count))
        return _summary(row) | {'progress': progress}


async def archive(user_id, goal_id, request):
    with transaction() as cur:
        row = _owned(cur, user_id, goal_id)
        if row['revision'] == request.expected_revision + 1 and bool(row['archived']) == request.archived:
            return _summary(row)
        if row['revision'] != request.expected_revision:
            raise BankError('目标版本已变化，请重新读取', 409)
        cur.execute('UPDATE learning_goals SET archived=?,revision=revision+1 WHERE id=?',
                    (int(request.archived), row['id']))
        return _summary(_owned(cur, user_id, goal_id))
