# MCP learning plan
- [x] Failing MCP tests for source generation and stat tools.
- [x] Schemas, readonly ports, shared source resolution and durable journal.
- [x] Real stdio fake-provider exercise incl course discovery and stats.
- [x] Plugin contract/docs, independent review.
- [x] Web/plugin tests/build/diff and handoff; preserve workspace.

Verification: targeted MCP tests 6 passed; official SDK validated both generated plugin configurations with 12 tools. Independent code/reference review found no outstanding actionable issues; skill scenarios covered readonly requests, explicit generation and uncertain-result handling. A parallel build initially collided in dist; serial plugin build/verification passed. No live model calls, user-home changes, frontend edits or commits.

Final Web regression: 51 files / 528 tests passed, including 6 MCP tests. Final diff check passed.
