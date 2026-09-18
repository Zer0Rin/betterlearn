# Learning goals API

Public prefix `/nobei/quiz/v1/learning-goals`; private Quiz prefix
`/api/v1/learning-goals`. These owned goals track a frozen knowledge version and
user-chosen practice-evidence criteria, not mastery or exam grades. No model is
called. Four MCP tools expose the same list/read/create/archive operations (17 total tools); see mcp-learning.md. The shared Web/Electron frontend exposes list, create, detail and archive/restore in LearningGoalsPage; conditions remain immutable.

## Create and replay

POST at the prefix accepts exactly:

| Field | Constraint |
| --- | --- |
| request_id | Hyphenated UUID; normalized lowercase |
| title | Trimmed1..120 Unicode characters |
| source | Public: exactly {courseId,unitId}, existing Core ID formats |
| target_percent | Strict integer1..100; default90, compares evidence_score to0.9 |
| min_distinct_questions | Strict integer3..100; default5 |
| due_at | RFC3339 with explicit timezone and seconds, optional1..3 fractional digits |

T/Z are uppercase; dates/times and timezone hour0..23/minute0..59 are validated.
UTC normalization uses exactly milliseconds, within years0001..9999. New creation
requires a future deadline. Extra source content, hash, owner, status and score
are rejected. Host returns400 for invalid body; private typed validation422.

Host first looks up an accepted request, then resolves active Core course/unit
only for a new request. It constructs the same verified source v1 as existing
question attribution. Private create and request lookup require managed Host
credentials plus user identity; callers cannot manufacture trusted source data.

One transaction normalizes defaults/title/date/UUID, hashes all creation inputs
including the frozen source, and enforces UNIQUE(user_id,request_id). Equal
requests return the same goal's current summary; different inputs409. Replay is
checked before future-time validation, so expiry does not prevent replay. Host
reuses the accepted frozen source even after Core deletion. Archived goals stay
archived when creation is replayed. Goal UUIDs use a separate namespace from
exercise generation. Neither creation nor replay generates exercises.

A private GET `/request/{request_id}` returns `{goal_id,request}` with original
canonical input/full source. It is not in the public proxy allowlist. Unknown or
other-owner request404; without a configured/supplied managed Host token403.

## Read and archive

- GET prefix: page1..1000000 default1, page_size1..50 default20,
  status=active|archived|all defaultactive. Duplicate/unknown fields rejected.
  Returns `{items,total,page,page_size}` ordered by internal creation sequence
  descending. Items are definitions only; listing does not aggregate answers.
- GET `/{goal_id}`: returns definition plus progress. goal_id is `goal_` and32
  lowercase hex. No query params. Missing/other-owner404, archived still readable.
- PUT `/{goal_id}/archive`: exactly `{expected_revision,archived}`. Revision is
  a strict integer0..9007199254740990; archived is strict boolean. Match current
  revision: apply and increment (including same-state request). If already at
  expected+1 with requested state, return the existing summary; otherwise409.
  Explicit unarchive preserves deadline/creation conditions. No condition edits
  or hard-delete endpoint in this version.

Public query violations404, private422. Unsupported methods on known valid
public paths405. Existing origin/loopback checks and private user auth apply.

`ApiResponse.data` goal summary: goal_id, request_id, title, target_percent,
min_distinct_questions, due_at, policy_version, revision, created_at, archived,
source. `source` is the immutable source summary without evidence. Public responses
omit internal IDs/owner, digest and raw creation JSON. Create/archive return this
summary; detail adds progress.

## Progress at the deadline

Goal and answers are read in one transaction, with a server UTC evaluated_at at
millisecond precision. evidence_cutoff_at=min(evaluated_at,due_at). Include only
owned submitted nonlegacy answers with trusted captured source revision, matching
knowledge_point_id/content_version, and recorded submitted_at <= cutoff.
Timestamp parsing treats legacy SQLite naive timestamps as UTC; malformed timestamps
are excluded from goal evidence. No lexical comparison of mixed date formats.

Within that eligible history, use existing `distinct_first_v1`: exact content
key, FIRST answer per content by committed association ID, then the last five
such contents. Existing pre-creation history counts. Same-version evidence across
courses merges. Copies/retries do not add distinct content; latest accuracy
still reflects corrections before cutoff. Cross-version history stays separate.

Progress carries the complete existing knowledge-assessment data plus:

- evaluated_at, evidence_cutoff_at: normalized UTC;
- deadline_passed: evaluated_at >= due_at;
- criteria_met: nonnull evidence_score >= target_percent/100 AND distinct count
  >= min_distinct_questions;
- remaining_distinct_questions: max(0, required minus distinct count).

Score uses0..1, accuracy uses0..100 percent. Three correct distinct contents can
score1 but do not satisfy the default five-content minimum. A larger count
minimum does not expand the last-five scoring window. criteria_met can fall
before the deadline after new wrong first answers; it is not a permanent badge
or record of first attainment. After the deadline, late answers do not change
the eligible result. The ordinary all-history assessment remains unchanged.
Archive state is separate from progress. The local recorded server clock is the
time authority; this is not tamper-resistant remote exam timing.

## Persistence and validation

Quiz schema6 adds learning_goals with immutable canonical request, digest, source,
policy and criteria plus archival revision. Core schema2 unchanged. v1..v5 startup
uses existing SQLite backup before upgrade, `.pre-v6-<uuid>.bak` with0600 mode;
failed upgrades roll back version and all migrations. Existing scores, XP, reports
and source tasks are not recalculated. The entire quiz-data backup/restore includes
goals and creation deduplication. No separate storage or background expiry task.

Tests: test_learning_goals.py, test_learning_goal_migration.py and existing earlier
migration suites; Host boundary in test/quiz-routes.test.ts; real temporary-home
HTTP/source generation/goal/archive/Core deletion/restart/backup-restore in
test/standalone-mcp.test.ts. Fixtures alone use fake provider data; goal operations
add zero provider calls. Query cost grows with the matching historical answers;
list response limits do not truncate detail evidence.
