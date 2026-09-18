"""Read committed, versioned evidence without rewriting mastery or attribution."""
import hashlib
import json
from datetime import datetime, timezone
from app.core.db import transaction
from app.models.question_source import canonical


def question_content_key(question):
    """Exact assessment content v1; IDs and presentation metadata are excluded."""
    content = {key: question[key] for key in ('type', 'stem')}
    content['options'] = sorted(question['options'], key=lambda o: (o['key'], o['text']))
    content['answer'] = sorted(question['answer'])
    content['image_url'] = question.get('image_url')
    return 'qcontent_v1_' + hashlib.sha256(canonical(content).encode()).hexdigest()


def source_summary(source):
    # Evidence can be large; full snapshots remain available in entry history.
    return {key: value for key, value in source.items() if key != 'evidence'}


def _query(user_id, query):
    sql = """ FROM question_bank_attempts b
        JOIN question_bank_entries e ON e.id=b.entry_id
        JOIN quiz_attempts a ON a.attempt_id=b.attempt_id AND a.quiz_id=e.quiz_id
        JOIN quiz_attempt_answers r ON r.attempt_id=a.attempt_id AND r.question_id=e.question_id
        WHERE e.user_id=? AND a.user_id=? AND a.status='submitted'
        AND a.legacy_records_json IS NULL AND r.is_correct IN (0,1)
        AND json_array_length(r.selected_answers_json)>0
        AND b.source_json IS NOT NULL AND b.source_revision>0"""
    values = [user_id, user_id]
    for name in ('knowledge_point_id', 'content_version'):
        value = getattr(query, name)
        if value is not None:
            sql += f" AND json_extract(b.source_json,'$.{name}')=?"
            values.append(value)
    return sql, values


def _percentage(correct, total):
    return round(correct * 100 / total, 2) if total else None


async def statistics(user_id, query):
    groups, content_keys = {}, {}
    with transaction() as cur:
        sql, values = _query(user_id, query)
        rows = cur.execute("""SELECT b.id,b.entry_id,b.source_json,e.question_hash,e.question_json,
            a.attempt_id,a.submitted_at,r.is_correct""" + sql + ' ORDER BY b.id', values)
        for row in rows:
            source = json.loads(row['source_json'])
            key = (source['knowledge_point_id'], source['content_version'])
            group = groups.setdefault(key, {'answer_count': 0, 'correct_count': 0,
                'first_answered_at': row['submitted_at'], '_first': {}, '_latest': {},
                '_entries': set(), '_attempts': set()})
            if row['question_hash'] not in content_keys:
                content_keys[row['question_hash']] = question_content_key(json.loads(row['question_json']))
            content_key = content_keys[row['question_hash']]
            correct = bool(row['is_correct'])
            group['answer_count'] += 1
            group['correct_count'] += int(correct)
            group['_first'].setdefault(content_key, correct)
            group['_latest'][content_key] = correct
            group['_entries'].add(row['entry_id'])
            group['_attempts'].add(row['attempt_id'])
            group['_last_id'] = row['id']
            group['last_answered_at'] = row['submitted_at']
            group['source'] = source_summary(source)
    ordered = sorted(groups.values(), key=lambda g: g['_last_id'], reverse=True)
    offset = (query.page - 1) * query.page_size
    items = []
    for group in ordered[offset:offset + query.page_size]:
        distinct = len(group['_first'])
        first_correct, latest_correct = sum(group['_first'].values()), sum(group['_latest'].values())
        item = {k: v for k, v in group.items() if not k.startswith('_')}
        item.update(distinct_question_count=distinct,
            repeated_answer_count=group['answer_count'] - distinct,
            entry_count=len(group['_entries']), attempt_count=len(group['_attempts']),
            accuracy=_percentage(group['correct_count'], group['answer_count']),
            first_correct_count=first_correct, first_accuracy=_percentage(first_correct, distinct),
            latest_correct_count=latest_correct, latest_accuracy=_percentage(latest_correct, distinct))
        items.append(item)
    return {'items': items, 'total': len(ordered), 'page': query.page, 'page_size': query.page_size}


