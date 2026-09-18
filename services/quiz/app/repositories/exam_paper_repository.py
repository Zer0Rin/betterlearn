"""Owned bank allocation, immutable snapshots and explicit human coverage review."""
import json
import uuid
from datetime import datetime, timezone
from pydantic import ValidationError
from app.core.db import transaction
from app.core.exceptions import BankError, ReportGenerationError
from app.models.question_source import canonical, CoreSource
from app.models.quiz import Question, AnswerRecord
from app.repositories.knowledge_stats_repository import question_content_key
from app.services.scoring_service import grade_answer_records

# Leave room for JSON wrappers/review notes under the Host 16 MiB response cap.
MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024


def owned(cur, user_id, paper_id):
    row = cur.execute('SELECT * FROM exam_papers WHERE paper_id=? AND user_id=?', (paper_id, user_id)).fetchone()
    if row is None:
        raise BankError('试卷不存在', 404)
    return row


def read(row):
    return dict(paper_id=row['paper_id'], title=row['title'], duration_seconds=row['duration_seconds'],
                revision=row['revision'], status='approved' if row['approved'] else 'draft',
                created_at=row['created_at'], allocations=json.loads(row['allocations_json']),
                items=json.loads(row['items_json']), reviews=json.loads(row['reviews_json']))


def allocate(cur, user_id, request):
    candidates, invalid = [], []
    for allocation in request.allocations:
        rows = cur.execute('''SELECT e.id,e.question_json,s.source_json,s.revision FROM question_bank_entries e
            JOIN question_bank_sources s ON s.entry_id=e.id WHERE e.user_id=?
            AND json_extract(s.source_json,'$.knowledge_point_id')=?
            AND json_extract(s.source_json,'$.content_version')=? ORDER BY e.id''',
            (user_id, allocation.knowledge_point_id, allocation.content_version)).fetchall()
        group, skipped = {}, 0
        for row in rows:
            try:
                q = Question.model_validate_json(row['question_json'])
                source = CoreSource.model_validate_json(row['source_json']).model_dump()
                checked = grade_answer_records([q], [AnswerRecord(question_id=q.id, selected_answers=q.answer,
                                                                  duration_ms=0, is_correct=False)])
                if not checked[0].is_correct:
                    raise ValueError('标准答案不能被正确判分')
                key = question_content_key(q.model_dump())
            except (ValidationError, ReportGenerationError, ValueError, KeyError):
                skipped += 1
                continue
            group.setdefault(key, dict(entry_id=row['id'], source_revision=row['revision'],
                                        source=source, question=q.model_dump()))
        candidates.append(group)
        invalid.append(skipped)
    # Bipartite matching avoids a greedy allocation consuming another source's
    # only candidate. A content key can fill exactly one slot across the paper.
    slots = [i for i, a in enumerate(request.allocations) for _ in range(a.count)]
    owner = {}

    def assign(slot, visited):
        for key in candidates[slots[slot]]:
            if key in visited:
                continue
            visited.add(key)
            if key not in owner or assign(owner[key], visited):
                owner[key] = slot
                return True
        return False

    for slot in range(len(slots)):
        assign(slot, set())
    selected = {slot: key for key, slot in owner.items()}
    counts = [0] * len(candidates)
    items = []
    for slot, allocation_index in enumerate(slots):
        if slot not in selected:
            continue
        counts[allocation_index] += 1
        item = candidates[allocation_index][selected[slot]]
        items.append(item | {'question': item['question'] | {'id': 'q' + str(len(items) + 1)},
                             'allocation_index': allocation_index})
    coverage = [a.model_dump() | {'selected': counts[i], 'missing': a.count - counts[i],
                                  'available_distinct': len(candidates[i]), 'invalid_count': invalid[i]}
                for i, a in enumerate(request.allocations)]
    if len(canonical(items).encode('utf-8')) > MAX_SNAPSHOT_BYTES:
        raise BankError('试卷来源快照过大，请减少题数或拆分试卷', 422)
    return dict(ready=len(items) == len(slots), total_questions=len(slots), coverage=coverage, items=items)


async def preview(user_id, request):
    with transaction() as cur:
        return allocate(cur, user_id, request)


async def create(user_id, request):
    normalized = canonical(request.model_dump(mode='json', exclude={'request_id'}))
    with transaction() as cur:
        old = cur.execute('SELECT * FROM exam_papers WHERE user_id=? AND request_id=?',
                          (user_id, str(request.request_id))).fetchone()
        if old:
            if old['request_json'] != normalized:
                raise BankError('此请求编号已用于不同组卷条件', 409)
            return read(old)
        selection = allocate(cur, user_id, request)
        if not selection['ready']:
            raise BankError('题库数量不足，请先预览来源缺口并补充题目', 409)
        paper_id = 'paper_' + uuid.uuid4().hex
        cur.execute('''INSERT INTO exam_papers(paper_id,user_id,request_id,request_json,title,
            duration_seconds,allocations_json,items_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)''',
            (paper_id, user_id, str(request.request_id), normalized, request.title, request.duration_seconds,
             canonical([a.model_dump() for a in request.allocations]), canonical(selection['items']),
             datetime.now(timezone.utc).isoformat(timespec='milliseconds')))
        return read(owned(cur, user_id, paper_id))


async def get(user_id, paper_id):
    with transaction() as cur:
        return read(owned(cur, user_id, paper_id))


async def listing(user_id, page, page_size):
    with transaction() as cur:
        total = cur.execute('SELECT COUNT(*) FROM exam_papers WHERE user_id=?', (user_id,)).fetchone()[0]
        rows = cur.execute('''SELECT paper_id,title,duration_seconds,revision,approved,created_at
            FROM exam_papers WHERE user_id=? ORDER BY id DESC LIMIT ? OFFSET ?''',
            (user_id, page_size, (page - 1) * page_size)).fetchall()
        return dict(items=[dict(r) for r in rows], total=total, page=page, page_size=page_size)


async def review(user_id, paper_id, request):
    with transaction() as cur:
        row = owned(cur, user_id, paper_id)
        values = sorted([r.model_dump() for r in request.reviews], key=lambda r: r['question_id'])
        ids = [r['question_id'] for r in values]
        required = {i['question']['id'] for i in json.loads(row['items_json'])}
        if len(set(ids)) != len(ids) or set(ids) != required:
            raise BankError('审核必须包含全部题目且不得重复', 422)
        encoded = canonical(values)
        if row['revision'] == request.expected_revision + 1 and row['reviews_json'] == encoded:
            return read(row)
        if row['revision'] != request.expected_revision:
            raise BankError('审核版本已变化，请重新读取', 409)
        if cur.execute('SELECT 1 FROM exam_sessions WHERE paper_id=? LIMIT 1', (paper_id,)).fetchone():
            raise BankError('试卷已用于考试，不能修改审核；请新建试卷', 409)
        cur.execute('UPDATE exam_papers SET reviews_json=?,approved=?,revision=revision+1 WHERE paper_id=?',
                    (encoded, int(all(r['approved'] for r in values)), paper_id))
        return read(owned(cur, user_id, paper_id))
