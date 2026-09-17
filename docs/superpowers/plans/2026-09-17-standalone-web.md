# Standalone Web Implementation Plan

> **For agentic workers:** Use subagent-driven-development for scoped implementation and review; independent domains may run in parallel under dispatching-parallel-agents. Steps use checkbox syntax for tracking.

**Goal:** Ship a local single-user Web application without DSH or MySQL, preserving the full learning workflows and preparing for Electron.

**Architecture:** Keep TypeScript application service, Python Core and quiz service behind same-origin HTTP. Native process and model adapters replace DSH services. SQLite databases and Chroma live under one private data root.

**Tech Stack:** Existing React/TypeScript, Node HTTP, Python 3.12, SQLite, existing FastAPI/Chroma quiz service.

## Global Constraints

- Local single-user, loopback only, no registration/login UI.
- No DSH runtime or install dependency in standalone deliverables.
- No changes to existing live DSH install or original data.
- Existing extraction contract, evidence checks, model snapshots and learning flows remain authoritative.
- Model keys stay server-side. Automatic tests use fake providers.
- Web first; no Electron implementation in this change.
- Work on codex/standalone-web; baseline 882cfc8. Untracked .superpowers belongs to existing local work.

## Task 1: SQLite quiz persistence

Files: services/quiz/app/core/db.py, config.py, main.py; services/quiz/app/repositories/*.py; report_service.py; requirements.txt; tests/test_sqlite_persistence.py and affected tests.
Interface: preserve existing public repository async function signatures and response shapes. SQLite path from QUIZ_DB_PATH; init_db/close_db lifecycle. Managed fixed local user remains supported. User IDs remain relational keys.
- [x] Write temporary-real-database tests for user creation, document storage, quiz/report roundtrip, duplicate report XP, FK rollback and restart recovery. Run `.venv-phase1b/bin/python -m pytest services/quiz/tests/test_sqlite_persistence.py -q` and establish expected failure.
- [x] Replace MySQL schema/queries with SQLite SQL, explicit transaction helpers and schema user_version; timestamp formatting must accept SQLite values. Atomic report+answers+XP saves return existing report on duplicate.
- [x] Mark abandoned processing documents and pending/running quizzes failed on startup without provider calls.
- [x] Run complete quiz tests with the available quiz virtualenv; commit scoped changes and report exact results.

## Task 2: Standalone frontend

Files: src/standalone/client.tsx, App.tsx, Settings.tsx, styles.css; src/client/NobeiClientView.tsx, components/ImportWorkspace.tsx, model-directory-bridge.ts, learning-book-library.ts as needed; test/standalone-client.test.tsx.
Interfaces: GET/PUT /api/settings -> {text:{baseUrl,model,apiKeySet},embedding:{baseUrl,model,apiKeySet},image:{baseUrl,model,apiKeySet},search:{apiKeySet,enabled}}; PUT secrets omitted preserves, empty clears. GET /api/model -> {provider:'local',model} or null. Existing /nobei/v1 and /nobei/quiz/v1 interfaces preserved. GET/PUT /api/library -> {books: LearningBook[]}. PUT body is full library; server serializes writes. No DSH source in standalone mode.
- [x] Add render tests for independent navigation, missing-model setting path and disabled DSH import source; run vitest to establish failures.
- [x] Build full-page shell reusing extraction, books, learning, quiz components and styles. Stable workspace 'standalone'. Persist library to server, keeping async saves ordered and reporting failures.
- [x] Implement settings form with secrets write-only, clear controls and optional capability sections. Refresh model snapshot after settings save.
- [x] Verify navigation/book actions and preservation of existing UI tests; commit scoped changes.

## Task 3: Standalone runtime and model adapter

Files: src/standalone/server.ts, config.ts, model.ts, subprocess.ts, operations.ts; shared product port declarations as needed; test/standalone-runtime.test.ts and model tests.
Interfaces: standalone server serves compiled public files, settings/model/library APIs and existing product routes; native child adapter satisfies CoreSupervisor; generation adapter start(prepared, options) returns existing GenerationHandle.
- [x] Write config secret-redaction and same-origin tests; write fake-provider generation tests including structured-output failure/cancel.
- [x] Implement validated private config with atomic writes and masked GET. Persist library JSON inside data root, validating shape/size and serializing writes. Settings changes rebuild quiz service only when no generation is active.
- [x] Reuse planner and Core contracts while moving provider-neutral generation steps out of DSH execution; direct OpenAI-compatible structured tool call, no automatic provider retries.
- [x] Implement native subprocess adapter and explicit independent application operation assembly. Reuse HTTP route logic with structural interfaces rather than DSH imports.
- [x] Run service with actual Python Core in temp data root and fake model; exercise preview/import/review/book/attempt through HTTP. Commit verified changes.

## Task 4: Local images, packaging and maintenance

Files: services/quiz/app/services/image_service.py and local_image_service.py; src/standalone/server.ts; bin/betterlearn-web.mjs; scripts/build-web.mjs; package.json; independent package manifest; scripts/standalone-backup.mjs; tests.
- [x] Test local image writes and URL path restrictions before implementation; persist generated images to quiz-data/images and expose only validated image names via same-origin route.
- [x] Build standalone browser and server bundles with no DSH externals; generate standalone package containing its own manifest, Python sources/dependencies, contracts, license, public files and CLI.
- [x] Add init/start/backup/restore commands; backup requires stopped app and includes databases, vectors, uploads, images and settings. Restore to a fresh home and verify contents; never clobber live data.
- [x] Test startup without MySQL/DSH, absent credentials, port conflict, process cleanup and packaged startup.

## Task 5: Integrated acceptance and review

Files: docs/standalone-web.md, docs/standalone-web-verification.md, README.md and acceptance scripts/tests.
- [x] Run frontend/type checks, targeted tests, full Core and quiz suites. Record actual counts and known limitations.
- [x] Run browser acceptance against independent service with fake provider: import -> extraction -> evidence review -> book -> learning; knowledge upload -> ready -> preview/extraction; quiz -> report -> history; reload and restart.
- [x] Validate backup/restore and standalone package without DSH modules, verify no secrets in browser responses.
- [x] Review full diff for correctness/security/regressions, address important findings, update docs with actual tested commands and results. Commit final implementation, do not push.

## Execution ledger

- SQLite: b09c24f, reviewed; storage failure and interruption fixes 3a75521, 1f47f97.
- Model/shared orchestration: 258879d; local images a264098; error privacy d17c700.
- UI: 9e799d3, browser/CAS/deletion refinements 878c2c5.
- Runtime foundation was included in combined commit 1f47f97 due to shared index; remaining CAS/shutdown/packaging refinements follow.
- Runtime review: both shutdown lock race and stale-tab overwrite findings resolved and re-reviewed.
- Verification: 479 Web/TypeScript, 393 Core Python, 226 quiz Python pass. Clean source build and packaged init/start pass.

- Final diff review: empty Chroma dimension retention fixed; real-Chroma regression and independent re-review passed. Packaged archive inspected and relocated CLI smoke passed.
