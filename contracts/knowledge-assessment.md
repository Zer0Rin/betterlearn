# Knowledge assessment API

GET `/nobei/quiz/v1/question-bank/knowledge-assessment` (Host), forwarded to
`/api/v1/question-bank/knowledge-assessment` (private Quiz).

Exactly one `knowledge_point_id` (`kp_` + 20 lowercase hex) and one
`content_version` (64 lowercase hex) are required. No pagination, caller owner,
source snapshot or additional fields. Host rejects invalid/missing/duplicate
queries with 404, private Quiz with 422; valid-query non-GET requests receive
405. Existing Host origin authentication and private user authentication apply.

## Evidence policy `distinct_first_v1`

Read the same owned, submitted, nonlegacy answer rows with captured trusted
source/revision as knowledge-stats. No free-label inference or current Core
lookup. ID/version pairs remain separate; same pair across courses merges.
Current source edits, unlinking or Core deletion do not reattribute history.

In one SQLite snapshot, order associations by persisted question_bank_attempts.id.
For each exact question_content_key v1 (see knowledge-stats.md), retain its FIRST
answer. Take the last five distinct first answers, in this order. Repeated or
copied content never replaces first evidence or moves its position; corrections
remain visible in latest_accuracy.

Adapt DeepTutor learning/mastery.py::compute_mastery at revision
31bf66b5e13b0db4e0e3ea61e561e490ccd52b8f: weights oldest-to-newest are
[0.5, 0.7, 0.85, 0.95, 1.0], taking the last N weights when N < 5. The weighted
correctness mean is capped at 0.5 for one distinct content and 0.8 for two;
three or more have cap 1.0. Return at most six decimals. Empty evidence returns
null rather than the underlying pure function's zero. Score zero means observed
first answers were wrong. Association order, not submitted_at, breaks timestamp
ties and clock regressions.

## Response

`ApiResponse.data`:

| Field | Meaning |
| --- | --- |
| knowledge_point_id, content_version | Requested historical scope |
| policy_version | distinct_first_v1 |
| source | Last contributing historical source summary; excludes evidence; null if empty |
| answer_count | All trusted attributed answers in the scope |
| distinct_question_count | Exact distinct content count across the entire history |
| repeated_answer_count | answer_count minus distinct_question_count |
| first_accuracy | First correct answers / distinct count, percent 0..100, two decimals or null |
| latest_accuracy | Latest correct answers / distinct count, percent 0..100, two decimals or null |
| evidence_score | Last-five capped weighted score 0..1, or null |
| window_count, window_limit | Number of basis items 0..5, fixed limit 5 |
| small_sample_cap | null if empty; 0.5/0.8/1.0 for 1/2/3+ distinct contents |
| evidence_state | no_evidence for 0, limited_evidence for 1..2, available for 3+ |
| basis | Up to five first-answer facts, oldest-to-newest by association order |

Each basis item includes only question_content_key, entry_id, attempt_id,
is_correct (boolean), and submitted_at. It has no correct answer or user answer
text. Counts and accuracies describe the complete matching history; basis/score
use only the last five distinct FIRST answers. No rows and no-owned-rows both
return zero counts, null source/accuracies/score/cap, no_evidence, and basis=[].

Ten correct answers to copies of one question yield score 0.5 and window_count1.
A first wrong answer then a correction leaves score0 and first_accuracy0 while
latest_accuracy becomes100. Three distinct first-correct answers yield score1,
without implying mastery or sufficient evidence of ability.

## Boundaries and validation

This is a heuristic practice-evidence score, not a calibrated confidence estimate,
mastery decision, deadline goal or exam grade. First submitted does not prove
unseen; exact distinct content does not prove semantic independence. No difficulty,
knowledge-type or time-decay adjustment is performed. There is no mastered flag
or Core mastery/schedule write, model call, XP change or new task.

Assessment itself adds no migration; current Quiz schema6/Core schema2. Learning goals reuse its cursor-based aggregation with a deadline cutoff, while this API continues to read all history. Matching history is
scanned once under the existing serialized transaction. Response basis is bounded
but query cost grows with matching history. The readonly betterlearn_knowledge_assessment MCP tool exposes the same result
with required point/version and no pagination; MCP now has17 tools. Frontend remains paused.

Tests: services/quiz/tests/test_knowledge_assessment.py (pure policy and real owned
SQLite API), test/quiz-routes.test.ts (public boundary), test/standalone-mcp.test.ts
(real Host→Quiz query after fake-provider source generation/submission and restart).
Attribution and Apache-2.0 license: services/quiz/third_party/DeepTutor/.
