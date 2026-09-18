"""Project a finalized self-exam into existing history, atomically and without XP."""
import uuid
from app.models.question_source import canonical
from app.repositories.attempt_repository import _create, _owned, _write_answers, _hash
from app.services.question_bank_projection import index_questions, record_attempt
from app.services.scoring_service import compute_score_summary


def persist(cur, user_id, paper, items, records, submitted_at):
    # No ordinary quiz/attempt exists before finalization: old practice/history
    # endpoints therefore cannot accidentally expose an in-progress exam key.
    quiz_id = 'exam_quiz_' + uuid.uuid4().hex
    questions = [i['question'] for i in items]
    encoded = canonical(questions)
    cur.execute('INSERT INTO quiz_sessions(quiz_id,user_id,title,questions_json) VALUES (?,?,?,?)',
                (quiz_id, user_id, paper['title'], encoded))
    attempt = _create(cur, dict(quiz_id=quiz_id, title=paper['title'], questions_json=encoded), user_id)
    _write_answers(cur, attempt['attempt_id'], records, True)
    score = compute_score_summary(records)
    at = submitted_at.strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]
    cur.execute('''UPDATE quiz_attempts SET status='submitted',revision=1,submitted_at=?,
        total_questions=?,correct_count=?,accuracy=?,submission_hash=? WHERE attempt_id=?''',
        (at, score['total'], score['correct'], score['accuracy'], _hash(records), attempt['attempt_id']))
    entries = index_questions(cur, quiz_id, user_id, paper['title'], questions)
    for item in items:
        cur.execute('INSERT INTO question_bank_sources(entry_id,revision,source_json) VALUES (?,?,?)',
                    (entries[item['question']['id']], item['source_revision'], canonical(item['source'])))
    record_attempt(cur, _owned(cur, attempt['attempt_id'], user_id))
    return dict(attempt_id=attempt['attempt_id'], quiz_id=quiz_id, xp_gain=0,
                total_questions=score['total'], correct_count=score['correct'], accuracy=score['accuracy'])
