# Knowledge statistics API

Public prefix: /nobei/quiz/v1/question-bank
Private Quiz prefix: /api/v1/question-bank

GET /knowledge-stats accepts page (1..1000000, default1), page_size (1..100,
default20), optional knowledge_point_id (kp_ + 20 lowercase hex) and
content_version (64 lowercase hex; requires knowledge_point_id).
No data is inferred from labels or current source associations.

ApiResponse.data = {items, total, page, page_size}. total counts knowledge
ID/version groups after filtering, not individual answers. Items:
- source: last committed source snapshot summary, all v1 fields except evidence.
  Full source snapshots are available from existing /entries/{entry_id}/history.
  This describes a historical frozen unit, not necessarily current Core content.
- answer_count, correct_count, accuracy: all trusted attributed answers.
- distinct_question_count: exact normalized content count.
- repeated_answer_count: answer_count - distinct_question_count.
- first_correct_count, first_accuracy: first answer per content.
- latest_correct_count, latest_accuracy: latest answer per content.
- entry_count: distinct versioned bank entries.
- attempt_count: distinct submitted quiz attempts contributing to this group.
- first_answered_at, last_answered_at: timestamps from first/last committed
  question_bank_attempts association in this group.
Percentages are 0..100 rounded to 2 decimals. First/latest denominator is the
distinct content count; overall denominator is answer_count. Empty groups are
omitted, rather than represented as zero accuracy.

GET /knowledge-stats/history requires knowledge_point_id + content_version;
page/page_size have the same bounds. data = {items,total,page,page_size}.
total is answer count, items descending by committed association ID:
entry_id, quiz_id, question_id, attempt_id, submitted_at, source (same summary),
source_revision, question_content_key, selected_answers, is_correct, duration_ms.
No correct answer key or entire question is returned; entry_id supports drilldown.

Content key v1 = qcontent_v1_ + SHA-256 of canonical UTF-8 JSON containing:
type, stem, options sorted by (key,text), sorted answer keys, image_url (null if
missing). Excludes quiz/question IDs, explanation, difficulty and free label.
Canonical encoding recursively sorts object keys, preserves Unicode and uses
no extra spaces. Exact copies across quizzes/courses count once per source
version. Different text/options/answers/image URL counts separately. This is
not semantic equivalence detection and not a guarantee of independent evidence.

Order uses question_bank_attempts.id, not timestamp comparison; equal or
backwards wall-clock times do not reorder history. Groups sort by last such ID.
Only owned entries joined to owned submitted attempts, trusted answer rows,
nonlegacy grading and captured source revision>0 participate. No-source
history is excluded; current binding changes cannot reattribute old answers.
Same ID with different content_version stays separate; same ID/version across
courses merges. Client-supplied correctness/owner/extra fields are not accepted.

Only GET is allowed. Unknown/duplicate/invalid Host query returns404 (existing
Quiz allowlist convention); invalid private query422; wrong method405.
Missing/no-owned-data versions return empty data, not cross-user existence.
Snapshot queries perform no persistent writes. No schema migration or model
calls; no Core mastery updates. Runtime scans the user's matching history,
so pagination bounds response size but does not bound aggregation work.

Frontend: 学习统计 displays these paginated version groups and their answer history, with links to the exact quiz attempt. It renders backend counts/percentages without recomputing attribution or mastery.

Learning evidence excludes empty selected-answer arrays (both omitted exam answers
and explicitly cleared answers), including existing historical projections.
Exam grades and question-bank wrong-answer history still include unanswered items
as incorrect. This read filter requires no migration or score rewrite.
