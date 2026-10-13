## 0.15.0 (2026-10-13)

### 🚀 Features

- **forms:** add store-only hidden fields and link display for text fields ([ae38a92](https://github.com/Rytass/BPMCore/commit/ae38a92))
- **workflow-client:** select nodeLabel wherever tasks are selected ([273bd4f](https://github.com/Rytass/BPMCore/commit/273bd4f))
- **workflow-engine:** select submittedByMemberId on the client instance record ([81e7f4d](https://github.com/Rytass/BPMCore/commit/81e7f4d))
- **designer:** pick approvers from a member field and show readable dry-run assignees ([bc9592e](https://github.com/Rytass/BPMCore/commit/bc9592e))
- **forms:** add a member field type ([0fca8d4](https://github.com/Rytass/BPMCore/commit/0fca8d4))

### 🩹 Fixes

- **template-designer:** name a member-field dry-run assignee by its field label ([465fcc3](https://github.com/Rytass/BPMCore/commit/465fcc3))
- **template-designer:** sample a dry-run member field with a placeholder, not the initiator ([b567e41](https://github.com/Rytass/BPMCore/commit/b567e41))
- **template:** refuse a DYNAMIC_FORM resolver on a member field that can be left empty ([b3a3950](https://github.com/Rytass/BPMCore/commit/b3a3950))
- **organization:** default organizationTimeZone to Asia/Taipei ([cc6b908](https://github.com/Rytass/BPMCore/commit/cc6b908))
- **forms:** harden hidden fields and link display after review ([9ce1f82](https://github.com/Rytass/BPMCore/commit/9ce1f82))
- **designer:** say the sent list includes cases submitted on someone's behalf ([bfd928f](https://github.com/Rytass/BPMCore/commit/bfd928f))
- **workflow-engine:** index the submitter column that the sent list now matches ([557f458](https://github.com/Rytass/BPMCore/commit/557f458))
- **workflow-engine:** leave out the refusals of seats the initiator exclusion removes ([959912e](https://github.com/Rytass/BPMCore/commit/959912e))
- **workflow-engine:** harden business key lookup and count its length in characters ([844ce82](https://github.com/Rytass/BPMCore/commit/844ce82))
- **forms:** keep member ids out of case titles and check member references on publish ([2b3c9c0](https://github.com/Rytass/BPMCore/commit/2b3c9c0))

### 🔥 Performance

- **notification:** name the submitter at submit instead of inside the approval transaction ([da64763](https://github.com/Rytass/BPMCore/commit/da64763))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Claude Opus 5.5
- Kai-Chieh Yang

## 0.14.0 (2026-10-12)

### 🚀 Features

- **workflow-engine:** sign manager chains in order and keep the initiator out of re-delegation ([6eaf1e6](https://github.com/Rytass/BPMCore/commit/6eaf1e6))
- **designer:** offer SEQUENTIAL again and show signing order in task views ([ed38d04](https://github.com/Rytass/BPMCore/commit/ed38d04))
- ⚠️  **workflow-engine:** make SEQUENTIAL sign one candidate at a time ([70e9cde](https://github.com/Rytass/BPMCore/commit/70e9cde))
- **designer:** configure initiator exclusion on user task nodes ([b7b51cd](https://github.com/Rytass/BPMCore/commit/b7b51cd))
- **workflow-engine:** let a user task exclude the initiator from its approvers ([a4c6e51](https://github.com/Rytass/BPMCore/commit/a4c6e51))
- **workflow-engine:** add ORG_MANAGER_CHAIN resolver that walks up to a position level ([001af84](https://github.com/Rytass/BPMCore/commit/001af84))

### 🩹 Fixes

- **workflow-engine:** reopen a rejected pre-approval for its requester on sequential tasks ([2cf8004](https://github.com/Rytass/BPMCore/commit/2cf8004))
- **designer:** show the signing order and turn hand-offs in the instance timeline ([7ade44a](https://github.com/Rytass/BPMCore/commit/7ade44a))
- **workflow-engine:** re-delegate on activation, anchor the SLA warning and give consumers a turn signal ([f50c781](https://github.com/Rytass/BPMCore/commit/f50c781))
- **workflow-engine:** filter the initiator before dedupe and keep exclusion nodes completable ([5a6570a](https://github.com/Rytass/BPMCore/commit/5a6570a))
- **workflow-engine:** let ORG_MANAGER_CHAIN climb past unit heads under org-unit rules ([5baa2e6](https://github.com/Rytass/BPMCore/commit/5baa2e6))
- **workflow-engine:** scope the transfer re-point to pre-approvals on the origin node ([70d99d7](https://github.com/Rytass/BPMCore/commit/70d99d7))

### ⚠️  Breaking Changes

- **workflow-engine:** make SEQUENTIAL sign one candidate at a time  ([70e9cde](https://github.com/Rytass/BPMCore/commit/70e9cde))
  the SEQUENTIAL decision policy used to behave exactly like
  PARALLEL_ALL (every candidate got the task at once). It now means what its
  name says: candidates sign one after another, in the order the approver
  resolver returned them.
  - task_candidates gains a nullable `sequence` column (migration
    0000000025000-task-candidate-sequence) and a WAITING status for candidates
    whose turn has not come. Only the first candidate is PENDING, assigned and
    notified; an approval activates the next one (fresh SLA window, a
    TASK_CANDIDATE_ACTIVATED activity log, a new assignment notification).
  - A WAITING candidate who tries to decide gets a ConflictException.
  - Reject, return and instance cancellation close the WAITING candidates too.
  - Transferring (including SLA escalation) keeps the SEQUENTIAL policy and
    carries the remaining WAITING candidates to the replacement task.
  - TASK_CREATED lists only the active candidate in candidateMemberIds and adds
    sequentialCandidateMemberIds with the full order.
  - Candidates are read ordered by sequence, unordered ones last.
  SEQUENTIAL tasks created before this change keep their old behaviour: their
  candidates are all PENDING with a NULL sequence and nothing is backfilled.
  PARALLEL_*, QUORUM, ad-hoc tasks and dry run are unchanged.
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01C3u1QC5Uo4tZvyTaJE6Gap

### ❤️ Thank You

- Claude Opus 5.5
- Kai-Chieh Yang

## 0.13.5 (2026-10-12)

### 🩹 Fixes

- **deps:** patch critical advisories in next, handlebars, proxy-addr and shell-quote ([c58a51a](https://github.com/Rytass/BPMCore/commit/c58a51a))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Claude Opus 5

## 0.13.4 (2026-09-17)

### 🚀 Features

- **admin:** add the webhook endpoints page ([ac03c59](https://github.com/Rytass/BPMCore/commit/ac03c59))
- **client:** add webhook endpoint administration API ([0fa9c2a](https://github.com/Rytass/BPMCore/commit/0fa9c2a))
- **workflow-webhook:** manage notify webhook endpoints in the database ([63e2f95](https://github.com/Rytass/BPMCore/commit/63e2f95))
- **client:** add the webhook endpoint catalog query ([9e2c927](https://github.com/Rytass/BPMCore/commit/9e2c927))
- **instance-detail:** show webhook deliveries to administrators ([4e1e3c1](https://github.com/Rytass/BPMCore/commit/4e1e3c1))
- **client:** add webhook delivery listing and retry ([89387ae](https://github.com/Rytass/BPMCore/commit/89387ae))
- **workflow-webhook:** let administrators inspect and retry deliveries ([4a6128b](https://github.com/Rytass/BPMCore/commit/4a6128b))
- **workflow-webhook:** deliver notify webhooks through a transactional outbox ([cbb277f](https://github.com/Rytass/BPMCore/commit/cbb277f))
- **workflow-webhook:** add the endpoint registry, catalog and allowlist ([82afe97](https://github.com/Rytass/BPMCore/commit/82afe97))
- **workflow:** add the notify webhook contract to the shared lib ([e240632](https://github.com/Rytass/BPMCore/commit/e240632))
- **bpm:** make every BPMRootModule option optional and async-loadable ([0966edb](https://github.com/Rytass/BPMCore/commit/0966edb))

### 🩹 Fixes

- **client:** tolerate hosts that omit the webhook deliveries field ([a0c00f1](https://github.com/Rytass/BPMCore/commit/a0c00f1))
- **workflow-webhook:** harden the P1 catalog after independent review ([0ea9790](https://github.com/Rytass/BPMCore/commit/0ea9790))
- **workflow:** let the engine pick its service task dispatcher ([21bcde4](https://github.com/Rytass/BPMCore/commit/21bcde4))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Claude Opus 5

## 0.13.3 (2026-09-04)

This was a version bump only for bpm-core-client to align it with other projects, there were no code changes.

## 0.13.2 (2026-09-04)

### 🩹 Fixes

- **organization:** stop a deleted org unit from burning its code forever ([0f6897f](https://github.com/Rytass/BPMCore/commit/0f6897f))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Claude Opus 5

## 0.13.1 (2026-09-04)

### 🩹 Fixes

- **release:** build before publishing, and follow the 0.x bump convention ([a41932a](https://github.com/Rytass/BPMCore/commit/a41932a))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Claude Opus 5

## 0.13.0 (2026-09-03)

### 🚀 Features

- **client:** add deletePosition ([2375fb2](https://github.com/Rytass/BPMCore/commit/2375fb2))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Claude Opus 5

## 0.12.0 (2026-08-27)

### 🚀 Features

- **form:** wire cell-level DataSources through the client and renderer ([c7561ad](https://github.com/Rytass/BPMCore/commit/c7561ad))
- **form:** resolve table column DataSources per cell ([ca40a4c](https://github.com/Rytass/BPMCore/commit/ca40a4c))
- **form:** add table column factories and row-scoped binding rename ([0c8c07d](https://github.com/Rytass/BPMCore/commit/0c8c07d))
- **form:** validate and seed table values in the renderer helpers ([5c7edab](https://github.com/Rytass/BPMCore/commit/5c7edab))
- **workflow:** keep tables out of case titles and summarise them by row count ([b5453c8](https://github.com/Rytass/BPMCore/commit/b5453c8))
- **form:** add table field definitions to the shared contract ([5f97165](https://github.com/Rytass/BPMCore/commit/5f97165))

### 🩹 Fixes

- **form:** read a required cell as an own property in the renderer validator ([f20a03f](https://github.com/Rytass/BPMCore/commit/f20a03f))
- **form:** validate and submit the values the renderer actually shows ([0dda76a](https://github.com/Rytass/BPMCore/commit/0dda76a))
- **condition:** keep table values from deciding form conditions ([894ef00](https://github.com/Rytass/BPMCore/commit/894ef00))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Claude Opus 5 (1M context)

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
