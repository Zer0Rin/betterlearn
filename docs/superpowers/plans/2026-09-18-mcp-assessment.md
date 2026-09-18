# MCP assessment integration plan

## Scope

Continue the completed readonly assessment API through the existing learning MCP surface. Add `betterlearn_knowledge_assessment` with exactly the historical point ID and version; forward to the existing owned GET, preserving all scores and basis. No new scoring policy, persistence, provider call, Core write, frontend, migration or installed-plugin change. Existing user instruction to continue covers this integration.

- [x] TDD: strict input/no-configuration readonly unit test, null/zero preservation, sanitized failure and no journal. Real SDK discovery13/readOnlyHint and HTTP=MCP assessment before/after restart.
- [x] Add schema/read adapter; keep generation and UUID handling unchanged.
- [x] Sync three plugin skill sources and generated-config verifier to13 tools; verify readonly assessment with no model configured on both clients.
- [x] Document score unit, first-content basis, historical version, no mastery claim; preserve historical installation records.
- [x] Independent focused review; full Web build/tests then serial plugin verification. Record exact results and update handoff. No commits or cleanup.

## Review correction

Independent review found the existing MCP registration passed schema.shape, so the SDK discarded strict unknown-field rejection. A real official-SDK transport regression failed before the fix. Passing the full schema preserves all existing strict definitions and rejects extras before any callback (assessment, status and both generators covered). Checked installed SDK1.29.0 types/normalization and Context7 v1.x reference; no dependency update.

## Final verification

Full Web: 51 files / 531 tests (8 MCP tests), pretest TypeScript/standalone build passed. Serial test:plugins passed for both generated configs with13 tools and readonly assessment under missing model configuration. Independent review P2 resolved and rechecked; no remaining actionable issues. Three skill files identical, final diff check passed. No Python changes or migration; previous stage's304 Quiz tests were not rerun here. No frontend, installed-plugin changes, daily home, live provider calls or commits.
