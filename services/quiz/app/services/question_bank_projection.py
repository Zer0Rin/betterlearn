"""Project canonical questions and committed attempts inside the caller's transaction."""
import hashlib
import json
from collections import Counter
from pydantic import ValidationError
from app.models.quiz import Question


def index_questions(cur, quiz_id, user_id, title, questions):
    if user_id is None:
        return {}
    # Old malformed payloads remain in their original tables, not in the bank.
    if not isinstance(questions, list):
        return {}
    counts = Counter(q.get('id') for q in questions if isinstance(q, dict) and isinstance(q.get('id'), str))
    entries = {}
    for raw in questions:
        try:
            question = Question.model_validate(raw).model_dump()
        except ValidationError:
            continue
        if counts[question['id']] != 1:
            continue
        question['answer'] = sorted(question['answer'])
        encoded = json.dumps(question, sort_keys=True, ensure_ascii=False, separators=(',', ':'))
        digest = hashlib.sha256(encoded.encode()).hexdigest()
        cur.execute('''INSERT INTO question_bank_entries
            (user_id,quiz_id,question_id,question_hash,question_json,title,stem,explanation,knowledge_point)
            VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,quiz_id,question_id,question_hash) DO NOTHING''',
            (user_id, quiz_id, question['id'], digest, encoded, title, question['stem'],
             question['explanation'], question['knowledge_point']))
        row = cur.execute('''SELECT id FROM question_bank_entries
            WHERE user_id=? AND quiz_id=? AND question_id=? AND question_hash=?''',
            (user_id, quiz_id, question['id'], digest)).fetchone()
        entries[question['id']] = row['id']
    return entries


def record_attempt(cur, attempt, *, freeze_source=True):
    if attempt['user_id'] is None or attempt['legacy_records_json'] is not None:
        return
    entries = index_questions(cur, attempt['quiz_id'], attempt['user_id'], attempt['title'],
                              json.loads(attempt['questions_json']))
    answers = cur.execute('SELECT * FROM quiz_attempt_answers WHERE attempt_id=?', (attempt['attempt_id'],)).fetchall()
    for answer in answers:
        entry_id = entries.get(answer['question_id'])
        if entry_id is None or answer['is_correct'] is None:
            continue
        if freeze_source:
            row = cur.execute('SELECT source_json,revision FROM question_bank_sources WHERE entry_id=?', (entry_id,)).fetchone()
            cur.execute('''INSERT INTO question_bank_attempts(entry_id,attempt_id,source_json,source_revision)
                VALUES (?,?,?,?) ON CONFLICT(entry_id,attempt_id) DO NOTHING''',
                (entry_id, attempt['attempt_id'], row['source_json'] if row else None, row['revision'] if row else 0))
        else:  # v3 backfill runs before the v4 columns exist.
            cur.execute('''INSERT INTO question_bank_attempts(entry_id,attempt_id) VALUES (?,?)
                ON CONFLICT(entry_id,attempt_id) DO NOTHING''', (entry_id, attempt['attempt_id']))
        if cur.rowcount:
            cur.execute('''UPDATE question_bank_entries SET latest_attempt_id=?, is_correct=?,
                attempt_count=attempt_count+1, wrong_count=wrong_count+?, last_answered_at=? WHERE id=?''',
                (attempt['attempt_id'], answer['is_correct'], int(not answer['is_correct']),
                 attempt['submitted_at'], entry_id))
