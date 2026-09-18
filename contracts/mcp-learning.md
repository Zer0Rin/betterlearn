# Learning MCP contract

The MCP surface has 17 tools. Ten extend learning access:

| Tool | Input | Effect |
| --- | --- | --- |
| betterlearn_list_learning_books | empty object | Saved book summaries and optional course ID; never creates a course |
| betterlearn_read_learning_course | course_id | Course/unit IDs, point IDs, type, title and statement; no assessment answers |
| betterlearn_knowledge_stats | pagination, optional knowledge_point_id/content_version | Owned historical version statistics |
| betterlearn_knowledge_history | pagination, required knowledge_point_id/content_version | Owned attempts for that version |
| betterlearn_knowledge_assessment | required knowledge_point_id/content_version only | Readonly first-content evidence score and basis |
| betterlearn_list_learning_goals | pagination, optional status active/archived/all | Owned definitions, no progress aggregation |
| betterlearn_read_learning_goal | goal_id | Owned goal and cutoff progress |
| betterlearn_create_learning_goal | UUID request_id, title, course_id, unit_id, due_at; optional target_percent/min_distinct_questions | Explicitly requested goal creation |
| betterlearn_set_learning_goal_archived | goal_id, expected_revision, archived | Explicitly requested archive/restore using CAS |
| betterlearn_generate_source_quiz | request_id, course_id, unit_id, optional user_input/question_count/difficulty | Asynchronous source generation using BetterLearn's configured provider |

Schemas reject extra fields. MCP registration passes each full strict object schema to the SDK, so unknown fields are rejected before callback dispatch rather than silently stripped. Page defaults to 1 (maximum 10000); page_size defaults to 20 (maximum 50). A stats version filter requires a point ID. IDs come from saved courses and historical statistics, not model guesses. Statistics retain the denominators and exact-content deduplication described in knowledge-stats.md; reads neither call a model nor update mastery.

Generation requires an explicitly requested new exercise and may incur provider fees. The Host resolves the source through the shared source-generation adapter; callers cannot supply a snapshot, URL, model key or image setting. Images are disabled. Source attribution records user intent, not verified question coverage. This extension exposes no answer-submission tool.

Both generation tools share a global request UUID namespace and serialize by UUID. Legacy digests remain unchanged; source digests include an operation discriminator. Equal inputs replay an accepted task; changed parameters or another generation operation conflict. Dispatch intent is persisted before POST. Missing responses or result-write failures remain uncertain across restart and must not be automatically resent, even with backend source-task deduplication. A confirmed rejection remains rejected. SOURCE_PREPARATION_FAILED occurs before dispatch intent and POST and returns no private upstream error text.

The private owned source-request lookup permits replay of an accepted backend request after Core deletion; it is not a public proxy route or MCP tool. Existing loopback authentication, home locking and journal backup/restore apply unchanged. This MCP extension adds no migration; current Quiz schema7 and Core schema2. Goal creation/read/archive are also exposed through the adapters below.

Validation uses temporary homes and fake providers: real official-SDK stdio discovery, source generation, submission through the existing HTTP API, stats/history, restart replay, cross-tool conflicts, ambiguous dispatch and preparation failure. Generated Codex and Claude plugin configurations both expose 17 tools; this does not upgrade installed user plugins.

Assessment forwards the owned GET /question-bank/knowledge-assessment without pagination or extra fields. It needs no model configuration and writes no journal. Data and policy are unchanged from knowledge-assessment.md: score0..1 vs percent accuracies, null for no evidence, and score1/available never implies mastery. The real stdio test compares MCP to HTTP results before and after restart; both generated plugin configurations also read empty evidence with no model configured and zero provider calls.


Goal operations reuse the existing learning-goals.md policy. The MCP create adapter invokes shared resolveLearningGoal and owned private lookup before POST; no caller snapshot is accepted. No model configuration, generation journal, provider, reminders or automatic retry. Readonly goal questions do not authorize writes. Goal writes require explicit user intent; deadlines must include a timezone. Target90 means evidence_score0.9, not exam90.

Goal creation UUID deduplication lives in the backend and is separate from exercise-generation UUIDs. On response loss report GOAL_RESULT_UNKNOWN; if retrying retain exact UUID/arguments (or archival revision/state), never invent replacements. A saved create can replay after restart/Core deletion, retaining archive state. GOAL_PREPARATION_FAILED means this call sent no POST; GOAL_CONFLICT requires rereading, never automatically increasing revision. Upstream error text is not exposed. 404 maps GOAL_NOT_FOUND; other definite4xx except408 map GOAL_REQUEST_REJECTED; transport/5xx/408/invalid success payload on writes is uncertain. Goal reads use GOAL_READ_FAILED for ambiguous transport/protocol errors.
