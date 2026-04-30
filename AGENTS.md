## General Rules (通用規範)

- **Markdown Tables**: Always keep **column width consistent** across rows.
- **Language**: Default to **Taiwan Traditional Chinese** (avoid Mainland/HK terms).
- **Git Commit Messages**: Follow **commitlint** convention, written in **English**.
- **ClickUp Task Tagging**: Use format `#{ID}[COMPLETED]`.
- **Dev Server Usage**:
  - User launches Dev Server manually by default.
  - Only start if explicitly instructed or no valid server found.
  - Always confirm before starting; kill after validation.
- **Push/Commit Restriction**:
  - Never commit/push without explicit user instruction.
  - Confirmation required **every time**.
  - **Atomic Commits**: When committing, automatically split changes into multiple granular commits by scope.

## Development Workflow (開發工作流程)

- **Avoid Excessive Mocks**: Focus on actual tasks, not artificial test cases.
- **Record Large Tasks**: Write progress to **project-scoped AGENTS.md**.
- **Agent Utilization**: Use specialized agents via Task tool when appropriate.
- **Cleanup Temporary Scripts**: Delete debug/experimental files after completion.
- **Memory Hygiene**: Keep AGENTS.md concise; store transient notes in tasks.md.
- **Skill Creation**: When asked to create a "skill", it refers to **Codex skill**.

## Frontend / UI Development (前端 UI 開發)

- Backoffice UI is based on `@mezzanine-ui/react`.
- Prefer existing Mezzanine components over custom implementations.
- Only build custom components when the behavior cannot be represented by Mezzanine primitives, such as React Flow node and edge renderers.
- Do not use removed Mezzanine APIs such as `ContentHeader`, `Scrollbar`, or `Switch`.

## TypeScript / Coding Rules (程式設計規範)

- Do **NOT** use `any` type.
- Every function must declare a **return type**.
- Comply with project **eslint** rules.
- Prefer **immutable data structures** and **functional programming**:
  - Avoid mutation (`push`, `splice`, reassignment).
  - Use pure functions, `map`/`reduce`/`filter`.
  - Prefer `readonly` and `const` over `let`.

## BPM Project Decisions

- Project name: `bpm`
- Package scope: `@bpm`
- Monorepo: Nx integrated workspace
- Backend: NestJS + GraphQL Code-First + TypeORM + PostgreSQL
- Frontend: Next.js App Router + React Flow + Mezzanine UI
- Shared types live in `libs/shared` and expose workflow, form, condition, and status contracts.
- M0 is local-only. Do not create cloud DB, Vault, GKE, GitHub repo, DNS, commits, or pushes without explicit instruction.
