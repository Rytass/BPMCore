## 0.17.5 (2026-10-20)

### 🚀 Features

- **workflow-engine:** record the write order of activity logs ([d3a946a](https://github.com/Rytass/BPMCore/commit/d3a946a))

### 🩹 Fixes

- **organization:** open only the designer's three organization reads ([28b5146](https://github.com/Rytass/BPMCore/commit/28b5146))
- **workflow-engine:** read activity logs in write order ([4b9865f](https://github.com/Rytass/BPMCore/commit/4b9865f))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Kai-Chieh Yang

## 0.17.4 (2026-10-19)

### 🚀 Features

- **form:** translate DataSource error copy per language ([787e7a3](https://github.com/Rytass/BPMCore/commit/787e7a3))

### 🩹 Fixes

- **shared:** compile multiple-selection conditions with list semantics ([c9c7782](https://github.com/Rytass/BPMCore/commit/c9c7782))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Kai-Chieh Yang

## 0.17.3 (2026-10-19)

### 🚀 Features

- **react:** add a BPM message language provider ([355b15c](https://github.com/Rytass/BPMCore/commit/355b15c))
- **template:** translate publish lint lines per language ([60fa7bc](https://github.com/Rytass/BPMCore/commit/60fa7bc))
- **client:** translate structural publish-lint lines into designer copy ([490339c](https://github.com/Rytass/BPMCore/commit/490339c))

### 🩹 Fixes

- **client:** cover blank node labels and never throw while translating lint ([0a8b3af](https://github.com/Rytass/BPMCore/commit/0a8b3af))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Kai-Chieh Yang

## 0.17.2 (2026-10-18)

### 🚀 Features

- **client:** add notification sync wrappers ([c89d759](https://github.com/Rytass/BPMCore/commit/c89d759))
- **notification:** page and sync notifications without rescanning ([f03f981](https://github.com/Rytass/BPMCore/commit/f03f981))

### ❤️ Thank You

- Chia Yu Pai @fantasywind

## 0.17.1 (2026-10-16)

### 🩹 Fixes

- **react:** give the require condition CommonJS declarations ([ab0121b](https://github.com/Rytass/BPMCore/commit/ab0121b))

### ❤️ Thank You

- Chia Yu Pai @fantasywind

## 0.17.0 (2026-10-15)

### 🚀 Features

- ⚠️  **workflow-engine:** end SLA-terminated instances as EXPIRED ([7dcca4e](https://github.com/Rytass/BPMCore/commit/7dcca4e))
- **template:** allow lastDecision in edge conditions ([e8b4788](https://github.com/Rytass/BPMCore/commit/e8b4788))
- **workflow-engine:** add administrator in-place task reassignment ([02ce920](https://github.com/Rytass/BPMCore/commit/02ce920))
- **toolset:** accept POSITION fallbacks in the assistant toolset ([7d0ddff](https://github.com/Rytass/BPMCore/commit/7d0ddff))
- **shared:** add POSITION approver fallback type ([2744b99](https://github.com/Rytass/BPMCore/commit/2744b99))
- ⚠️  **organization:** retire org units into a successor unit ([514e0b2](https://github.com/Rytass/BPMCore/commit/514e0b2))

### 🩹 Fixes

- **migrations:** check pg_trgm with the other required extensions ([30a1e58](https://github.com/Rytass/BPMCore/commit/30a1e58))
- **template:** check CEL roots per call site on publish ([868d236](https://github.com/Rytass/BPMCore/commit/868d236))
- ⚠️  **delegation:** order rules by priority, higher first ([96cca55](https://github.com/Rytass/BPMCore/commit/96cca55))
- **toolset:** read manager fallbacks and keep them across rewrites ([099b72f](https://github.com/Rytass/BPMCore/commit/099b72f))

### ⚠️  Breaking Changes

- **workflow-engine:** end SLA-terminated instances as EXPIRED  ([7dcca4e](https://github.com/Rytass/BPMCore/commit/7dcca4e))
  an instance ended by SLA `TERMINATE_INSTANCE` is now
  `EXPIRED` instead of `CANCELLED`, and its activity log is
  `INSTANCE_EXPIRED` with a null actor instead of `INSTANCE_CANCELLED` in
  the initiator's name. Instances terminated before this change stay
  CANCELLED. A host implementing `BPMWorkflowEngineService` itself must add
  `expireApprovalInstance`.
- **delegation:** order rules by priority, higher first  ([96cca55](https://github.com/Rytass/BPMCore/commit/96cca55))
  when several active delegation rules of one principal
  match a task, the rule with the highest priority now applies instead of
  the oldest. No data migration is needed: priority had no effect before,
  but principals with overlapping rules may now be delegated differently,
  so review their priorities.
- **organization:** retire org units into a successor unit  ([514e0b2](https://github.com/Rytass/BPMCore/commit/514e0b2))
  deleteOrgUnit now also refuses a unit that has no open
  memberships but still has an open ORG_UNIT-scoped manager rule; it used to
  retire it and leave the rule silently dormant. Pass transferToOrgUnitId (or
  end the rule first) to retire such a unit. The refusal message keeps its
  leading "Org unit with memberships cannot be deleted" sentence.

### ❤️ Thank You

- Chia Yu Pai @fantasywind

## 0.16.2 (2026-10-14)

### 🚀 Features

- **react:** support react-pdf 11 and pdfjs-dist 6 in the PDF preview ([ab7f3ca](https://github.com/Rytass/BPMCore/commit/ab7f3ca))

### ❤️ Thank You

- Chia Yu Pai @fantasywind

## 0.16.0 (2026-10-13)

### 🚀 Features

- ⚠️  **attachment:** boot without attachment settings ([808bc65](https://github.com/Rytass/BPMCore/commit/808bc65))

### ⚠️  Breaking Changes

- **attachment:** boot without attachment settings  ([808bc65](https://github.com/Rytass/BPMCore/commit/808bc65))
  BPMResolvedAttachmentOptions.publicBaseUrl is
  string | null, DEFAULT_BPM_ATTACHMENT_OPTIONS no longer carries a
  signedUrlSecret, and attachmentAllowInsecureSignedUrlSecret is
  deprecated and ignored. A host running more than one API replica must
  set a shared attachmentSignedUrlSecret, since a generated one only
  verifies on the process that signed the URL.
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Claude Opus 5.5

## 0.15.0 (2026-10-13)

### ⚠️  Breaking Changes

- **workflow-engine / organization:** the engine now reads "today" in the organization time zone (`organizationTimeZone`, default `Asia/Taipei`) instead of UTC. For a membership or manager rule whose `effectiveFrom` / `effectiveTo` is today, approver resolution applies or retires it from local midnight — up to eight hours earlier than before in UTC+8. A host whose organization dates are kept in UTC sets `organizationTimeZone: 'UTC'` before upgrading. Running instances keep their tasks. ([d6e43f3](https://github.com/Rytass/BPMCore/commit/d6e43f3); this note was missing from the generated changelog because the footer sits on a `docs:` commit)
- **template:** publishing now refuses a `DYNAMIC_FORM` resolver whose member field can be left empty — the field must be `required`, not `hidden`, and have no `visibleWhen`. Drafts still save; versions already published are not re-validated. ([b3a3950](https://github.com/Rytass/BPMCore/commit/b3a3950))

### 🗄️ Upgrade

- New migrations add nullable columns and indexes only; no data is dropped. Hosts run with `migrationsRun: false`, so **run the migrations before deploying 0.15.0**.

### 🚀 Features

- **forms:** add store-only hidden fields and link display for text fields ([ae38a92](https://github.com/Rytass/BPMCore/commit/ae38a92))
- **designer:** pick approvers from a member field and show readable dry-run assignees ([bc9592e](https://github.com/Rytass/BPMCore/commit/bc9592e))
- **forms:** add a member field type ([0fca8d4](https://github.com/Rytass/BPMCore/commit/0fca8d4))

### 🩹 Fixes

- **template-designer:** name a member-field dry-run assignee by its field label ([465fcc3](https://github.com/Rytass/BPMCore/commit/465fcc3))
- **template-designer:** sample a dry-run member field with a placeholder, not the initiator ([b567e41](https://github.com/Rytass/BPMCore/commit/b567e41))
- **template:** refuse a DYNAMIC_FORM resolver on a member field that can be left empty ([b3a3950](https://github.com/Rytass/BPMCore/commit/b3a3950))
- **shared:** freeze the default manager resolver every new node shares ([281aeb2](https://github.com/Rytass/BPMCore/commit/281aeb2))
- **organization:** default organizationTimeZone to Asia/Taipei ([cc6b908](https://github.com/Rytass/BPMCore/commit/cc6b908))
- **forms:** harden hidden fields and link display after review ([9ce1f82](https://github.com/Rytass/BPMCore/commit/9ce1f82))
- **workflow-engine:** index the submitter column that the sent list now matches ([557f458](https://github.com/Rytass/BPMCore/commit/557f458))
- **workflow-engine:** leave out the refusals of seats the initiator exclusion removes ([959912e](https://github.com/Rytass/BPMCore/commit/959912e))
- **workflow-engine:** harden business key lookup and count its length in characters ([844ce82](https://github.com/Rytass/BPMCore/commit/844ce82))
- **forms:** keep member ids out of case titles and check member references on publish ([2b3c9c0](https://github.com/Rytass/BPMCore/commit/2b3c9c0))
- **shared:** default new nodes to the initiator's manager instead of a placeholder member id ([e2aed61](https://github.com/Rytass/BPMCore/commit/e2aed61))

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
- **designer:** configure the ORG_MANAGER_CHAIN resolver in the template designer ([ab64fe4](https://github.com/Rytass/BPMCore/commit/ab64fe4))
- **workflow-engine:** add ORG_MANAGER_CHAIN resolver that walks up to a position level ([001af84](https://github.com/Rytass/BPMCore/commit/001af84))

### 🩹 Fixes

- **workflow-engine:** reopen a rejected pre-approval for its requester on sequential tasks ([2cf8004](https://github.com/Rytass/BPMCore/commit/2cf8004))
- **designer:** show the signing order and turn hand-offs in the instance timeline ([7ade44a](https://github.com/Rytass/BPMCore/commit/7ade44a))
- **workflow-engine:** re-delegate on activation, anchor the SLA warning and give consumers a turn signal ([f50c781](https://github.com/Rytass/BPMCore/commit/f50c781))
- **toolset:** show initiator exclusion in node summaries ([5ea8ea5](https://github.com/Rytass/BPMCore/commit/5ea8ea5))
- **workflow-engine:** filter the initiator before dedupe and keep exclusion nodes completable ([5a6570a](https://github.com/Rytass/BPMCore/commit/5a6570a))
- **designer:** explain the chain policy switch and keep the chain fallback in the toolset ([743df14](https://github.com/Rytass/BPMCore/commit/743df14))
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

- **workflow-webhook:** harden the P1 catalog after independent review ([0ea9790](https://github.com/Rytass/BPMCore/commit/0ea9790))
- **workflow:** let the engine pick its service task dispatcher ([21bcde4](https://github.com/Rytass/BPMCore/commit/21bcde4))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Claude Opus 5

## 0.13.3 (2026-09-04)

This was a version bump only for shared to align it with other projects, there were no code changes.

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

This was a version bump only for shared to align it with other projects, there were no code changes.

## 0.12.0 (2026-08-27)

### 🚀 Features

- **form:** wire cell-level DataSources through the client and renderer ([c7561ad](https://github.com/Rytass/BPMCore/commit/c7561ad))
- **form:** resolve table column DataSources per cell ([ca40a4c](https://github.com/Rytass/BPMCore/commit/ca40a4c))
- **form:** add table column factories and row-scoped binding rename ([0c8c07d](https://github.com/Rytass/BPMCore/commit/0c8c07d))
- **form:** validate and seed table values in the renderer helpers ([5c7edab](https://github.com/Rytass/BPMCore/commit/5c7edab))
- **condition:** compile table emptiness from the row count ([624c96d](https://github.com/Rytass/BPMCore/commit/624c96d))
- **form:** add table field definitions to the shared contract ([5f97165](https://github.com/Rytass/BPMCore/commit/5f97165))

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
- **shared:** add a command for the user task decision policy ([9d719bb](https://github.com/Rytass/BPMCore/commit/9d719bb))

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

### 🚀 Features

- **shared:** add business-day SLA and required return comment contracts ([584acd7](https://github.com/Rytass/BPMCore/commit/584acd7))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Claude Opus 5 (1M context)

# Changelog

All notable changes to `@rytass/bpm-core-shared` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- Added versioned form option-source, direct binding, selection-mode, and
  persisted label-snapshot contracts.
- Added `autocomplete` fields plus pure option-field guards and legacy schema
  normalization.
- `FormDataSourceValueSnapshot` now carries an optional `revalidationPolicy`,
  recording the policy the source declared when the snapshot was written. Once a
  source leaves the host registry its descriptor is gone, so without this record
  there is no way to tell whether reusing the snapshot would quietly skip an
  `ALWAYS` revalidation. The field is optional so snapshots persisted before it
  existed keep loading.

Releases are managed by [`nx release`](https://nx.dev/recipes/nx-release) with
Conventional Commits — see `nx.json` for the release config.

## 0.6.0 — 2026-08-04

### Added

- **`preferClosestOrgUnit` optional flag** on the `ORG_MANAGER` and
  `ORG_UNIT_MANAGER` variants of `ApproverResolver`. When enabled, the
  workflow engine resolves only the deepest org-unit-level manager rules
  on the winning priority tier, so ancestor-level catch-all rules do not
  dilute the approver list. Defaults to `false` (unchanged behavior).
  `parseApproverResolver` in `workflow-toolset.ts` parses the new field.

### Why a minor

New optional type field — backward compatible, additive.

## 0.5.1 — 2026-07-06

### Fixed

- **Broken 0.5.0 tarball.** 0.5.0 was published from the project source root, so
  the npm tarball shipped only TypeScript sources with no compiled `.js`/`.d.ts`
  while `main`/`exports` point at `./src/index.js`. 0.5.1 is republished from the
  build output (`dist/libs/shared`). Configured `nx-release-publish` with
  `packageRoot: dist/libs/shared`. No source changes.

## 0.5.0 — 2026-07-06

No source changes. Version aligned with `@rytass/bpm-core-client` and
`@rytass/bpm-core-nestjs-module` 0.5.0 (fixed release group). The new
`BPMMemberSearchPage` paged-search types added in that release live in
`@rytass/bpm-core-nestjs-module`, not here.

## 0.4.0 — 2026-07-02

No source changes. Version aligned with `@rytass/bpm-core-client` and
`@rytass/bpm-core-nestjs-module` 0.4.0 (fixed release group).

## 0.3.0 — 2026-06-06

No source changes. Version aligned with `@rytass/bpm-core-client` and
`@rytass/bpm-core-nestjs-module` 0.3.0 (fixed release group).

## 0.2.0 — 2026-06-04

No source change. Lockstep bump with `@rytass/bpm-core-nestjs-module`
and `@rytass/bpm-core-client` 0.2.0.

## 0.1.10 — 2026-05-28

No source change. Lockstep bump.

## 0.1.9 — 2026-05-28

No source change. Lockstep bump alongside
`@rytass/bpm-core-nestjs-module@0.1.9` (machine-to-machine auth +
nested AuthProvider docs) and `@rytass/bpm-core-client@0.1.9`
(`OrgUnitType` is now a re-export from this package, not a separate
definition — see that CHANGELOG).

## 0.1.8 — 2026-05-28

No source change. Lockstep bump alongside
`@rytass/bpm-core-nestjs-module@0.1.8` (README drift fixes for Casbin
example, position signatures, and metadataJson write-only clarification).

## 0.1.7 — 2026-05-28

### ⚠️ Type-level breaking (consumers writing literal values)

- **`OrgUnitType` literal case corrected**: was `'company' | 'division'
  | 'department' | 'team'` (lowercase, matched the database row values
  but **not** the GraphQL SDL); now `'COMPANY' | 'DIVISION' |
  'DEPARTMENT' | 'TEAM'` (UPPERCASE, matches what the GraphQL wire
  actually carries on every read and every write).

  Consumers calling `createOrgUnit({ type: 'company' })` against the
  published `@rytass/bpm-core-client@0.1.6` or earlier received a
  GraphQL enum-coercion error at runtime — the lowercase form was
  rejected by the BPM server. The TS type was misleading. This release
  realigns the type with the wire reality.

  Migration: update any literal `'company'` / `'division'` /
  `'department'` / `'team'` passed to `createOrgUnit` / `updateOrgUnit`
  / `readOrganizationDashboard` `orgUnitType` filter to the UPPERCASE
  form. JSDoc on the type explains the casing.

### Documentation

- JSDoc added to `OrgUnitType` explaining the lowercase database value
  vs UPPERCASE wire format asymmetry.

### Why a patch (despite the rename)

The lowercase form did not work in practice — any consumer who got
past `tsc` failed at runtime against the GraphQL server. Calling this a
patch reflects "fixing a documented contract" rather than "changing
working behavior".

## 0.1.6 — 2026-05-28

No source changes. Lockstep bump alongside
`@rytass/bpm-core-nestjs-module@0.1.6` (new `MemberNotFoundException`
export) and `@rytass/bpm-core-client@0.1.6` (new `configureBPMClient`).

## 0.1.5 — 2026-05-28

### Documentation

- **`MemberMetadata.customFields` JSDoc.** Documented as opaque
  host-shaped JSON: BPM stores the object verbatim, serializes it back
  to GraphQL clients via `MemberProfile.customFieldsJson`, and never
  introspects keys. Hosts populate the field via the
  `options.readCustomFields?.(member)` hook in
  `createBPMMemberBaseResolverProvider`. This was previously implied by
  the source but undocumented in the published JSDoc.

### Why a patch

No public type signatures change. JSDoc only.

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

- Initial published surface: workflow, form, condition, identity,
  organization, and status type contracts under
  `@rytass/bpm-core-shared` plus per-domain subpaths (`/condition`,
  `/form`, `/status`, `/workflow`).
