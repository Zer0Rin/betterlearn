# Learning goals implementation plan

**Goal:** Implement the user-approved single frozen-version learning goal with deadline, evidence threshold, owned idempotent creation and archival CAS.

**Architecture:** Quiz schema6 stores immutable creation conditions and separate archive revision. Reuse source codec in Host and cursor-based existing assessment policy. Deadline compares parsed UTC timestamps within the same transaction. No provider or Core writes.

**Constraints:** Preserve workspace, no commits, no daily-home migration, no frontend/MCP changes, no real model calls. User's “继续” approves the concrete design.

- [x] Backend red/green: add tests/test_learning_goals.py (owned create/replay/archive/query/deadline/no writes) and test_learning_goal_migration.py. Implement models/learning_goal.py, core/learning_goal_schema.py, repositories/learning_goal_repository.py, api/v1/routes/learning_goal.py; register router and migrate5→6. Add cursor+cutoff internal assessment reuse; unchanged standalone assessment behavior.
- [x] Host red/green: add test/quiz-routes.test.ts goal cases; implement src/product/learning-goal.ts strict public source-ID adapter, persisted request lookup replay, date normalization; exact paths/methods/query allowlist in quiz-routes.ts. Reject source snapshots and wrong query/method before proxy.
- [x] Integration: extend real temporary-home test/standalone-mcp.test.ts HTTP flow with source-generated submissions, goals, archive, Core deletion replay, restart and backup/restore. MCP remains13. Fake provider only for existing fixture data.
- [x] Migration regression: v1..v5 backup and rollback, fresh schema6, upgrade idempotence, preserved XP; adjust historical migration fixtures to remove new table on simulated downgrades and expect current schema6/backups.
- [x] Independent focused review; full Quiz/Web/build tests serial with builds, diff check; update contracts/learning-goals.md, integration and handoff, exact validation record. Preserve prior historical records.

Validation commands: PYTHONPATH=services/quiz services/quiz/.venv/bin/python -m pytest services/quiz/tests/test_learning_goals.py services/quiz/tests/test_learning_goal_migration.py -q; corepack pnpm exec vitest run --config vitest.web.config.ts test/quiz-routes.test.ts test/standalone-mcp.test.ts; corepack pnpm test:quiz; corepack pnpm test.

## Final verification

- Red:26 new backend/migration cases failed on missing routes/schema; two initial Host cases failed404 before implementation.
- Green initial checkpoint:47 goal/migration/assessment cases. Host+real stdio26 passed after integration additions.
- Full Quiz339 passed with53 pre-existing warnings; includes v1..v5 upgrade/last-migration rollback matrix.
- Full Web51 files/534 tests passed; TypeScript+standalone build passed. Real Host flow verifies frozen source after Core deletion, archive persistence, restart, full home backup/restore and creation replay with no extra provider calls.
- Independent focused review found no actionable issues in ownership, UTC/cutoff, replay, CAS and migration paths. Final diff check passed.
- No daily-home migration, live provider, frontend/MCP tool changes, installed-plugin operations, commits or cleanup.
