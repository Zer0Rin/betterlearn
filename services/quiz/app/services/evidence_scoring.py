"""Adapted from DeepTutor learning/mastery.py (Apache-2.0).

Source revision: 31bf66b5e13b0db4e0e3ea61e561e490ccd52b8f.
Retains the recency weights and one/two-sample caps of compute_mastery.
BetterLearn names this an evidence score, exposes cap/window metadata, and
feeds only first trusted answers per exact question content. It is not a
mastery decision or calibrated confidence estimate. See third_party/DeepTutor.
"""

_RECENCY_WEIGHTS: tuple[float, ...] = (0.5, 0.7, 0.85, 0.95, 1.0)
_SMALL_SAMPLE_CAP: dict[int, float] = {1: 0.5, 2: 0.8}
WINDOW_LIMIT = len(_RECENCY_WEIGHTS)
POLICY_VERSION = 'distinct_first_v1'


def small_sample_cap(count: int) -> float | None:
    return _SMALL_SAMPLE_CAP.get(count, 1.0) if count else None


def compute_evidence_score(correctness: list[bool]) -> float:
    """Score ordered distinct-content first answers; empty input retains 0.0."""
    if not correctness:
        return 0.0
    recent = correctness[-WINDOW_LIMIT:]
    weights = _RECENCY_WEIGHTS[-len(recent):]
    score = sum(w * (1.0 if c else 0.0) for c, w in zip(recent, weights, strict=True)) / sum(weights)
    return min(score, _SMALL_SAMPLE_CAP.get(len(recent), 1.0))
