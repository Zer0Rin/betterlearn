# Exam Backend Implementation Plan

**Goal:** Close multi-source paper assembly, explicit coverage review and timed self-exams via product HTTP APIs.
**Architecture:** Frozen paper and session tables; trusted bank allocation; after-submit projection into existing attempts/reports. No model invocation at assembly/start/submit.
**Constraints:** Preserve dirty worktree, no frontend, no commit, temporary data/fake providers only. Design: ../specs/2026-09-18-exam-backend-design.md.

- [x] Write API failing tests for preview/allocation/review and exam lifecycle, ownership, clock, duplicate requests and source freezing.
- [x] Implement strict models, schema7 migration and separate paper/session repositories. Reuse existing content keys, grading and bank projection.
- [x] Wire authenticated FastAPI and strict Host routes; test invalid methods/queries, origin checks and real backend paths.
- [x] Verify migration backups/rollback, restart, atomic projection and independent optional report.
- [x] Independent review, full Quiz/Web/Core tests and serial plugin validation; update contracts/provenance/handoff and inspect diff.

Verification (2026-09-18): Quiz **368 passed / 53 existing warnings**, Web **51 files / 538 passed**, Core **414 passed**. TypeScript/standalone build and serial test:plugins passed (17 tools unchanged). Exams17 + migrations12 cover self-grading invalid keys, bounded snapshots, allocation matching, deadlines, CAS and rollback. Real Host confirms Core deletion, restart and home backup/restore preserve ongoing exam, then finalization projects history without new evidence counts or provider calls. Independent review found and reproduced blank-key candidate validation; regression failed before fix and passed after. Follow-up found no remaining material issue. No real provider/daily home/frontend/commit changes.
