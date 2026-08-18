# BPMCore Architecture Notes

Use this file as the quick architecture source before changing the project.

## Naming

- Always write BPM in uppercase.
- The backend runtime app is `apps/api`.
- The reusable BPM package boundary is `libs/bpm-core`, exposed as
  `@rytass/bpm-core-nestjs-module`; `@bpm/core` is only an internal path alias.
- Do not reintroduce `apps/bpm-demo-host` or `@bpm/api/*`.

## Project Boundaries

- `apps/api`: NestJS host shell only. It wires Vault, TypeORM, GraphQL, CORS, validation, exception filters, health checks, DB-backed test-member login/session endpoints, wrapper-app seeding, and `BPMRootModule`.
- `libs/bpm-core`: reusable BPM backend core. Put BPM domain modules, entities, resolvers, mutations, services, migrations, auth contracts, and TypeORM helpers here. Exposed as `@rytass/bpm-core-nestjs-module`.
- `libs/bpm-core-client`: cross-platform typed GraphQL/REST client. Exposed as `@rytass/bpm-core-client`.
- `libs/bpm-core-react`: React UI library (providers, hooks, views, Next.js page shims). Exposed as `@rytass/bpm-core-react`.
- `apps/client`: Next.js backoffice UI. Pure thin host — every `app/<route>/page.tsx` is a one-line re-export from `@rytass/bpm-core-react/pages/<feature>`; `providers.tsx` is a one-line `<BPMNextProviders>` wrapper. No business logic lives here. On localhost it uses `http://localhost:17603/graphql` and `http://localhost:17603` (root-level `/auth/*` + `/attachments/*` endpoints, no `/api` prefix); on deployed hosts it defaults to same-origin `/graphql` plus same-origin root paths.
- `libs/shared`: shared BPM contracts for workflow, form, condition, identity, organization, and status types. Exposed as `@rytass/bpm-core-shared`.

## Public API Reference

`docs/api-reference.md` is the **canonical inventory** of every export from every BPMCore lib. It lists every type, interface, function, hook, component, NestJS module, entity, service, migration, view, page, and subpath in the four published packages.

**Maintenance invariant** — any change under `libs/*/src/**` (adding, removing, renaming, or moving a symbol), or any edit to `package.json` `exports`, `tsconfig.base.json` paths, or `libs/bpm-core-react/vite.config.ts` `PLANNED_ENTRIES`, MUST update `docs/api-reference.md` in the same commit. Bump the "Last verified against" line at the top of that file to the new version of each affected package.

Before adding new exports, check the file first — likely something close already exists. When you finish editing libs, re-grep your changes against the doc to confirm coverage. CI does not enforce this yet; humans and agents are the enforcement.

## Releasing

**Never hand-edit `version` in `libs/*/package.json`.** `nx release` (config in
`nx.json`) owns versions, per-package `CHANGELOG.md`, git tags and GitHub
releases for **all four** published packages:

```bash
npx nx release --dry-run       # review first
npx nx release --skip-publish  # version + changelog + commit + tag
npx nx release publish         # publishes every package from the right dir
```

A manual bump skips the changelog generation, so a release ships with a
`CHANGELOG.md` that still ends at the previous version. That has happened; do
not repeat it.

**All four packages are one fixed version set** — `shared`, `bpm-core`,
`bpm-core-client` and `bpm-core-react` share a version number, a `v{version}`
tag, one workspace `CHANGELOG.md` and one GitHub release, plus a per-package
`CHANGELOG.md` each. `prepublish-check` runs for all four before versioning.

The cost of a fixed set: a change to any package bumps all four, so
`bpm-core-react` ships a new version even when only backend code moved. That is
the accepted trade for one number to reason about — `bpm-core-react` used to
version on its own cadence and drifted to 0.8.0 while the core sat at 0.7.0.

Inter-package ranges are maintained automatically
(`preserveMatchingDependencyRanges: false`). Do not hand-edit the
`@rytass/bpm-core-*` entries in each package's `peerDependencies`; `nx release`
rewrites them to the new version. The historical accumulation in
`bpm-core-react` (`^0.4.0 || ^0.5.0 || ^0.6.0 || ^0.7.0`) was collapsed to a
single current range when the versions were aligned at 0.9.0 — do not
reintroduce that pattern by hand.

**`useCommitScope: false` is required — do not remove it.** nx defaults to
`true`, which only counts a commit toward the bump when its scope matches a
*project* name; everything else is treated as an indirect change and forced down
to `patch` regardless of type. This repo scopes commits by domain
(`feat(template)`, `fix(calendar)`), so with the default a release containing
three features resolved to `patch` — verified against
`nx/dist/src/command-line/release/utils/semver.js`. With it set to `false`, every
commit touching the project's files counts, and the same set correctly resolved
to `minor`.

Still read the resolved version in the dry run, and override when needed:

```bash
npx nx release minor --skip-publish   # or patch / major / an exact version
```

