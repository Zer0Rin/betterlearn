"""Pure interval transitions adapted from DeepTutor learning/scheduler.py.

Apache-2.0; see third_party/DeepTutor/PROVENANCE.md. Changes: Core type mapping,
explicit state/time inputs, no environment switches, minimum one day, and no
interval advancement for immediate remediation. This is a scheduling heuristic.
"""
INTERVAL_SEQUENCES = {
    'memory': (0, 1, 3, 7, 14, 30, 60),
    'concept': (3, 7, 14, 30),
    'procedure': (3, 7, 14),
}
TYPE_MAPPING = {'fact': 'memory', 'concept': 'concept', 'comparison': 'concept',
                'process': 'procedure', 'formula': 'procedure', 'code': 'procedure'}
TYPE_PRIORITY = {'memory': 2, 'concept': 3, 'procedure': 4}


def initial_state():
    return {'intervalIndex': 0, 'consecutiveCorrect': 0, 'consecutiveWrong': 0}


def advance(state, point_type, correct):
    result = dict(state)
    if correct:
        result['consecutiveWrong'] = 0
        result['consecutiveCorrect'] += 1
        if result['consecutiveCorrect'] >= 2:
            result['intervalIndex'] += 2
            result['consecutiveCorrect'] = 0
        else:
            result['intervalIndex'] += 1
    else:
        result['consecutiveWrong'] += 1
        result['consecutiveCorrect'] = 0
        result['intervalIndex'] = max(0, result['intervalIndex'] - 1)
        if result['consecutiveWrong'] >= 2:
            result['consecutiveWrong'] = 0
    intervals = INTERVAL_SEQUENCES[TYPE_MAPPING[point_type]]
    result['intervalIndex'] = max(0, min(result['intervalIndex'], len(intervals) - 1))
    return result


def interval_days(state, point_type):
    return max(1, INTERVAL_SEQUENCES[TYPE_MAPPING[point_type]][state['intervalIndex']])
