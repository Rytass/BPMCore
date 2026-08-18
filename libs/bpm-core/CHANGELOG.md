## 0.11.0 (2026-08-18)

### 🚀 Features

- **notification:** bound delivery dispatch with a timeout ([d8115f0](https://github.com/Rytass/BPMCore/commit/d8115f0))

### 🩹 Fixes

- **notification:** read claimed ids from the UPDATE result pair ([2fe6e44](https://github.com/Rytass/BPMCore/commit/2fe6e44))
- **notification:** move nodemailer to ^9.0.1 ([e094738](https://github.com/Rytass/BPMCore/commit/e094738))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Claude Opus 5

## 0.10.0 (2026-08-18)

### 🚀 Features

- **form-data-source:** add read-only resolve queries and dependency-wait signals ([e8d9b78](https://github.com/Rytass/BPMCore/commit/e8d9b78))
- **template:** let hosts observe changes and refuse deactivated publishes ([3882dc2](https://github.com/Rytass/BPMCore/commit/3882dc2))
- **notification:** honour recipient preferences instead of dropping rows ([576b8c4](https://github.com/Rytass/BPMCore/commit/576b8c4))

### 🩹 Fixes

- **attachment:** widen the insecure-secret warning and reject blank tokens ([894b7ea](https://github.com/Rytass/BPMCore/commit/894b7ea))
- **api:** accept full-size uploads and report oversized ones as 413 ([3b12d61](https://github.com/Rytass/BPMCore/commit/3b12d61))

### ❤️ Thank You

- Chia Yu Pai @fantasywind

## 0.9.1 (2026-08-18)

### 🩹 Fixes

- **bpm-core-react:** keep moment a required dependency ([41dd5fa](https://github.com/Rytass/BPMCore/commit/41dd5fa))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Claude Opus 5

## 0.9.0 (2026-08-17)

### 🚀 Features

- **notification:** lift routing fields onto the created event ([e02270b](https://github.com/Rytass/BPMCore/commit/e02270b))
- **notification:** let a host observe notifications as they are created ([#21](https://github.com/Rytass/BPMCore/pull/21))
- **shared:** detect a quorum no approver set can ever satisfy ([5671497](https://github.com/Rytass/BPMCore/commit/5671497))
- **shared:** expose the decision policy to the workflow toolset ([f6152b0](https://github.com/Rytass/BPMCore/commit/f6152b0))

### 🩹 Fixes

- ⚠️  **template:** reject deleting a referenced category ([#16](https://github.com/Rytass/BPMCore/pull/16))
- **template:** let a template actually change category ([#17](https://github.com/Rytass/BPMCore/pull/17))
- **shared:** keep an approver change from discarding a workable policy ([ea6afbe](https://github.com/Rytass/BPMCore/commit/ea6afbe))
- **template:** block publishing a deadlocked quorum node ([89ab6a2](https://github.com/Rytass/BPMCore/commit/89ab6a2))
- **e2e:** poll on the expected value in the quorum threshold sanitiser spec ([099529f](https://github.com/Rytass/BPMCore/commit/099529f))
- **bpm-core-react:** correct decision-policy panel review findings ([ebf0337](https://github.com/Rytass/BPMCore/commit/ebf0337))

### ⚠️  Breaking Changes

- **template:** reject deleting a referenced category  ([#16](https://github.com/Rytass/BPMCore/pull/16))
  `deleteApprovalTemplateCategory` now throws
  `BadRequestException` when templates still reference the category, instead
  of deactivating it and reporting success.
  The old behaviour substituted a different operation for the one requested
  and returned the same entity type either way, so a caller could not tell
  that the delete had not happened — nor that `isActive` had been flipped as
  a side effect it never asked for. Downstream, the category vanished from
  groupings because it was now inactive, with nothing to explain why.
  Deactivation is not lost: `deactivateApprovalTemplateCategory(id)` has
  always existed and is unchanged, so the fallback was never the only way to
  reach that state.
  The designer's category screen already wraps the call in try/catch and
  surfaces the message, and it only closes the confirmation dialog on
  success, so the new error reaches the author without a UI change.
  Reported by a consumer on 0.7.0, who had to re-implement the reference
  check ahead of the call to avoid telling users something had been deleted
  when it had not.
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Claude Opus 5
- Kai-Chieh Yang

## 0.7.0 (2026-08-10)

### 🚀 Features

- **bpm-core:** lint the new SLA and return-behaviour node fields ([f10c0bb](https://github.com/Rytass/BPMCore/commit/f10c0bb))
- **bpm-core:** enforce required return comments ([6cb288f](https://github.com/Rytass/BPMCore/commit/6cb288f))
- **bpm-core:** resolve task SLA due dates through a host business calendar ([3cb9d4d](https://github.com/Rytass/BPMCore/commit/3cb9d4d))

### 🩹 Fixes

- **bpm-core:** stop SLA escalation from walking the whole management chain ([f7e4669](https://github.com/Rytass/BPMCore/commit/f7e4669))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Claude Opus 5 (1M context)

# Changelog

All notable changes to `@rytass/bpm-core-nestjs-module` are documented in this
file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- Form schema parsing now supports additive versioned option-source references
  and structural lint for bindings, dependency cycles, and dynamic defaults.
- Added `FORM_DATA_SOURCE_VALUE_NOT_RESOLVED` so a submitted value that is no
  longer selectable is reported separately from a provider contract breach.
- Added the host-provided versioned DataSource registry contract, guarded
  GraphQL catalog/preview/runtime queries, provider limits, and stable error
  codes for dynamic form options.
- Added server-side dynamic option resolution for submit/resubmit, persisted
  option-label snapshots, optimistic revision protection around resubmit, and
  the reversible `form_data_option_snapshot` migration.
- Resubmit mutations now return the refreshed persisted instance after dynamic
  option resolution and workflow processing, keeping GraphQL JSON accessors in
  sync with the committed form data and option snapshot.
- GraphQL DataSource input DTOs now carry explicit validation metadata so hosts
  using `ValidationPipe({ forbidUnknownValues: true })` can call preview/runtime
  option queries without bypassing input validation.
- Added the read-only `resolveFormFieldOptions` (authenticated) and
  `previewResolveFormFieldOptions` (designer-only) queries returning
  `BPMFormDataSourceResolveResult`. They confirm already-selected values and
  report the ones the source can no longer account for in `unresolvedValues`
  instead of throwing, so a renderer can mark dead options individually. The
  authoritative submit/resubmit resolve is unchanged and stays all-or-nothing.
- Both option results now carry `waitingForFieldKeys`. When a required parameter
  has no value the service returns that field-key list and makes no provider
  call, rather than raising an error the caller cannot act on — the browser
  never receives the descriptor, so it cannot tell a required parameter from an
  optional one on its own.

### Changed

- Binding, descriptor, and provider-result validation moved into one internal
  `form-data-source.validation.ts` shared by the query service and the
  submit-time value resolver. The two former copies had drifted: a non-finite
  number such as `1e999` passed a search and was only rejected at submit.
- Submit-time provider calls are now bounded to 4 concurrent requests, so a form
  with many dynamic fields does not turn a single submit into a burst against
  the host's upstream systems.
- Every browser-controlled DataSource GraphQL input field now carries a
  `@MaxLength` bound and reports an over-long input with the stable
  `FORM_DATA_SOURCE_INVALID_BINDING` code instead of a class-validator sentence
  describing the limits.
- A snapshot whose recorded `revalidationPolicy` is `ALWAYS` is no longer reused
  when its source has left the registry; only non-`ALWAYS` snapshots (including
  older ones written before the field existed) keep the previous reuse
  behaviour.

Releases are managed by [`nx release`](https://nx.dev/recipes/nx-release) with
Conventional Commits — see `nx.json` for the release config.

## 0.6.0 — 2026-08-04

### Added

- **Opt-in org-unit depth filtering for manager resolution.** The
  `ORG_MANAGER` and `ORG_UNIT_MANAGER` approver resolvers now accept an
  optional `preferClosestOrgUnit: boolean` flag. When enabled, the engine
  keeps only the deepest org-unit-level manager rules on the winning
  priority tier — ancestor catch-all rules (e.g. a company-wide fallback)
  no longer join the approver list. Sibling org units at the same depth
  are still preserved so multi-manager steps continue to work. Depth is
  derived from the org unit `path` ltree (segment count).

### Fixed

- **Rolling back to an archived version now honours the registry gate.**
  `rollbackFormDefinitionVersion` republished an archived form without checking
  the host registry, so a version referencing a source the host had dropped
  could become current again.
- **An illegal empty value no longer counts as "cleared".** `''` clears a
  single-select and `[]` clears a multiple one; the mismatched shapes are
  rejected instead of persisting a value the primitive contract forbids.
- **A corrupt instance form snapshot returns a controlled error.** Snapshot
  readers dereferenced field entries, so `fields: [null]` raised a `TypeError`
  out of submit/resubmit; such a snapshot is now rejected as invalid.
- **A `SET_FORM_FIELD` service task no longer leaves a wrong option label.**
  Writing into a DataSource-backed field kept the previous option snapshot, so
  instance history rendered the old label next to the new value. The snapshot
  for that field is now dropped (the raw value is shown instead) and the
  activity log records which field was cleared. The service task runs inside the
  write transaction, so re-resolving through the host provider there would
  breach the ADR's transaction boundary.
- **Clearing a dynamic option now removes its snapshot on resubmit.** A host
  without a registry kept the old label for a field the user had emptied. An
  empty array only clears a `multiple` field; on a single-select it stays an
  illegal value instead of silently dropping the snapshot.
- **A binding-only preview failure now reports `FORM_DATA_SOURCE_INVALID_BINDING`.**
  Binding lint lines stay prose because they quote a host-chosen parameter name,
  so they carried no code and the preview fell back to `INVALID_DESCRIPTOR` —
  telling the designer to contact an administrator about a binding they could
  fix themselves. The code is now derived from the line shape.
- **The preview error code now follows the first lint error.** It was picked by
  scanning the error-code list for a substring match, so the reported code
  depended on enum declaration order and would misfire once one code became a
  substring of another. It is now read only from the code-bearing lint shape
  `<path>.dataSource <CODE>`, so prose such as an unbound parameter whose name
  looks like a code is no longer reported as that code.
- **Publish lint no longer mislabels an unregistered DataSource key.** A key the
  host never registered reported `FORM_DATA_SOURCE_VERSION_MISSING`, telling
  designers to pick another version of a source that no longer exists. It now
  reports `FORM_DATA_SOURCE_MISSING`, matching the runtime query path, and an
  unsupported bounded control is reported once instead of twice.
- **A host without a DataSource registry can no longer publish or submit
  dynamic option fields — but drafts stay editable.** The registry check runs
  only where a published version is produced, so a draft that references an
  unavailable source is still saved verbatim, as the ADR requires. Both the publish lint and the submit/resubmit
  resolution degraded to no-ops when no registry was provided, so a
  DataSource-backed value could reach the database with nothing able to
  validate it. Both paths now fail with `FORM_DATA_SOURCE_MISSING`; static
  forms are unaffected.
- **`initiatorMemberId` is no longer a required GraphQL input.** Submit and
  resubmit inputs demanded a value the resolver always replaced with the
  authenticated member id. The field is now optional and deprecated; the engine
  still requires the server-derived id.
- **Manager resolution priority now respected.**
  `resolveManagerResolutionCandidates` previously returned every active
  resolution regardless of priority. Now it keeps only the top-priority
  tier (matching `OrganizationService.resolveManagerMemberId` which
  already picks `active[0]`), so a low-priority company-wide catch-all
  rule no longer appends its manager to every member's approver list.
- **Top-level `managerMemberId` fallback restored when `customFields` is
  an empty object.** `readManagerMemberIdFromInitiatorSnapshot` previously
  short-circuited to `undefined` as soon as `customFields` was any object
  (including `{}`), preventing the top-level `managerMemberId` fallback
  from ever executing. Now it only takes the `customFields` branch when
  `customFields.managerMemberId` is actually present.

### Changed

- Peer dependency `@rytass/bpm-core-shared` now requires ^0.6.0.
- `readOrgUnitAndAncestorIds` refactored to `readOrgUnitAndAncestors`
  (returns full `OrgUnitEntity[]` instead of just IDs) so callers can
  compute depth maps without duplicate DB queries.

## 0.5.1 — 2026-07-06

### Fixed

- **Broken 0.5.0 tarball.** 0.5.0 was published from the project source root, so
  the npm tarball shipped only TypeScript sources (`src/*.ts`, tsconfig, jest
  config) with no compiled `.js`/`.d.ts`, while `main`/`exports` point at
  `./src/index.js` — downstream installs failed with webpack
  `Module not found` and NestJS `require` errors. 0.5.1 is republished from the
  build output (`dist/libs/bpm-core`), which contains the compiled `.js` +
  `.d.ts` and a `generatePackageJson` manifest.

### Changed

- Configured the `nx-release-publish` target with
  `packageRoot: dist/libs/bpm-core` so `nx release publish` always publishes the
  build artifacts instead of the source root, preventing a recurrence. No API or
  runtime source changes from 0.5.0.

## 0.5.0 — 2026-07-06

### Added

- Optional `searchPaged(searchText, { page, pageSize })` on `BPMMemberResolver`
  (returning `{ items, total }`) and the matching optional `searchMembersPaged`
  on `BPMMemberBaseDirectory`. When a host implements it, BPM delegates
  pagination and total counting to the host's source (e.g. DB `LIMIT/OFFSET` +
  `COUNT`) instead of pulling everything through the ~50-cap member-picker
  `search` and paginating in memory. New exported types `BPMMemberSearchPage`,
  `BPMMemberSearchPageOptions`, and `BPMMemberBaseSearchPage`.

### Changed

- `searchMembers` and `memberCount` (via `IdentityService`) now detect the new
  `searchPaged` capability: present → real paged delegation with an accurate
  total and per-id `member_metadata_cache` backfill of the returned page;
  absent → the pre-0.5.0 `search`-and-slice-in-memory path, unchanged. The
  `search?` contract is clarified as member-picker-only (~50 matches, not
  paginated).
- Peer dependency `@rytass/bpm-core-shared` now requires ^0.5.0.

> Behavior note: hosts that have **not** implemented `searchMembersPaged` still
> see the admin members list (`admin/users`) capped by whatever their `search()`
> returns (~50 rows) with a matching total. Implement `searchMembersPaged` to
> page a larger directory and report the true total.

## 0.4.0 — 2026-07-02

### Added

- `all` option on `listOrgUnits` and the `orgUnits` GraphQL query that bypasses
  pagination and returns the complete list, giving org tree / full-scan
  consumers an explicit entry instead of relying on the implicit
  "omit `pageSize` = return everything" behavior.

### Changed

- Oversized `pageSize` values are now clamped against a named `MAX_PAGE_SIZE`
  constant and a warning is logged, so requests above the cap are clamped
  loudly rather than silently truncated. Existing pagination behavior is
  otherwise unchanged.
- Peer dependency `@rytass/bpm-core-shared` now requires ^0.4.0.

## 0.3.0 — 2026-06-06

### Added

- **Ad-hoc directives** — stage approvers can attach instance-scoped
  directives that never modify the workflow template:
  - `COUNTERSIGN` (臨時會簽): a parallel ad-hoc task joins the next user
    task; the token only advances once every task on that stage is
    approved.
  - `PRE_APPROVAL` (臨時加簽): a blocking ad-hoc task on the current stage
    with configurable rejection behavior (`REJECT_INSTANCE` /
    `RETURN_TO_ORIGIN`).
  - `STAGE_NOTIFY` / `COMPLETION_NOTIFY`: notify members, positions, org
    units, or webhooks when the stage ends (any outcome) or the instance
    reaches a terminal state.
- GraphQL surface: mutations `requestAdhocCountersign`,
  `requestAdhocPreApproval`, `configureAdhocStageNotification`,
  `configureAdhocCompletionNotification`, `cancelAdhocDirective`; query
  `adhocDirectives(instanceId)`. Countersign / pre-approval are gated by
  the node's `allowAddSigner` flag.
- `AdhocDirectiveEntity` (`task_adhoc_directives`) plus ad-hoc columns on
  `tasks`, created by migration `AdhocDirectives0000000017000` (included
  in `BPM_CORE_MIGRATIONS`). Run migrations before serving traffic.
- Notification recipients of ad-hoc directives gain read access to the
  instance they were notified about.
- `NotificationService.createAdhocWorkflowNotifications` for ad-hoc
  directive delivery.

### Changed

- `rejectInstance` now consumes open runtime state (open tokens and tasks,
  including parallel branches and ad-hoc tasks) and supersedes lingering
  actionable notifications, matching the cancel path.

## 0.2.0 — 2026-06-04

### Breaking

- **`forkFormDefinition` is removed** from `FormService` and from the
  GraphQL schema. Form definitions no longer keep a DRAFT version in
  parallel with a published one: before the first publish the single
  draft is updated in place; after publishing, every save publishes a
  brand-new version directly. Callers that previously chained
  `forkFormDefinition` → `updateFormDefinitionDraft` →
  `publishFormDefinitionVersion` should call the new
  `publishFormDefinitionContent` mutation instead.
- **Parallel drafts are archived by migration.** Migration
  `ArchiveParallelFormDrafts0000000016000` marks every DRAFT version
  whose definition already has a published current version as
  `ARCHIVED`. Their content is preserved in the version history but is
  no longer editable.
- **`updateFormDefinitionDraft` is now only valid before the first
  publish.** It still rejects non-DRAFT versions with a 409, and after
  this release a published definition never has a DRAFT version to
  update.

### Added

- **`publishFormDefinitionContent(input, publishedByMemberId?, manager?)`**
  (service + GraphQL mutation + `PublishFormDefinitionContentInput`):
  publishes the given schema/uiSchema as the current version atomically.
  Before the first publish it updates the in-place draft and publishes
  it; afterwards it creates and publishes a brand-new version
  (version + 1). Content identical to the current published version is
  a no-op that returns the current version.
- **`composeApprovalTemplateWithForm`** (service + GraphQL mutation +
  `ComposeApprovalTemplateWithFormInput` / result object): creates or
  updates a form definition and an approval template draft in one
  transaction, optionally publishing both. Published forms bind through
  `publishFormDefinitionContent`; never-published forms keep their
  in-place draft until publish.
- **Notification resolution lifecycle.** Actionable task notifications
  (`TASK_ASSIGNED` / `TASK_TRANSFERRED`) now carry a
  `resolution` (`APPROVED` / `REJECTED` / `RETURNED` / `TRANSFERRED` /
  `SUPERSEDED`) and `resolvedAt`. The workflow engine resolves them on
  task decisions and transfers (`NotificationService.resolveTaskNotifications`),
  and migration `BackfillStaleNotificationResolution0000000015000`
  backfills rows created before the wiring existed.
- **Legacy migration-name reconciliation.**
  `reconcileLegacyMigrationNames(dataSource)` renames stale rows in the
  TypeORM migrations table on boot so renumbered migration classes are
  not re-run against existing databases.
- Migrations `0000000014000-notification-resolution`,
  `0000000015000-backfill-stale-notification-resolution`, and
  `0000000016000-archive-parallel-form-drafts` — `BPM_CORE_MIGRATIONS`
  now lists 17 classes.

### Why a minor

Removes `forkFormDefinition` and retires the parallel-draft model —
breaking under 0.x SemVer conventions (0.1.x → 0.2.0).

## 0.1.10 — 2026-05-28

### Documentation

- **Pattern A response status contract table** added — explicit success
  / auth-fail / validation-fail HTTP status codes for `/auth/login`,
  `/auth/me`, `/auth/logout`. Also notes that `roles` and `permissions`
  must be arrays (not `null`/`undefined`), and shows the
  `projectMemberToApiMember` skeleton mapping `ApiMember.email: string`
  (not `string | null`).
- **"Concrete wiring" snippet** for the recommended same-database
  separate-schema option B: dual `TypeOrmModule.forRootAsync` with
  `name: 'bpm'` so the host's existing connection and BPM's stay
  isolated. Also shows handing `typeormConnectionName: 'bpm'` to
  `BPMRootModule.forRootAsync`.
- **`createBPMMemberBaseResolverProvider<HostMember>` generic** added
  to the README example with a callout about why omitting it causes
  TS to infer `unknown`.
- "Current version" line refreshed to `0.1.10`.

### Why a patch

Documentation only.

## 0.1.9 — 2026-05-28

### Documentation

- **README "Machine-to-machine authentication" section** added under
  Auth Context. Documents three patterns for server-side scripts (org
  seeds, cron workers, integration tests) to authenticate against BPM:
  (1) service member + login flow with cookie-jar fetch (recommended),
  (2) service token header for hosts that issue long-lived JWTs,
  (3) direct cookie injection for testing only.
- **README "Coexisting with a host's existing `<AuthProvider>`"** added
  under Auth Context. Explains that BPM's React provider is a separate
  context safe to nest under a host provider, with three rules of
  thumb (scope to sub-tree, share cookie jar same-origin, don't
  double-wrap `<AuthProvider>` directly).

### Why a patch

Documentation only.

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
