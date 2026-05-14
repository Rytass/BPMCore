## General Rules (通用規範)

- **Markdown Tables**: Always keep **column width consistent** across rows.
- **Language**: Default to **Taiwan Traditional Chinese** (avoid Mainland/HK terms).
- **BPM Naming**: Always write **BPM** in uppercase because it is an abbreviation.
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
- Backend runtime app: `apps/api` (NestJS + GraphQL Code-First + TypeORM + PostgreSQL host shell)
- Frontend: Next.js App Router + React Flow + Mezzanine UI
- Client runtime app: `apps/client`
- Shared types live in `libs/shared` and expose workflow, form, condition, and status contracts.
- BPM core backend modules live in `libs/bpm-core` and are exposed through `@bpm/core`.
- `apps/api` is only the host shell. It wires Vault, TypeORM, GraphQL, auth/session endpoints, CORS, validation, exception filters, and `BPMRootModule`.
- Do not put reusable BPM domain behavior in `apps/api`; add it to `libs/bpm-core`.
- Future external NestJS systems should import the npm-published equivalent of `@bpm/core` and provide their own auth context factory plus `BPM_MEMBER_RESOLVER`.
- M0 is local-only. Do not create cloud DB, Vault, GKE, GitHub repo, DNS, commits, or pushes without explicit instruction.
- Infrastructure target: Vault paths `bpm_core/develop` and `bpm_core/staging`, Cloud SQL database `bpm_core`, schemas/users `bpm_core_develop` and `bpm_core_staging`, staging DNS `bpm-core-staging.rytass.info`; develop is DB/Vault only, staging is deployable.
- Local development uses Vault-backed develop secrets. `docker compose` is not required for the normal dev or verification flow.

## Progress Notes

- 2026-05-04: M1 W2 Form Builder is complete with reusable `FormRenderer`, builder preview integration, unit tests, and `pnpm e2e:client` Playwright coverage.
- 2026-05-04: M1 W3 Approval Template foundation is implemented with template/version GraphQL APIs, workflow validation, React Flow designer, version history, and `pnpm e2e:client` Playwright coverage.
- 2026-05-04: M2 W4 Workflow Engine foundation is implemented with instance/token/task/activity entities, submit snapshot flow, advisory-lock processing, activity logging, and API unit coverage.
- 2026-05-06: M2 W5 linear approval execution is implemented with task decision GraphQL APIs, submit/process/approve client flows, inbox/detail pages, API unit coverage, and `pnpm e2e:client` Playwright coverage.
- 2026-05-06: M2 W6 workflow branching runtime is implemented in the engine with structured edge condition evaluation, exclusive gateway routing, multi-outgoing token fork, AND/OR predecessor joins, sibling cancellation for OR joins, and API unit coverage.
- 2026-05-06: Workflow launch entry UI is implemented with a `/instances/new` launch center, dashboard/inbox/template shortcuts, launchability filtering, and Playwright coverage.
- 2026-05-08: W7 1/2 scope completed with CEL-backed policy/condition evaluation, approver resolver support, return/cancel/resubmit instance controls, workflow dry run API/UI, and full lint/typecheck/build/e2e/browser verification.
- 2026-05-09: W9 notification/SLA foundation is implemented for in-app notification storage/API, task-assigned notifications, SLA due calculation/scanning, notification center UI, preference UI, and inbox SLA countdown; email/webhook/timeout actions remain hook + console logging only.
- 2026-05-09: W8 delegation and transfer is implemented with delegation rule CRUD, automatic task assignee resolution, manual task transfer, admin UI, task detail transfer UI, API unit coverage, and Playwright browser coverage.
- 2026-05-09: W7 completed with configurable return resubmit strategy (`RESTART` / `FROM_RETURN_POINT`), richer workflow dry run routing diagnostics, designer UI controls, API regression coverage, and full lint/typecheck/test/build/e2e verification.
- 2026-05-10: W10 signature and attachment foundation is implemented with HMAC signature chains, mock timestamp tokens, decision signature integration, local storage via `@rytass/storages-adapter-local`, signed download/preview URLs, FormRenderer upload integration, detail page attachment/signature UI, API unit coverage, and Playwright e2e coverage; MinIO/S3 adapter, encryption-at-rest, and react-pdf preview remain pending.
- 2026-05-11: BPM embeddable module boundary is introduced with `BPMRootModule`, `BPMAuthModule`, injectable `BPMMemberResolver`, and `@bpm/core`.
- 2026-05-11: `apps/api` is now the host shell for local/staging runtime. It provides demo member login, signed HTTP-only session cookie, `/api/auth/me`, logout, and GraphQL `BPMAuthContext` session mapping.
- 2026-05-11: BPM backend domain modules, migrations, tests, and TypeORM helpers now live under `libs/bpm-core`; `pnpm api` serves the `api` project on port 17603.
- 2026-05-11: M1 W1 organization/member interface is implemented with Organization GraphQL filters/summary, org path validation, admin org CRUD UI, member directory detail UI, shared Member/OrgUnit/Position pickers, and unit coverage.
- 2026-05-13: `pnpm demo:reset` resets the Vault-backed develop DB and seeds a coherent demo company with org units, positions, demo members, memberships, manager rules, form definitions, approval templates, instances across states, tasks, notifications, attachments, signatures, and delegations.
- 2026-05-13: Workflow task assignment now supports candidate groups through `task_candidates`, multi-member direct/position/org resolvers, task candidate GraphQL fields, candidate-aware inbox/detail UI, and full `pnpm e2e:client` coverage.
- 2026-05-14: W6 Edge Condition CEL expression runtime is verified for both actual workflow execution and dry run; `edge.data.condition` now represents the executable CEL condition, with structured field/operator data kept only as designer/fallback compatibility.

## Backlog Notes

- Replace `apps/api` demo auth fixtures with a real `@rytass/member-base-nestjs-module` adapter and staging test-account seed before treating staging login accounts as production-like.
