# Single Core source generation

Public POST /nobei/quiz/v1/quiz/generate/from-source (JSON):
- request_id: required [A-Za-z0-9_-]{1,100}, stable across retries.
- source: exactly {courseId,unitId}, required Core opaque IDs.
- user_input: optional 1..2000 characters, default 围绕所选知识点出题.
- question_count: integer 3..10, default5.
- difficulty: easy/medium/hard/mixed, defaultmixed.
- generate_images: boolean, defaultfalse.
Unknown fields/doc_id/browser snapshots are rejected400. Queries forbidden.
Returns existing ApiResponse.data {task_id}; poll existing /quiz/task/{task_id}.

Host first performs private owned GET /quiz/source-request/{request_id}.
If present, matching course/unit reuses persisted source even after Core
deletion/archive; changed selection409. Options are still forwarded for Quiz's
full digest comparison. If absent, Host resolves active frozen Core unit using
the existing source v1 codec. No automatic new request ID or model retry.

Private POST /api/v1/quiz/generate/from-source receives full source v1 snapshot,
with the same fields/defaults. It requires managed Host secret, loopback peer
and authenticated user. Private lookup is not in the public proxy allowlist.
Source-task status also checks owner on the existing task polling endpoint.
Foreign/missing source request404; changed same-key request409.

quiz_source_tasks stores user/request_id unique, SHA-256 canonical request
digest, full normalized request JSON, and task_id linked to quiz_tasks.
Creation is atomic. Worker atomically claims pending only, loads persisted
request, and uses source title/statement/evidence as context. No RAG/network
search. Standard text/image providers remain configured by the user.
Sources are selected intent, not verified coverage of generated questions.
Provider output cannot populate trusted source metadata.

Before optional image generation/save, inventory must have exact requested
count, unique question IDs, valid attempt-input identifiers/selections and
gradable reference answers under the existing canonical grading rules.
Temporary reference checks never create learner attempts or scores.

Quiz row, bank entries, source mappings revision1 and completed task response
commit together. Failure rolls all those database facts back. Provider work
and optional image outputs are outside that transaction; charges cannot be
rolled back. A failed task stays failed under replay; an explicit new request
is required for another attempt. Restart marks pending/running failed and never
resumes generation automatically. Error messages do not persist provider secrets.

Source-generation storage was introduced in Quiz schema5. Current schema7 upgrades v1-v6 with .pre-v7-*.bak before migration; see exams.md. Existing data
and XP untouched. No backfill of task/source associations. No Core schema
change. MCP exposes this flow through betterlearn_generate_source_quiz with ID-only source selection, images disabled, and its existing durable request journal (see mcp-learning.md). Frontend integration is available through the 知识点出题 page: explicit generation, durable original request, bounded task polling and saved quiz entry.
