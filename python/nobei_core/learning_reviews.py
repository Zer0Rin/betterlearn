"""Read-only cross-course queue and guarded transitions for spaced review rounds."""
import json
from datetime import timedelta
from nobei_core.errors import CoreProblem
from nobei_core.ids import require_opaque_id
from nobei_core.learning_schedule import initial_state, advance, interval_days

COMPLETE = ('mastered', 'mastered_after_remediation')
REPAIR = ('remediation_required', 'learning')


def latest_unit_attempt(connection, unit_id):
    return connection.execute('''SELECT t.id,t.result_json FROM learning_attempts t
        JOIN learning_assessments a ON a.id=t.assessment_id WHERE a.unit_id=?
        ORDER BY t.rowid DESC LIMIT 1''', (unit_id,)).fetchone()


def previous_review(latest):
    return json.loads(latest['result_json']).get('review') if latest else None


def review_transition(assessment, latest, context, correct, now, attempt_id):
    from nobei_core.learning import _iso
    if (assessment['unit_id'] != context['unitId'] or latest is None
            or latest['id'] != context['expectedAttemptId'] or assessment['course_status'] != 'active'):
        raise CoreProblem('LEARNING_STATE_CONFLICT', 'review state changed; reload the queue')
    status = assessment['mastery_status']
    prior = previous_review(latest)
    schedule = dict(prior['schedule']) if prior else initial_state()
    if status in COMPLETE:
        if (assessment['kind'] != 'claim_choice' or not assessment['due_at']
                or assessment['due_at'] > _iso(now)):
            raise CoreProblem('LEARNING_STATE_CONFLICT', 'review is not due')
        phase = 'review'
        round_id = attempt_id
        schedule = advance(schedule, assessment['point_type'], correct)
        next_status, strength = ('mastered', 100) if correct else ('remediation_required', 20)
    elif status in REPAIR and assessment['kind'] == 'evidence_choice':
        phase = 'remediation'
        round_id = prior['roundId'] if prior else latest['id']
        next_status, strength = ('mastered_after_remediation', 70) if correct else ('learning', 20)
    else:
        raise CoreProblem('LEARNING_STATE_CONFLICT', 'review assessment is unavailable')
    # Initial remediation keeps its established one-day schedule. Remediation
    # inside an interval round does not count as a fresh spaced success.
    spaced = phase == 'review' or bool(prior and prior.get('spaced'))
    days = interval_days(schedule, assessment['point_type']) if spaced else 1
    due_at = _iso(now + timedelta(days=days)) if correct else None
    return next_status, strength, due_at, {'phase': phase, 'roundId': round_id, 'spaced': spaced, 'schedule': schedule}


def review_queue(connection, params):
    from nobei_core.learning import _iso, _now
    if not isinstance(params, dict) or set(params) - {'limit', 'offset', 'courseId'}:
        raise CoreProblem('INVALID_PARAMS', 'review queue parameters are invalid')
    limit, offset = params.get('limit', 20), params.get('offset', 0)
    if type(limit) is not int or not 1 <= limit <= 100 or type(offset) is not int or not 0 <= offset <= 1000000:
        raise CoreProblem('INVALID_PARAMS', 'review queue pagination is invalid')
    course_id = require_opaque_id(params['courseId'], 'course') if 'courseId' in params else None
    if course_id and connection.execute('SELECT 1 FROM learning_courses WHERE id=?', (course_id,)).fetchone() is None:
        raise CoreProblem('LEARNING_COURSE_NOT_FOUND', 'learning course does not exist')
    now = _iso(_now())
    base = ''' FROM learning_units u JOIN learning_courses c ON c.id=u.course_id
        JOIN learning_mastery_states m ON m.unit_id=u.id
        JOIN learning_assessments a ON a.unit_id=u.id AND a.kind=CASE
            WHEN m.status IN ('remediation_required','learning') THEN 'evidence_choice' ELSE 'claim_choice' END
        JOIN learning_attempts t ON t.id=(SELECT la.id FROM learning_attempts la
            JOIN learning_assessments aa ON aa.id=la.assessment_id WHERE aa.unit_id=u.id ORDER BY la.rowid DESC LIMIT 1)
        WHERE c.status='active' AND (m.status IN ('remediation_required','learning') OR
            (m.status IN ('mastered','mastered_after_remediation') AND m.due_at IS NOT NULL AND m.due_at<=?))'''
    values = [now]
    if course_id:
        base += ' AND c.id=?'
        values.append(course_id)
    total = connection.execute('SELECT COUNT(*)' + base, values).fetchone()[0]
    rows = connection.execute('''SELECT u.id AS unit_id,u.source_knowledge_point_id,u.title,u.point_type,
        c.id AS course_id,c.title AS course_title,m.status,m.due_at,t.id AS expected_attempt_id,
        a.id AS assessment_id,a.kind,a.prompt,a.options_json,a.remediation_title,a.remediation_body,
        CASE WHEN m.status IN ('remediation_required','learning') THEN 1
            WHEN u.point_type='fact' THEN 2 WHEN u.point_type IN ('concept','comparison') THEN 3 ELSE 4 END AS priority'''
        + base + ' ORDER BY priority,COALESCE(m.due_at,m.updated_at),c.id,u.ordinal LIMIT ? OFFSET ?',
        [*values, limit, offset]).fetchall()
    items = []
    for row in rows:
        items.append({'unitId': row['unit_id'], 'knowledgePointId': row['source_knowledge_point_id'],
            'courseId': row['course_id'], 'courseTitle': row['course_title'], 'title': row['title'],
            'type': row['point_type'], 'dueAt': row['due_at'], 'priority': row['priority'],
            'phase': 'remediation' if row['status'] in REPAIR else 'review',
            'expectedAttemptId': row['expected_attempt_id'],
            'assessment': {'assessmentId': row['assessment_id'], 'kind': row['kind'], 'prompt': row['prompt'],
                           'options': json.loads(row['options_json']), 'attempt': None},
            'remediation': {'title': row['remediation_title'], 'body': row['remediation_body']} if row['status'] in REPAIR else None})
    return {'items': items, 'total': total, 'limit': limit, 'offset': offset, 'asOf': now}
