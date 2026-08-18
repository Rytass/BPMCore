## 0.11.0 (2026-08-18)

### 🚀 Features

- **notification:** bound delivery dispatch with a timeout ([d8115f0](https://github.com/Rytass/BPMCore/commit/d8115f0))

### 🩹 Fixes

- **notification:** move nodemailer to ^9.0.1 ([e094738](https://github.com/Rytass/BPMCore/commit/e094738))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Claude Opus 5

## 0.10.0 (2026-08-18)

### 🚀 Features

- **form-data-source:** add read-only resolve queries and dependency-wait signals ([e8d9b78](https://github.com/Rytass/BPMCore/commit/e8d9b78))
- **template:** let hosts observe changes and refuse deactivated publishes ([3882dc2](https://github.com/Rytass/BPMCore/commit/3882dc2))
- **notification:** honour recipient preferences instead of dropping rows ([576b8c4](https://github.com/Rytass/BPMCore/commit/576b8c4))

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

This was a version bump only for bpm-core-client to align it with other projects, there were no code changes.

# Changelog

All notable changes to `@rytass/bpm-core-client` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Changed

- Form helpers now recognize `autocomplete` and distinguish static option
  fields from DataSource-backed option fields without changing primitive form
  values.
- Added typed catalog, designer preview, and authenticated runtime wrappers
  for the host-registered form DataSource GraphQL boundary.
- Approval instance records now expose parsed and raw dynamic option snapshots
  returned by the server.
- Added immutable DataSource option merge, selected hydration, unresolved-value,
  dependency, and value-signature helpers plus the `FormDataSourceFieldStatus`
  union used by the React renderer.
- Added immutable builder helpers for DataSource capability filtering, parameter
  type matching, field/constant bindings, field-key rename propagation, and
  dependent-field discovery.
- Added `FORM_DATA_SOURCE_ERROR_CODES`, `readFormDataSourceErrorCode()`,
  `readFormDataSourceErrorMessage()`, and `readFormSchemaLintMessage()` so
  consumers can turn the backend's stable DataSource codes into display copy
  instead of showing the raw code. A code this client does not map yet still
  yields readable copy rather than leaking the code to the screen. Detection is
  token-bounded, and a publish failure that joins several lint lines has every
  code mapped, not just the first. Lint lines that quote a host-chosen parameter
  or descriptor name are left verbatim, so a parameter named like an error code
  is not rewritten as that error's copy.

- Added `resolveFormFieldOptions()` and `previewResolveFormFieldOptions()` plus
  `FormDataSourceResolveResultRecord`, so a caller can ask the host whether
  already-selected values are still valid. `unresolvedValues` names the ones the
  source can no longer account for; this is the authority behind the renderer's
  `INVALID` status, which a merged option snapshot would otherwise paper over.
- `FormDataSourceOptionsResultRecord` and the resolve result both expose
  `waitingForFieldKeys`, the authoritative answer to whether a control can be
  queried yet. `readMissingFormDataSourceDependencies()` stays available but is
  advisory only — it cannot tell a required parameter from an optional one, so
  runtime callers must not block a control on it.
- Added `readFormDataSourceSelectedValues()` for reading the selected option
  values carried by a field value.
- `requestGraphQl()` and every DataSource query accept an optional
  `AbortSignal`, so a newer search or resolve supersedes an in-flight one before
  it reaches the host.

### Fixed

- Explicit `NEXT_PUBLIC_API_URL` base URLs now resolve to `/graphql` before
  browser requests, matching the documented API-base configuration contract.

Releases are managed by [`nx release`](https://nx.dev/recipes/nx-release) with
Conventional Commits — see `nx.json` for the release config.

## 0.6.0 — 2026-08-04

### Fixed

- **Date picker timezone drift.** `parseDatePickerValue` now detects
  timezone-qualified ISO strings (`Z` or `±HH:MM` suffix) and delegates
  to the runtime's offset-aware `new Date()` instead of splitting on `T`
  and rebuilding from UTC calendar parts as local time. Users east of UTC
  (e.g. `Asia/Taipei`) who pick the 20th on the calendar no longer get
  the 19th stored. Zone-less inputs (`'2026-08-20'`,
  `'2026-08-20T09:30'`) are still treated as local time, preserving the
  existing manual-parsing path.

### Changed

- Peer dependency `@rytass/bpm-core-shared` now requires ^0.6.0.

## 0.5.1 — 2026-07-06

### Fixed

- **Broken 0.5.0 tarball.** 0.5.0 was published from the project source root, so
  the npm tarball shipped only TypeScript sources with no compiled `.js`/`.d.ts`
  while `main`/`exports` point at `./src/index.js`. 0.5.1 is republished from the
  finalized build output (`dist/libs/bpm-core-client`). Configured
  `nx-release-publish` with `packageRoot: dist/libs/bpm-core-client`. No source
  changes.

## 0.5.0 — 2026-07-06

No source changes. Version aligned with `@rytass/bpm-core-shared` and
`@rytass/bpm-core-nestjs-module` 0.5.0 (fixed release group).

### Changed

- Peer dependency `@rytass/bpm-core-shared` now requires ^0.5.0.

## 0.4.0 — 2026-07-02

### Fixed

- `readOrganizationDashboard` now requests the full org unit list with
  `orgUnits(all: true)` so id->name mapping, dropdowns, and the org tree keep
  working for organizations with more than 100 units, instead of depending on
  the implicit unpaginated behavior.

### Changed

- Peer dependency `@rytass/bpm-core-shared` now requires ^0.4.0.

## 0.3.0 — 2026-06-06

### Added

- Ad-hoc directive workflow API (instance-scoped, never alters the
  template): `requestAdhocCountersign`, `requestAdhocPreApproval`,
  `configureAdhocStageNotification`, `configureAdhocCompletionNotification`,
  `cancelAdhocDirective`, and `listAdhocDirectives`, plus the
  `AdhocDirectiveRecord` / `AdhocTargetOptions` types and related enums.
  See the README "Ad-hoc Directives" section.
- `TaskRecord` now carries `isAdhoc`, `adhocType`, `adhocOriginTaskId`, and
  `adhocDirectiveId` across every task query.

### Fixed

- `listAdhocDirectives` tolerates hosts (and test mocks) whose GraphQL layer
  does not answer the `adhocDirectives` query yet by returning an empty list.

## 0.2.0 — 2026-06-04

### Breaking

- **`forkFormDefinition` is removed** from
  `@rytass/bpm-core-client/form`, mirroring its removal from the
  backend schema. Replace
  `forkFormDefinition` → `updateFormDefinitionDraft` →
  `publishFormDefinitionVersion` chains with a single
  `publishFormDefinitionContent(formDefinitionId, schema, uiSchema)`
  call.

### Added

- **`publishFormDefinitionContent()`** in
  `@rytass/bpm-core-client/form`: atomic save-and-publish of form
  content. In-place draft before the first publish, brand-new published
  version afterwards, no-op for identical content.
- **`composeApprovalTemplateWithForm()`** and the workflow dry-run
  operations in `@rytass/bpm-core-client/template`: typed client
  operations for the unified form + flow compose mutation.
- **`NotificationResolution`** type and resolution fields on
  notification records in `@rytass/bpm-core-client/workflow`.

### Why a minor

Removes the `forkFormDefinition` export — breaking under 0.x SemVer
conventions (0.1.x → 0.2.0).

## 0.1.10 — 2026-05-28

### Documentation

- README "Current version" line refreshed to `0.1.10`.

### Why a patch

No source change.

## 0.1.9 — 2026-05-28

### Fixed

- **`OrgUnitType` and `ManagerResolutionScopeType` are now re-exports
  from `@rytass/bpm-core-shared`.** Previous versions shipped two
  divergent local definitions: the shared package declared
  `'COMPANY' | 'DIVISION' | 'DEPARTMENT' | 'TEAM'` (UPPERCASE only,
  matching the GraphQL wire) while this package declared the union of
  both cases. Consumers importing the type from different subpaths
  received different unions — silent at compile time, surprising at
  review time. Both subpaths now refer to the single source of truth.

### Why a patch

Type-level realignment, no runtime behavior change. Consumers using
the UPPERCASE literals (the working path) see no difference; consumers
relying on lowercase (the broken path that failed at GraphQL anyway)
were already getting runtime errors and need to migrate.

## 0.1.8 — 2026-05-28

### Documentation

- README "Organization Mirror Pattern" updated to match the
  `@rytass/bpm-core-nestjs-module@0.1.8` README's clarification that
  `metadataJson` is write-only — records returned by
  `readOrganizationDashboard` don't surface metadata; reconcile by
  `code` instead.

### Why a patch

No source change.

## 0.1.7 — 2026-05-28

### Documentation

- README "Current version" line refreshed to `0.1.7`.
- Org example continues to compile against the updated `OrgUnitType`
  (UPPERCASE) — see `@rytass/bpm-core-shared@0.1.7` CHANGELOG for the
  type-level change.

### Why a patch

No source change. Lockstep bump.

## 0.1.6 — 2026-05-28

### Added

- **`configureBPMClient({ baseUrl, authBaseUrl, fetch, headers })`**.
  Server-side Node scripts (cron workers, org seeds, integration tests)
  can now override the GraphQL endpoint, REST auth base URL, fetch
  implementation, and default request headers programmatically without
  relying on `NEXT_PUBLIC_API_URL` environment resolution. Both the
  `requestGraphQl` GraphQL transport and the REST auth client honor the
  override. Browser consumers under Next.js typically still rely on
  `NEXT_PUBLIC_API_URL` and do not need to call this.

  ```ts
  import { configureBPMClient } from '@rytass/bpm-core-client';

  configureBPMClient({
    baseUrl: 'https://api.shuttle.example.com',
    headers: { 'X-Service-Token': process.env.BPM_SYNC_TOKEN ?? '' },
  });
  ```

### Documentation

- README "Organization Mirror Pattern" rewritten with the correct
  flat-input API shape (`updateOrgUnit({ id, code, name, type,
  parentId, metadataJson })`, not the `{ id, input: {...} }` form the
  0.1.5 example incorrectly showed). Adds a "Server-side base URL
  override" section pointing at `configureBPMClient`.

### Why a patch

`configureBPMClient` is purely additive. Existing callers see no
change to behavior unless they call the new API.

## 0.1.5 — 2026-05-28

### Documentation

- **README "Organization mirror pattern" section.** Condensed pointer to
  the full pattern in `@rytass/bpm-core-nestjs-module`'s README plus a
  client-side worked example using `createOrgUnit`, `updateOrgUnit`,
  `deleteOrgUnit`, `commitOrgUnitTreeDraft`, `createPosition`,
  `createMembership`, `createManagerResolution`. Clarifies that BPM owns
  the org graph and host applications mirror their existing org data in
  rather than expose a resolver (in contrast to the member-resolver
  pattern).

### Why a patch

No type or runtime change. README only.

## 0.1.4 — 2026-05-27

No source changes. Bumped in lockstep with
`@rytass/bpm-core-nestjs-module@0.1.4` (re-publish after the 0.1.3
backend tarball shipped only `.ts` source — see that package's CHANGELOG).

## 0.1.3 — 2026-05-27 (deprecated on npm)

Lockstep bump alongside the broken 0.1.3 backend release. Avoid;
upgrade directly to 0.1.4 or newer.

## 0.1.2 — 2026-05-27

No source changes. Bumped in lockstep with
`@rytass/bpm-core-nestjs-module@0.1.2` (see its CHANGELOG for the
migration class-name fix).

## 0.1.1 — 2026-05-27

No source changes. Version bumped in lockstep with
`@rytass/bpm-core-nestjs-module@0.1.1` so the fixed-versioning release
group stays aligned (see `nx.json` `release.projectsRelationship`).

## 0.1.0 — Unreleased

### Added

- Initial published surface extracted from `apps/client` of the BPMCore
  monorepo:
  - Root: `requestGraphQl`, endpoint resolvers, REST auth client (`loginApi`,
    `logoutApi`, `readApiCurrentMember`, `listApiTestMembers`), member
    directory queries (`resolveMembers`, `searchMembers`,
    `listMemberDirectoryPage`).
  - `/organization`: org unit / position / membership / manager resolution
    queries and mutations.
  - `/form`: form definition CRUD, version management, schema rendering
    helpers.
  - `/template`: approval template CRUD, category management, version
    publish / rollback.
  - `/workflow`: instance / task / notification / attachment / signature
    operations.
- Endpoint defaults: `http://localhost:17603/graphql` on local hostnames,
  same-origin `/graphql` on deployed hostnames, plus root-level
  `/auth/*` (no `/api` prefix). Overridable through `NEXT_PUBLIC_API_URL`
  and `NEXT_PUBLIC_API_AUTH_URL`.

### Notes

- `@rytass/bpm-core-shared` is a `peerDependency` (`^0.1.0`).
- The package ships without `"type"` at source level so Next.js webpack
  resolving the path alias to TypeScript source does not flag CJS / ESM
  conflicts; the publish pipeline injects `"type": "commonjs"` into the
  tarball's `package.json`.
