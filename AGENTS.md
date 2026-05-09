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
- Infrastructure target: Vault paths `bpm_core/develop` and `bpm_core/staging`, Cloud SQL database `bpm_core`, schemas/users `bpm_core_develop` and `bpm_core_staging`, staging DNS `bpm-core-staging.rytass.info`; develop is DB/Vault only, staging is deployable.

## Progress Notes

- 2026-05-04: M1 W2 Form Builder is complete with reusable `FormRenderer`, builder preview integration, unit tests, and `pnpm e2e:client` Playwright coverage.
- 2026-05-04: M1 W3 Approval Template foundation is implemented with template/version GraphQL APIs, workflow validation, React Flow designer, version history, and `pnpm e2e:client` Playwright coverage.
- 2026-05-04: M2 W4 Workflow Engine foundation is in progress with instance/token/task/activity entities, submit snapshot flow, advisory-lock processing skeleton, and API unit coverage.
- 2026-05-06: M2 W5 linear approval execution is implemented with task decision GraphQL APIs, submit/process/approve client flows, inbox/detail pages, API unit coverage, and `pnpm e2e:client` Playwright coverage.
- 2026-05-06: M2 W6 workflow branching runtime is implemented in the engine with structured edge condition evaluation, exclusive gateway routing, multi-outgoing token fork, AND/OR predecessor joins, sibling cancellation for OR joins, and API unit coverage.
- 2026-05-06: Workflow launch entry UI is implemented with a `/instances/new` launch center, dashboard/inbox/template shortcuts, launchability filtering, and Playwright coverage.
- 2026-05-08: W7 1/2 scope completed with CEL-backed policy/condition evaluation, approver resolver support, return/cancel/resubmit instance controls, workflow dry run API/UI, and full lint/typecheck/build/e2e/browser verification.
- 2026-05-09: W9 notification/SLA foundation is in progress with in-app notification storage/API, task-assigned notifications, SLA due calculation/scanning, notification center UI, and inbox SLA countdown; email/webhook/timeout actions are currently hook + console logging only.
- 2026-05-09: W8 delegation and transfer is implemented with delegation rule CRUD, automatic task assignee resolution, manual task transfer, admin UI, task detail transfer UI, API unit coverage, and Playwright browser coverage.
- 2026-05-09: W7 completed with configurable return resubmit strategy (`RESTART` / `FROM_RETURN_POINT`), richer workflow dry run routing diagnostics, designer UI controls, API regression coverage, and full lint/typecheck/test/build/e2e verification.
