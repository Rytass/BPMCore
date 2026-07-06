# Changelog

All notable changes to `@rytass/bpm-core-client` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases are managed by [`nx release`](https://nx.dev/recipes/nx-release) with
Conventional Commits — see `nx.json` for the release config.

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