The 0.9.0 release had to be given explicitly (`npx nx release 0.9.0`) because
aligning the version set meant clearing `bpm-core-react`'s already-published
0.8.0; the core packages skip 0.8.0 entirely. From the `v0.9.0` tag onward the
bump resolves automatically again.

Full publish commands, and why the backend and frontend packages publish from
different directories, are in `docs/api-reference.md` → "Publish Procedure".

## Auth Model

BPMCore does not own login, token issuance, or a user table. The host app must provide:

- a `BPMAuthContext` source through GraphQL/HTTP context or `BPMRootModule` `authContextFactory`
- a `BPM_MEMBER_RESOLVER` provider

There is no mock auth fallback in `@rytass/bpm-core-nestjs-module`. The test accounts in `apps/api` are DB-backed wrapper-app simulation data in `api_test_members`, seeded by `pnpm demo:reset` / `pnpm staging:reset`, and are not part of the reusable BPM module.

## Development

Normal local runtime:

```bash
pnpm api
pnpm client
```

Use `pnpm demo:reset` before local scenario testing when the develop schema
needs a clean Taiwan manufacturing seed.

Normal verification:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm e2e:client
```

`docker compose` is not required for normal development. Use Vault-backed develop secrets and `bpm_core/develop` unless the user explicitly asks otherwise.

Staging wrapper-host runtime secrets include `API_SESSION_SECRET`,
`BPM_API_PUBLIC_URL`, and `BPM_ATTACHMENT_SIGNING_SECRET`; the API host passes
the BPM attachment values into `BPMRootModule`.

## Dependency Overrides

Security fixes for transitive dependencies live in `pnpm-workspace.yaml`
`overrides`. **Always write them as a `^` range, never as an exact version.**

An exact pin stops pnpm taking the next patch, so an override added to fix one
advisory silently becomes the thing holding a known-vulnerable version in
place. That is not hypothetical: `axios@1.15.2`, `postcss@8.5.10`,
`fast-uri@3.1.2` and `brace-expansion@5.0.5` each sat one patch below their fix
and accounted for 29 of the repository's open alerts before being converted to
ranges.

Some overrides exist to force a **single copy** rather than to raise a floor —
currently `typeorm` and `next`. Two copies of either break typechecking rather
than security: `@nestjs/typeorm` ends up with two unrelated
`TypeOrmModuleOptions` types, and `bpm-core-react`'s `next` peer can resolve
against the older copy the eslint config pulls in. Keep those, and keep the
whole `@nx/*` set on the same version as `nx`.

CI reports `pnpm audit` on every run and fails only on `critical`. A blocking
`high` gate would be permanently red — `image-size`, reached through
`@nx/webpack > less`, has no published fix — and a permanently red gate stops
being read. Nothing is suppressed into an allowlist; the outstanding findings
stay visible in the log.

## Dev Supervisor 控制通道（`pnpm dev:ctl`）

在使用者已自行啟動 `pnpm dev` 的前提下，agent 改完程式碼後**應主動**用
`pnpm dev:ctl restart <api|client>` 重啟受影響的 service，依 exit code 判斷
結果；exit `3` 代表 dev server 沒在跑——請使用者執行 `pnpm dev`，agent
**不得**自行啟動。指令一覽、exit code 契約、失敗 `reason` 判讀（webpack
橫幅與 Next.js `⨯` 符號等 crash pattern）、`readinessConfidence` 與 client
lazy-compile 侷限，見 `operating-dev-supervisor` skill。

## Template Designer AI Assistant

The flow designer page ships an LLM chat assistant (`WorkflowChatDrawer`) that
drives the workflow **toolset** to draw/edit the flow from natural language. It
runs through the Next.js route `apps/client/src/app/api/chat/route.ts` (a one-line
re-export of `createWorkflowChatPOST` from `@rytass/bpm-core-react/next/workflow-chat-route`).
Tools have no server `execute` — every tool call is executed in the browser via
`useWorkflowDesignerController.executeTool`, so the assistant can only do what a
user can do on that page (other requests are declined by the system prompt).

The feature is **opt-in and hidden by default** at the lib level. The designer
page shim shows it only when `BPM_AI_ASSISTANT_ENABLED=true`; without
`OPENAI_API_KEY` the toggle is shown disabled as a placeholder. `TemplateDesignerView`
also accepts `showAiAssistant` / `aiAssistantAvailable` props for direct control.

Next.js server env (the client host, not `apps/api`), in `apps/client/.env.local`:
- `BPM_AI_ASSISTANT_ENABLED` — `'true'` to show the assistant (default hidden).
- `OPENAI_API_KEY` — OpenAI key (server-only, never `NEXT_PUBLIC_`). The route
  talks to OpenAI directly via `@ai-sdk/openai` — no Vercel AI Gateway.
- `BPM_LLM_MODEL` — optional OpenAI model id; defaults to `gpt-5.4-mini`.
- `BPM_TEMPLATE_DRY_RUN_ENABLED` — set to `'false'` to hide the designer's
  "試跑流程" (dry-run) button (shown by default). `TemplateDesignerView` also
  accepts a `showDryRun` prop for direct control.
