# Electron Desktop Implementation Plan

**Goal:** Deliver a runnable and packageable desktop shell for the existing local BetterLearn application.

**Architecture:** Electron owns a secure window and the existing standalone service. The service continues to own Python children, data locking and API configuration. Python 3.12 is an explicit prerequisite; a first-run desktop flow prepares two isolated environments with progress and retry. No host model integration or MCP in this phase.

**Tech Stack:** Electron, TypeScript, esbuild, electron-builder, existing React and Python services.

## Global constraints

- Preserve the Web entry point and existing API configuration.
- No Codex/Claude credentials, model sessions or subscription integrations.
- macOS/Linux only until the existing POSIX data lock is ported.
- Keep Python files outside ASAR; do not package developer environments, user data or API keys.
- Desktop uses the existing default `~/.betterlearn-web` home, with an explicit environment override for isolated validation; never silently migrates data.

## Tasks

- [x] Runtime preparation: introduce `src/desktop/runtime.ts` and `test/standalone-desktop-runtime.test.ts`. Validate Python 3.12, validate saved runtime paths, install requirements into `venv` and `quiz-venv` under the data lock, write `runtime.json` only after success. Abort spawned process groups on cancellation. Validate with temporary homes and injected process runner; keep startup errors actionable and credentials out of logs.
- [x] Desktop lifecycle: create `src/desktop/main.ts` with a sandboxed BrowserWindow, first-run loading/setup UI and narrow preload methods. Use `startStandalone` with stable loopback port 3210 to preserve browser storage; allow an explicit port override for isolated tests. Prevent untrusted navigation, popups and permissions. Single-instance activation focuses the existing window. Await startup/initialization cancellation and service close before quit.
- [x] Build/package: add desktop typecheck and esbuild entry points, package metadata and electron-builder configuration. Copy built standalone resources outside ASAR. Add `build:desktop`, `start:desktop`, `pack:desktop` scripts with pinned dependencies.
- [x] Validation: run runtime and lifecycle tests, typecheck/build, existing standalone tests, then launch real Electron with a temporary home and existing Python interpreters. Verify first-run setup screen, learning interface, API configuration masking and normal shutdown. Build a local unsigned application artifact.
- [x] Documentation: explain Python prerequisite, first launch, data location, startup commands, unsigned packaging limits and what is still deferred. Record actual checks and limitations without claiming MCP is implemented.

## Acceptance scenarios

1. Fresh home renders setup instructions; cancelling closes cleanly without a published runtime config.
2. Invalid Python or failed installation can be retried without losing learning data.
3. Prepared home launches the existing app with no DSH/Codex/Claude installed.
4. Window has no Node integration; external navigation/popups do not gain access to preload actions.
5. Normal quit stops Python services and releases the home lock.
6. Packaged app finds UI, contracts and Python services without repository paths or system Node.

## Progress

Implementation and packaged macOS arm64 verification completed. See `docs/desktop-verification.md` for commands, outcomes and remaining distribution limits. The real desktop workflow also exposed an existing API-key input crash; a regression test and fix are included in this phase.