async def history(user_id, query):
    with transaction() as cur:
        sql, values = _query(user_id, query)
        total = cur.execute('SELECT COUNT(*)' + sql, values).fetchone()[0]
        rows = cur.execute("""SELECT b.entry_id,b.source_json,b.source_revision,
            e.quiz_id,e.question_id,e.question_json,a.attempt_id,a.submitted_at,
            r.selected_answers_json,r.is_correct,r.duration_ms""" + sql +
            ' ORDER BY b.id DESC LIMIT ? OFFSET ?', [*values, query.page_size, (query.page - 1) * query.page_size])
        items = []
        for row in rows:
            item = dict(row)
            item['source'] = source_summary(json.loads(item.pop('source_json')))
            item['question_content_key'] = question_content_key(json.loads(item.pop('question_json')))
            item['selected_answers'] = json.loads(item.pop('selected_answers_json'))
            item['is_correct'] = bool(item['is_correct'])
            items.append(item)
        return {'items': items, 'total': total, 'page': query.page, 'page_size': query.page_size}


async def assessment(user_id, query):
    """One snapshot for counts and the last five distinct first-answer facts."""
    with transaction() as cur:
        return assessment_in_transaction(cur, user_id, query)


def assessment_in_transaction(cur, user_id, query, cutoff: datetime | None = None):
    """Reuse an existing transaction, optionally restricting to server cutoff."""
    from app.services.evidence_scoring import (
        POLICY_VERSION, WINDOW_LIMIT, compute_evidence_score, small_sample_cap,
    )

    first, latest, content_keys = {}, {}, {}
    answer_count, source = 0, None
    sql, values = _query(user_id, query)
    rows = cur.execute("""SELECT b.entry_id,b.source_json,e.question_hash,e.question_json,
        a.attempt_id,a.submitted_at,r.is_correct""" + sql + ' ORDER BY b.id', values)
    for row in rows:
        if cutoff is not None:
            try:
                submitted = datetime.fromisoformat(row['submitted_at'])
                if submitted.tzinfo is None:
                    submitted = submitted.replace(tzinfo=timezone.utc)
            except (ValueError, TypeError):
                continue
            if submitted > cutoff:
                continue
        answer_count += 1
        source = source_summary(json.loads(row['source_json']))
        if row['question_hash'] not in content_keys:
            content_keys[row['question_hash']] = question_content_key(json.loads(row['question_json']))
        key = content_keys[row['question_hash']]
        correct = bool(row['is_correct'])
        first.setdefault(key, {'question_content_key': key, 'entry_id': row['entry_id'],
            'attempt_id': row['attempt_id'], 'is_correct': correct, 'submitted_at': row['submitted_at']})
        latest[key] = correct
    # All values above were read under one transaction; there are no further reads.
    distinct = len(first)
    basis = list(first.values())[-WINDOW_LIMIT:]
    return {
        'knowledge_point_id': query.knowledge_point_id, 'content_version': query.content_version,
        'policy_version': POLICY_VERSION, 'source': source,
        'answer_count': answer_count, 'distinct_question_count': distinct,
        'repeated_answer_count': answer_count - distinct,
        'first_accuracy': _percentage(sum(item['is_correct'] for item in first.values()), distinct),
        'latest_accuracy': _percentage(sum(latest.values()), distinct),
        'evidence_score': round(compute_evidence_score([item['is_correct'] for item in basis]), 6) if basis else None,
        'window_count': len(basis), 'window_limit': WINDOW_LIMIT,
        'small_sample_cap': small_sample_cap(distinct),
        'evidence_state': 'no_evidence' if not distinct else 'limited_evidence' if distinct < 3 else 'available',
        'basis': basis,
    }
