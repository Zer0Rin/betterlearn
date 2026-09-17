# Glass Workbench Implementation Plan

> Execute tasks in this session; isolated visual CSS work can run in parallel with shell implementation.

**Goal:** Restore the plugin-style resizable workspace to standalone Web and unify its glass visual design.

**Architecture:** A host-independent WorkbenchWindow keeps its child tree mounted. Pure sizing helpers reuse existing bounds calculations with separate standalone persistence. Business APIs and persistence stay in StandaloneApp.

**Tech Stack:** React 18, TypeScript, CSS container queries, existing Lucide icons, Vitest and Playwright.

## Constraints

No DSH runtime imports, backend changes, migration, native integration or external font/image dependency. Respect reduced motion, solid background fallback, keyboard focus, and narrow containers. Keep real provider acceptance out of scope.

## Tasks

- [x] Add regression tests in test/standalone-window.test.tsx for preserved child state across collapse, manual size restoration, keyboard resizing, corrupt/blocked storage and viewport clamping. Run with corepack pnpm exec vitest run --config vitest.web.config.ts test/standalone-window.test.tsx before implementing.
- [x] Create src/standalone/window-state.ts with versioned read/write and viewport-safe bounds. Create src/standalone/WorkbenchWindow.tsx with children, storage and title props, pointer/keyboard resize handles, collapse/restore and maximize/restore. Keep children mounted under hidden container. Persist manual size only; use refs for gesture and focus restoration. Add window.css and integrate wrapper in App.tsx; import styles in client.tsx.
- [x] Add src/standalone/glass.css scoped tokens and component styles. Replace viewport assumptions with container-aware navigation, grids and content scrolling. Apply across library, extraction, learning, quiz and settings.
- [x] Run corepack pnpm test, which builds and executes Web/common business regression tests. Inspect browser screenshots in wide, narrow and mobile layouts; exercise settings draft preservation, pointer and keyboard resizing, maximize restoration and existing business flows using isolated acceptance data.
- [x] Review changed files for state loss, hidden focus, resize cleanup and CSS overflow. Record fresh results in docs/standalone-web-verification.md and update launch guide. Rebuild package with corepack pnpm pack:web and commit only reviewed task files locally.
