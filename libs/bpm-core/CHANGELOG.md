# Changelog

All notable changes to `@rytass/bpm-core-nestjs-module` are documented in this
file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases are managed by [`nx release`](https://nx.dev/recipes/nx-release) with
Conventional Commits — see `nx.json` for the release config.

## 0.1.8 — 2026-05-28

### Documentation

- **Casbin example BPMAuthContext shape corrected.** The 0.1.6/0.1.7
  example returned `{ memberId, email, name, roles, permissions,
  metadata }` — the actual `BPMAuthContext` interface is
  `{ memberId, roles, permissions, metadata }` (no `email`, no `name`).
  Example now stashes display data inside `metadata`, with an explicit
  callout that name/email reach resolvers through `BPMMemberResolver`
  instead.
- **`createPosition` / `updatePosition` / `createMembership` /
  `updateMembership` / `createManagerResolution` exact signatures
  added** to the org Worked Example section. The 0.1.7 README only
  listed function names; downstream developers were guessing input
  shapes (e.g. mandatory `level` and `metadataJson` on positions).
- **`metadataJson` write-only clarification.** The "host-FK stash"
  rule was misleading: `metadataJson` is accepted by every mutation
  but the records returned by `readOrganizationDashboard` do NOT
  surface a `metadata` field. Updated to "always reconcile by `code`;
  treat `metadataJson` as audit/debugging breadcrumb, not a live FK
  pointer."

### Why a patch

Documentation only. No source change.

## 0.1.7 — 2026-05-28

### Documentation

- **README "Bring-your-own-host-auth" recipe** added under Auth
  Context. Documents the `ApiMember` JSON shape, the expected status
  codes for `/auth/login`, `/auth/me`, `/auth/logout`, and two
  integration patterns: (A) extend the host API with `/auth/*`
  controllers that emit `ApiMember` (recommended for member-base
  hosts), or (B) run a thin wrapper host on a separate subdomain.
- **README "Sharing a Postgres cluster with the host"** added under
  Database Setup. Compares same-schema / separate-schema / separate-DB
  trade-offs, recommends separate-schema, clarifies Vault path
  isolation between host and BPM.
- **`commitOrgUnitTreeDraft` signature corrected** in the Worked
  Example listing — previously `{ baseUpdatedAt, draft }` (incorrect),
  now `{ moves: { id, parentId, baseUpdatedAt }[] }` matching the
  actual export.
- **`OrgUnitType` literal case corrected** in the README's example
  comment — previously `'COMPANY' | 'DIVISION' | ...`, now `'company'
  | 'division' | ...`. (See `@rytass/bpm-core-shared@0.1.7` for the
  actual TS type change.)
- **"Positions are intentionally not deletable" note** added to the
  Organization mirror pattern. Explains why no `deletePosition`
  mutation exists and how to retire a position safely.
- **README "Package Status" current-version line refreshed** to
  `0.1.7`.

### Why a patch

Documentation-only. No public API change beyond what
`@rytass/bpm-core-shared@0.1.7` ships.

## 0.1.6 — 2026-05-28

### Added

- **`MemberNotFoundException`** is now exported from the root barrel
  (and `/identity` subpath). The `BPMMemberResolver.resolve` JSDoc has
  referenced this class for two releases without actually shipping it;
  hosts can now `throw new MemberNotFoundException(memberId)` directly.

### Documentation

- **README "Mapping from a host RBAC system (e.g. Casbin)"**: worked
  example showing how to project a host's grouping policy
  (`enforcer.getRolesForUser(memberId)`) into BPM's exact-string role
  literals inside `authContextFactory`.
- **README "Cross-origin authentication"** under Attachment Storage:
  documents that signed URLs carry auth inside the URL (not via cookie),
  what the TTL controls, and the production-grade defenses on top.
- **README "Disabling the `/auth/test-members` endpoint in production"**:
  clarifies that the endpoint is wrapper-host-owned (BPM does not
  register it) and that the React client degrades gracefully when the
  endpoint is absent.
- **README Worked Example rewritten** to call the actual published
  `@rytass/bpm-core-client/organization` exports
  (`readOrganizationDashboard`, flat-input `createOrgUnit` /
  `updateOrgUnit`) — the 0.1.5 example called functions that didn't
  exist. Adds an "Atomicity caveat" note clarifying that only
  `commitOrgUnitTreeDraft` is transactional; sequential
  `createMembership` calls are independent.

### Why a patch

`MemberNotFoundException` is purely additive. Other changes are docs.

## 0.1.5 — 2026-05-28

### Documentation

- **Identity contract clarifications.** `BPMMemberResolver.resolve` JSDoc
  now states the unknown-id contract explicitly (throw
  `MemberNotFoundException`); `resolveMany` documents the diverging
  partial-success contract (omit unknown ids from the returned `Map`).
  Both methods cross-link `identityMemberMetadataCacheTtlMs`
  (default 5 min) so consumers know BPM caches their resolver responses.
- **`BPMRootModule` JSDoc dangling refs removed.** The previous
  references to `docs/10-bpm-embedding-auth.md` and
  `docs/11-consumer-quickstart.md` (files that never shipped) are now
  inline pointers to the README sections.
- **New "Organization data ownership" README section.** Documents that
  BPM is authoritative for `org_units`, `positions`, `memberships`, and
  `manager_resolutions` (no host-injectable resolver pattern, unlike
  members), the rationale (approver-routing / tree-diff hot path), the
  mirror pattern using `OrgUnit.code` as the natural key and the
  `metadata` JSON for host foreign-keys, and an idempotent worked
  example using only `@rytass/bpm-core-client/organization` exports.

### Why a patch

No public type signatures change. JSDoc + README only.

## 0.1.4 — 2026-05-27

### Fixed

- **Re-publish of the 0.1.3 release.** The 0.1.3 tarball was inadvertently
  published from `libs/bpm-core/` instead of from `dist/libs/bpm-core/`,
  shipping only TypeScript sources with `main: "./src/index.js"` pointing
  at non-existent files. 0.1.3 has been **deprecated on npm**. The
  publish procedure (`docs/api-reference.md` Publish Procedure section
  and `tools/publish/finalize-dist-package.mjs` header) now codifies the
  correct flow: `nx build` → `finalize-dist-package.mjs` →
  `cd dist/libs/<pkg> && npm publish`.

### Documentation

- Publish-procedure-from-dist section added to `docs/api-reference.md`.
- `tools/publish/finalize-dist-package.mjs` header warning expanded.

## 0.1.3 — 2026-05-27 (deprecated on npm)

**DO NOT INSTALL — broken release.** Published from source dir instead
of dist dir; tarball contains only `.ts` files. Use 0.1.4 or newer.

## 0.1.2 — 2026-05-27

### Fixed

- **First migration class-name suffix collision with TypeORM timestamp
  validation.** `EnablePostgresExtensions0000000000000` from 0.1.1
  parsed to a JavaScript timestamp of `0`, which TypeORM 0.3's
  `MigrationExecutor.getMigrations()` rejects with
  `migration name is wrong. Migration class name should have a JavaScript
  timestamp appended.` (the check is `!timestamp || isNaN(timestamp)`).
  Renamed to `EnablePostgresExtensions0000000000001` (timestamp `1`).
  The file was also renamed
  `0000000000000-enable-postgres-extensions.ts` →
  `0000000000001-enable-postgres-extensions.ts` so file ordering still
  matches class ordering.

  Consumers on 0.1.0 / 0.1.1 should upgrade directly to 0.1.2.

## 0.1.1 — 2026-05-27

### Fixed

- **Migration class-name suffix consistency.** Seven migrations
  (`EnablePostgresExtensions`, `IdentityOrganizationFoundation`,
  `FormBuilderFoundation`, `ApprovalTemplateFoundation`,
  `WorkflowEngineFoundation`, `ApprovalTemplateCategories`,
  `TaskCandidates`) previously used 13-digit date suffixes
  (`...2026050404000`) while the remaining seven used sequence suffixes
  (`...0000000005000`). TypeORM's `MigrationExecutor` sorts by the
  trailing numeric tail of the class name, so date-suffixed migrations
  ran AFTER sequence-suffixed ones — producing
  `relation "approval_instances" does not exist` when
  `NotificationsSla0000000006000` tried to FK-reference a table that
  `WorkflowEngineFoundation2026050404000` would only create later.

  All 14 migration classes now use the sequence suffix that matches the
  file-name prefix (`EnablePostgresExtensions0000000000000` …
  `WorkflowQueryIndexes0000000013000`). Array order in
  `BPM_CORE_MIGRATIONS` is unchanged.

  **Breaking for fresh deployments only**: the migration bookkeeping
  table records class names, so consumers upgrading from 0.1.0 in a
  production database would see the renamed migrations as "pending"
  again. Since 0.1.0 is a same-week release and there are no recorded
  production deployments yet, no migration backfill is shipped. If a
  consumer needs to upgrade in place, manually
  `UPDATE migrations SET name = REPLACE(name, '2026...', '00000...')`
  in the migrations table to retain the executed state.

## 0.1.0 — Unreleased

### Added

- Initial published surface: `BPMRootModule.forRoot` / `forRootAsync`,
  domain modules (identity, organization, form, template, workflow engine,
  delegation, notification, signature, attachment), TypeORM migrations
  (`BPM_CORE_MIGRATIONS`), GraphQL resolvers, and shared host contracts
  (`BPMAuthContext`, `BPMMemberResolver`, `ATTACHMENT_STORAGE`,
  `BPM_WORKFLOW_SERVICE_TASK_DISPATCHER`, `BPM_NOTIFICATION_DISPATCHER`).
- Role / permission contract (`BPM_ADMIN`, `BPM_DESIGNER`, plus permission
  string sets) enforced by `BPMAdminGuard` and `BPMDesignerGuard`, with
  `BPMAuthenticated()`, `BPMAdminOnly()`, `BPMDesignerOnly()`,
  `BPMCurrentAuthContext`, and `BPMCurrentMemberId` decorators.
- Dynamic attachment controller path via `attachmentRoutePrefix` (no Nest
  `setGlobalPrefix` required).
- `AllExceptionsFilter` global Nest exception filter.

### Changed

- `@rytass/bpm-core-shared` is now a `peerDependency` (`^0.1.0`) so
  consumers manage shared version themselves.
- `@rytass/secret-adapter-vault-nestjs` moved to optional `peerDependency`,
  accepting `^0.4.5 || ^0.5.0`.
- `express` moved to optional `peerDependency`.
