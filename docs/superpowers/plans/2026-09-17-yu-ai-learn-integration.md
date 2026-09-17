# yu-ai-learn Integration Implementation Plan

> **For agentic workers:** Use subagent-driven-development for the UI task and review; execute the service integration in the controlling session. Track completion below.

**Goal:** Bring the modified tutorial's knowledge library and full quiz workflow into the existing BetterLearn repository and UI.

**Architecture:** Migrate the current backend to services/quiz, managed by BetterLearn Host with private loopback authentication. Embed adapted React components in BetterLearn; all browser requests use /nobei/quiz/v1. Keep existing /nobei/v1 knowledge extraction, SQLite, MySQL and Chroma responsibilities.

**Tech Stack:** Existing React 18.2, Node TypeScript, FastAPI, MySQL and Chroma.

## Global Constraints

- Preserve both dirty workspaces; no deleting the original tutorial directory.
- Keep existing Git remote and history; implementation on codex/integrate-yu-ai-learn.
- No browser token storage, global hash routing, iframe, or second Vite server.
- Preserve original license and attribution. No secrets/runtime files in Git.
- Retain the new knowledge-base extraction source as well as full practice features.

### Task 1: Migrate service and runtime

- [x] Copy backend app/tests/requirements and source license into services/quiz; record provenance.
- [x] Add tests for Host-only authentication and genuine missing-content 404; run failing tests before implementation.
- [x] Add managed service token gate and Host session endpoint, then run backend tests.
- [x] Add src/product/quiz-service.ts with start/request/dispose methods, private token, loopback binding, bounded readiness, explicit port-conflict failure, authentication renewal and subprocess cleanup.
- [x] Add test/quiz-service.test.ts with a fake child service for lifecycle/auth/request testing.

### Task 2: UI migration

- [x] Adapt current frontend components/pages/session into src/client/quiz. Add .js relative extensions for NodeNext; share host React.
- [x] Provide createQuizApi() using /nobei/quiz/v1, and connect() using /session, without exposing or persisting JWT.
- [x] Embed QuizWorkspace in floating-workbench with knowledge library/practice entry buttons and return navigation.
- [x] Use internal React route state and namespaced storage; preserve full async generation, resume, answer, report and history workflows.
- [x] Scope migrated CSS and include it in the host client bundle; test navigation, origin/hash isolation and API behavior.

### Task 3: Host routes and knowledge extraction

- [x] Register /nobei/quiz/v1 routes with existing authorizeProductRequest checks, exact allowed paths/methods, bounded JSON/multipart bodies, cancellation and safe errors.
- [x] Return existing quiz response envelopes; session exposes user only, no backend token.
- [x] Wire managed service in plugin configuration/dependency lifecycle, use it as the knowledge source when enabled, retain external compatibility.
- [x] Cover route allowlists, request-origin enforcement and managed knowledge-source wiring with tests.

### Task 4: Installation and validation

- [x] Include service files in tarball; add isolated quiz venv and private env template provisioning to CLI installation/upgrade, expose managed settings through bundle patch.
- [x] Document MySQL/model prerequisites, one startup entry, existing data migration and separate backup responsibilities.
- [x] Run backend tests, host/client tests/build, packaging inspection and real local managed-service smoke tests.
- [x] Perform independent review, resolve findings, and record actual end-to-end evidence and any external configuration limits.

真实完整学习书操作未在安装后的 DSH 中重演；原 Core 回归全通过，新知识源读取真实验证通过。图片模型可用，但现有 COS 桶名无效，完整配图持久化等待有效配置。详见验收记录。
