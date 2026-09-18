# Single-source quiz generation
Continue the authorized backend roadmap, frontend paused. Add POST
/quiz/generate/from-source with request_id, source:{courseId,unitId}, optional
user_input (default "围绕所选知识点出题"), question_count3..10/default5,
difficulty/defaultmixed, generate_images/defaultfalse. No doc_id or arbitrary
snapshot accepted by Host. Host resolves immutable Core unit and sends source
v1 snapshot to private Quiz; existing managed-host + JWT boundary is mandatory.

Single selected source is the intended context for all generated questions;
this is user attribution, not model-verified coverage. Models cannot set trusted
IDs. Source context replaces network/RAG lookup; actual text/image calls use the
existing configured providers. No real providers in tests.

schema5 quiz_source_tasks stores unique (user_id,request_id), digest, full
request JSON, task_id foreign key. Atomic create + pending task, then one guarded
claim starts generation. Replay returns existing task without another call;
changed options/source under same key409, failed tasks do not silently restart.
Host private owned request lookup reuses original source after Core deletion
before replay; mismatched source selection409. Not a public generic proxy.

Worker reads persisted request, validates exact question count/unique IDs and canonical gradability before images, generates with existing generate_quiz/image
helpers, then saves quiz+bank entries+source revision1+completed task result in
one transaction. Any failure leaves no partial quiz/source/result. Restart marks
pending/running failed using existing behavior and never automatically incurs
another call. Status reads enforce ownership for source tasks, including existing
/quiz/task path. Model output extra source fields are ignored; persisted source
always comes from task request.

v1-v4 backup before v5 upgrade; no inferred source backfill, no daily home.
Tests: idempotent/concurrent creation, replay after Core deletion, changed-key
conflict, provider fake context/no search, ownership, rollback, restart, migration.

Provider/image work is outside SQLite transactions; failed saves cannot undo incurred model costs or optional image outputs. No automatic retry is introduced.
