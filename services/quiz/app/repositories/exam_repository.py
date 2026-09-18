"""Persistent server-timed self-exams. Provider work is outside this state machine."""
import json
import uuid
from datetime import datetime, timedelta, timezone
from app.core.db import transaction
from app.core.exceptions import BankError
from app.models.question_source import canonical
from app.models.quiz import AnswerRecord
from app.repositories import exam_paper_repository as papers
from app.services.choice_grading import grade_choice
from app.services import exam_result


def utc_now():
    return datetime.now(timezone.utc)


def stamp(at):
    return at.isoformat(timespec='milliseconds')


def owned(cur, user_id, session_id):
    row = cur.execute('SELECT * FROM exam_sessions WHERE session_id=? AND user_id=?', (session_id, user_id)).fetchone()
    if row is None:
        raise BankError('考试不存在', 404)
    return row


def read(cur, row, now):
    paper = papers.owned(cur, row['user_id'], row['paper_id'])
    result = json.loads(row['result_json']) if row['result_json'] else None
    status = 'submitted' if result else 'expired' if now >= datetime.fromisoformat(row['deadline_at']) else 'running'
    items = json.loads(paper['items_json'])
    return dict(session_id=row['session_id'], paper_id=row['paper_id'], title=paper['title'],
                paper_revision=row['paper_revision'], revision=row['revision'], status=status,
                started_at=row['started_at'], deadline_at=row['deadline_at'],
                questions=[{k: v for k, v in i['question'].items() if k in ('id', 'type', 'stem', 'options', 'image_url')} for i in items],
                answer_records=json.loads(row['answers_json']), result=result)


async def start(user_id, paper_id, request):
    with transaction() as cur:
        paper = papers.owned(cur, user_id, paper_id)
        old = cur.execute('SELECT * FROM exam_sessions WHERE user_id=? AND request_id=?',
                          (user_id, str(request.request_id))).fetchone()
        now = utc_now()
        if old:
            if old['paper_id'] != paper_id or old['paper_revision'] != request.expected_revision:
                raise BankError('此请求编号已用于不同考试条件', 409)
            return read(cur, old, now)
        if not paper['approved'] or paper['revision'] != request.expected_revision:
            raise BankError('请先完成全部题目的覆盖审核并使用当前版本开考', 409)
        session_id = 'exam_' + uuid.uuid4().hex
        # Round once before calculating the deadline; storage precision never
        # gives a replay a fresh start or a different deadline.
        now = datetime.fromisoformat(stamp(now))
        deadline = now + timedelta(seconds=paper['duration_seconds'])
        cur.execute('''INSERT INTO exam_sessions(session_id,user_id,paper_id,request_id,paper_revision,
            started_at,deadline_at) VALUES (?,?,?,?,?,?,?)''',
            (session_id, user_id, paper_id, str(request.request_id), paper['revision'], stamp(now), stamp(deadline)))
        return read(cur, owned(cur, user_id, session_id), now)


async def get(user_id, session_id):
    with transaction() as cur:
        return read(cur, owned(cur, user_id, session_id), utc_now())


async def listing(user_id, page, page_size):
    with transaction() as cur:
        total = cur.execute('SELECT COUNT(*) FROM exam_sessions WHERE user_id=?', (user_id,)).fetchone()[0]
        rows = cur.execute('SELECT * FROM exam_sessions WHERE user_id=? ORDER BY id DESC LIMIT ? OFFSET ?',
                          (user_id, page_size, (page - 1) * page_size)).fetchall()
        now = utc_now()
        # Compact listing never includes question/answer content.
        items = [{k: v for k, v in read(cur, r, now).items() if k not in ('questions', 'answer_records', 'result')}
                 | {'accuracy': json.loads(r['result_json'])['accuracy'] if r['result_json'] else None} for r in rows]
        return dict(items=items, total=total, page=page, page_size=page_size)


def normalized(items, answers):
    questions = {i['question']['id']: i['question'] for i in items}
    result, seen = [], set()
    for answer in answers:
        value = answer.model_dump() if hasattr(answer, 'model_dump') else answer
        qid, selected = value['question_id'], value['selected_answers']
        if qid in seen or qid not in questions:
            raise BankError('答题记录包含重复或未知题目', 422)
        seen.add(qid)
        q = questions[qid]
        if len(set(selected)) != len(selected) or not set(selected) <= {o['key'] for o in q['options']} or (q['type'] != 'multiple' and len(selected) > 1):
            raise BankError('答题选项无效', 422)
        result.append(value | {'selected_answers': sorted(selected)})
    return sorted(result, key=lambda a: a['question_id'])


async def save(user_id, session_id, request):
    with transaction() as cur:
        row = owned(cur, user_id, session_id)
        now = utc_now()
        if row['result_json'] or now >= datetime.fromisoformat(row['deadline_at']):
            raise BankError('考试已结束，不能修改答案', 409)
        items = json.loads(papers.owned(cur, user_id, row['paper_id'])['items_json'])
        encoded = canonical(normalized(items, request.answer_records))
        if row['revision'] == request.expected_revision + 1 and row['answers_json'] == encoded:
            return read(cur, row, now)
        if row['revision'] != request.expected_revision:
            raise BankError('作答版本已变化，请重新读取', 409)
        cur.execute('UPDATE exam_sessions SET answers_json=?,revision=revision+1 WHERE session_id=?', (encoded, session_id))
        return read(cur, owned(cur, user_id, session_id), now)


async def submit(user_id, session_id, request):
    with transaction() as cur:
        row = owned(cur, user_id, session_id)
        paper = papers.owned(cur, user_id, row['paper_id'])
        items = json.loads(paper['items_json'])
        now = utc_now()
        deadline = datetime.fromisoformat(row['deadline_at'])
        if row['result_json']:
            result = json.loads(row['result_json'])
            if result['reason'] != 'timeout' and (row['submission_json'] != canonical(normalized(items, request.answer_records))
                                                  or row['revision'] != request.expected_revision + 1):
                raise BankError('已交卷，不能修改答案', 409)
            return read(cur, row, now)
        expired = now >= deadline
        if not expired and row['revision'] != request.expected_revision:
            raise BankError('作答版本已变化，请重新读取', 409)
        values = json.loads(row['answers_json']) if expired else normalized(items, request.answer_records)
        by_id = {v['question_id']: v for v in values}
        records = []
        groups = [a | {'correct_count': 0} for a in json.loads(paper['allocations_json'])]
        for item in items:
            q = item['question']
            value = by_id.get(q['id'], dict(question_id=q['id'], selected_answers=[], duration_ms=0))
            correct = grade_choice(value['selected_answers'], q['answer'])
            records.append(AnswerRecord(**value, is_correct=correct))
            groups[item['allocation_index']]['correct_count'] += int(correct)
        at = deadline if expired else now
        result = exam_result.persist(cur, user_id, paper, items, records, at)
        result.update(reason='timeout' if expired else 'submitted', submitted_at=stamp(at),
                      finalized_at=stamp(now), unanswered_count=sum(not r.selected_answers for r in records),
                      by_source=[g | {'accuracy': round(g['correct_count'] * 100 / g['count'], 2)} for g in groups],
                      answer_records=[r.model_dump() for r in records], questions=[i['question'] for i in items])
        cur.execute('''UPDATE exam_sessions SET answers_json=?,submission_json=?,result_json=?,revision=revision+1
            WHERE session_id=?''', (canonical(values), canonical(values), canonical(result), session_id))
        return read(cur, owned(cur, user_id, session_id), now)
