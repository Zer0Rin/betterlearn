# Knowledge assessment implementation plan

> **For agentic workers:** Use executing-plans to implement task-by-task in this workspace. User confirmed the design on 2026-09-18; execution is authorized.

**Goal:** Readonly historical-version evidence assessment using DeepTutor's weighted score after exact-content first-answer deduplication.

**Architecture:** Share the existing owned trusted-history query and content-key function. Compute counts, latest accuracy and a last-five first-answer basis within one Quiz SQLite transaction. Expose a strictly bounded HTTP GET through the existing Host proxy.

**Tech Stack:** Existing Python 3.12/FastAPI/SQLite and TypeScript/Vitest; no dependencies added.

## Global constraints

- Quiz schema5/Core schema2 unchanged; no migration, daily-home access, live provider calls, frontend edits, MCP additions, commits or cleanup.
- Preserve existing working changes and all stats response semantics.
- Score 0..1/null, percentage accuracy 0..100/null; no mastery threshold.
- Test-first for new behavior; source license and provenance retained.

### Task 1: pure policy and versioned aggregation

Files: create services/quiz/app/services/evidence_scoring.py and services/quiz/tests/test_knowledge_assessment.py; extend services/quiz/app/repositories/knowledge_stats_repository.py and services/quiz/app/models/knowledge_stats.py.

Interface: compute_evidence_score(correctness: list[bool]) -> float retains upstream empty=0; repository assessment(user_id, query) -> dict maps empty evidence to null. KnowledgeAssessmentQuery requires point and version only.

- [x] Write policy assertions: [] -> 0, [True] -> .5, [True,True] -> .8, three True -> 1; mixed six-item history uses final five weights.
- [x] Write real API/SQLite assertions for no evidence vs zero, repeated/copy/metadata changes, first wrong/latest right, six unique contents and committed ordering, owner/version/legacy/draft/source isolation and readonly total_changes.
- [x] Run services/quiz/.venv/bin/python -m pytest services/quiz/tests/test_knowledge_assessment.py and observe missing implementation failures.
- [x] Adapt upstream mastery function unchanged mathematically. Query `_query` within `transaction()`, build first-content basis and latest correctness, then score last five first occurrences. Query model rejects extras.
- [x] Re-run new tests plus test_knowledge_stats.py; all pass.

### Task 2: HTTP boundary and real Host chain

Files: services/quiz/app/api/v1/routes/question_bank.py, src/product/quiz-routes.ts, test/quiz-routes.test.ts, test/standalone-mcp.test.ts.

Interface: GET /question-bank/knowledge-assessment?knowledge_point_id=kp_<20hex>&content_version=<64hex>; private invalid query422, public invalid query404, wrong method405.

- [x] Write Host tests for allowed exact params, duplicates/extras/pagination/missing/malformed rejected, no calls on rejection and cross-origin403.
- [x] Add real Host request after existing fake-provider source generation/submission flow, assert count3/score1 and no extra provider calls; MCP still12 tools.
- [x] Run targeted Vitest and observe new route404.
- [x] Add private GET/model/dependency rejecting duplicate parameters and Host whitelist; no POST or source resolver.
- [x] Re-run Python and Host tests; assert no answer body in assessment and authenticated owner scope.

### Task 3: attribution, review, validation and handoff

Files: contracts/knowledge-assessment.md, docs/quiz-integration.md, docs/deeptutor-reuse.md, services/quiz/{PROVENANCE.md,third_party/DeepTutor/PROVENANCE.md}, docs/handoffs/2026-09-18-learning-foundations.md and this plan/spec.

- [x] Record exact source revision, function adaptation, first-content policy, score limitations and snapshot/query costs.
- [x] Independent review of policy, ownership, snapshot consistency, HTTP boundary and tests; resolve actionable findings.
- [x] Run corepack pnpm test:quiz, corepack pnpm test (serial with builds), and git diff --check. Relevant real Host test covers integration; do not rebuild plugins or frontend.
- [x] Update handoff with actual counts and scope, preserve all uncommitted work.

## Verification record

- Red: new Python assessment tests failed for missing service/route; Host tests failed on 404 before route addition.
- Green: assessment + unchanged knowledge stats 30 passed; Host/real stdio 21 passed.
- Full Quiz 304 passed, 53 existing warnings. Full Web 51 files / 529 passed; pretest TypeScript/standalone build passed.
- Independent review found no actionable issues; reviewer separately ran all21 assessment tests successfully.
- Final diff check passed. User confirmed design before implementation; no commits, migration, frontend work, installed-plugin changes, daily home or real model calls.
