# BPMCore Public API Reference

Canonical inventory of every export from every published BPMCore package. **This file is the contract.** Any change to a `libs/*/src/**` export — adding, removing, renaming, or changing the visibility of a symbol — must update this file in the same commit.

Last verified against (2026-10-16): `libs/shared@0.17.1`, `libs/bpm-core-client@0.17.1`, `libs/bpm-core@0.17.1` (`@rytass/bpm-core-nestjs-module`), `libs/bpm-core-react@0.17.1`. All four packages are one fixed version set, so these numbers move together.

Versions are set by `nx release` at publish time. The numbers above are the last published ones, not the pending release.

### Release status

The "First released in" column is the earliest `v*` tag that contains the change (`git tag --contains <commit>`). "Not yet released" rows are on `main` after `v0.17.1` and ship with the next `nx release`.

| Change set | First released in |
| ---------- | ----------------- |
| Form option data-source schema contracts (first commits of the 2026-08 issue rounds) | `v0.7.1` |
| Decision-policy designer and shared decision-policy command (PR #12) | `v0.9.0` |
| Template observer, refusal of publish on a deactivated template, notification preferences and quiet hours (Argus follow-ups; a delivery fix followed in `v0.11.0`) | `v0.10.0` |
| DataSource resolve queries and dependency-wait signals (DataSource audit round) | `v0.10.0` |
| ADR 16 table fields, P0-P4 | `v0.12.0` |
| Upstream-integration round (BPM-1 to BPM-9) | `v0.13.0` |
| Release pipeline only | `v0.13.1` |
| Organization unit code fix (BPM-10) | `v0.13.2` |
| NOTIFY webhooks, ADR 18 P0-P6 (shared contract, endpoint registry and catalog, delivery outbox, observability, designer panel, wrapper-host integration, database-managed endpoints) | `v0.13.4` |
| Zero-configuration BPMRootModule round | `v0.13.4` |
| SEQUENTIAL signs one candidate at a time; ORG_MANAGER_CHAIN resolver; excludeInitiator | `v0.14.0` |
| Approval instance business key; submittedByMemberId; organizationTimeZone | `v0.15.0` |
| Attachment signing-secret zero-config (PR #84) | `v0.16.0` |
| Administrator task reassignment (issue #37): reassignTask, reassignMemberTasks, listMemberOpenTasks and their client wrappers | `v0.17.0` |
| Organization unit retirement into a successor unit: transferToOrgUnitId, readOrgUnitRetirementImpact and the hard-delete exception | `v0.17.0` |
| lastDecision in edge conditions, with the reshaped LastDecisionContext and InstanceContext | `v0.17.0` |
| Delegation rule priority (higher first; ties go to the rule created first) and the save-time root check of delegation CEL | `v0.17.0` |
| SLA TERMINATE_INSTANCE ends the instance as EXPIRED (expireApprovalInstance, ExpireApprovalInstanceCommand, INSTANCE_EXPIRED) | `v0.17.0` |
| POSITION approver fallback (every current holder of a position) | `v0.17.0` |
| Unknown approver fallback types refused by name (readUnsupportedApproverFallbackType; the designer keeps them read-only) | `v0.17.0` |
| Template publish checks CEL roots per call site: initiatorPolicyCel allows env / initiator / subject; node expressions allow env / form / formData / initiator / instance; edge conditions add lastDecision | `v0.17.0` |
| The first migration also checks `pg_trgm`, with the same SQL-to-run error as `uuid-ossp` / `ltree` | `v0.17.0` |
| `@rytass/bpm-core-react` declarations resolve under `moduleResolution: node16 / nodenext`: relative imports are fully specified, and every `exports` entry carries per-condition types (`import` → `.d.ts`, `require` → `.d.cts`) | `v0.17.1` |
| Notification sync for hosts (Shuttle request): `id` tie-breaker and `beforeId` keyset paging on `listNotifications`, `NotificationEntity.updatedAt` + `changedSince`, `readNotificationSummary` / `notificationSummary`, `markNotificationsRead`, migration `NotificationUpdatedAt0000000028000` | Not yet released |

---

## Maintenance Contract

When you edit ANY of the following, you MUST also edit this file:

- `libs/shared/src/**`
- `libs/bpm-core-client/src/**`
- `libs/bpm-core/src/**` (exposed as `@rytass/bpm-core-nestjs-module`)
- `libs/bpm-core-react/src/**`
- Any `package.json` `exports` map, `tsconfig.base.json` paths, or `vite.config.ts` `PLANNED_ENTRIES` for the four libs above

If a symbol moves between packages, both the source and destination sections need updating.

Bump the "Last verified against" line at the top to the current version of each affected package after editing.

---

## Publish Procedure (DO NOT SKIP)

### Versioning and changelogs — always `nx release`, never a manual bump

**Do not hand-edit `version` in `libs/*/package.json`.** `nx release` (config in
`nx.json`) owns the version numbers, the per-package `CHANGELOG.md` files, the git
tags and the GitHub releases for **all four** published packages. A manual bump
silently skips the changelog, so consumers get a release whose `CHANGELOG.md`
still ends at the previous version.

Release in separate processes — this is how v0.14.0 shipped:

```bash
npx nx release --dry-run        # review the resolved version and changelog
npx nx release --skip-publish   # version, changelogs, commit, tag, push, GitHub release
pnpm nx run-many -t build -p shared,bpm-core,bpm-core-client --skip-nx-cache
npx nx release publish --otp=<6 digits>   # a second process: build, publish
```

Then confirm every package reached the registry; the exit code is not enough:

```bash
for p in bpm-core-shared bpm-core-nestjs-module bpm-core-client bpm-core-react; do
  curl -s -o /dev/null -w "$p %{http_code}\n" \
    "https://registry.npmjs.org/@rytass%2F$p/<version>"   # 404 = never published
done
```

The one-command form `npx nx release --otp=<6 digits>` also exists, but on
v0.13.5 it exited 0 with three packages never published: inside one process the
build after the version bump hit an nx cache entry written before it, so `dist`
still carried the old version. An OTP that starts with `0` cannot be passed as
`--otp=` (nx parses it as a number). CLAUDE.md → Releasing has the full
mechanism and the recovery path.

While the packages are on 0.x, `version.adjustSemverBumpsForZeroMajorVersion`
is `true`, so bumps follow the 0.x convention: `BREAKING CHANGE:` resolves to a
minor bump rather than 1.0.0, and `feat:` to a patch. See CLAUDE.md →
Releasing for the trade-off that was accepted.

All four packages form **one fixed version set**: a shared version number, a
`v{version}` tag, one workspace `CHANGELOG.md`, one GitHub release, and a
per-package `CHANGELOG.md` each. `prepublish-check` (typecheck + lint + build +
publint, plus test for `bpm-core` and `bpm-core-client`) runs for all four before
versioning.

The trade-off of a fixed set is that any change bumps every package, so
`bpm-core-react` gets a new version even for a backend-only change. That is
deliberate: versioning it on its own cadence is what let it drift to 0.8.0 while
the core packages sat at 0.7.0.

Inter-package `peerDependencies` ranges are rewritten automatically, because
`version.preserveMatchingDependencyRanges` is `false`. Do not hand-maintain the
`@rytass/bpm-core-*` ranges. Aligning the set at 0.9.0 also collapsed
`bpm-core-react`'s accumulated `^0.4.0 || ^0.5.0 || ^0.6.0 || ^0.7.0` into a
single `^0.9.0`.

`release.conventionalCommits.useCommitScope` is **`false` on purpose**. With
nx's default (`true`), only commits whose scope matches a *project* name count
toward the bump and everything else is forced to `patch` — and this repo scopes
commits by domain (`feat(template)`, `fix(calendar)`), which made a three-feature
release resolve to `patch`. Do not remove it.

### Publishing — `nx release publish`

```bash
npx nx release publish        # only to retry a failed publish; add --dry-run first
```

This is the last step of the sequence above, and also the retry when publishing
failed on its own (an expired OTP, a registry 5xx) after versioning, tagging and
pushing are already done. Rebuild by hand first
(`pnpm nx run-many -t build -p shared,bpm-core,bpm-core-client --skip-nx-cache`).

Each project declares its own `nx-release-publish.packageRoot`, so this publishes
every package from the correct directory. `targetDefaults` adds
`dependsOn: ["build"]` to that target, so `dist` is rebuilt from the *new*
version before anything is pushed to the registry — without it the three
`dist`-based packages publish the previous build, because the only other build
in the pipeline is `prepublish-check`, which runs before versioning. nx merges
`targetDefaults` into the implicit publish target rather than replacing it, so
its own `^nx-release-publish` topological ordering is preserved.

Passing `--projects` or `--groups` sets `excludeTaskDependencies`, which drops
that rebuild. Build by hand first if you ever narrow a publish. The two builders still emit to
different places, and that difference is now expressed in config rather than in
two hand-run procedures — mixing them up by hand has already caused a broken
0.1.3 release that had to be deprecated.

| Package                            | Builder            | `packageRoot`            |
| ---------------------------------- | ------------------ | ------------------------ |
| `@rytass/bpm-core-shared`          | `@nx/js:tsc`       | `dist/libs/shared`       |
| `@rytass/bpm-core-nestjs-module`   | `@nx/js:tsc`       | `dist/libs/bpm-core`     |
| `@rytass/bpm-core-client`          | `@nx/js:tsc`       | `dist/libs/bpm-core-client` |
| `@rytass/bpm-core-react`           | Vite library mode  | `libs/bpm-core-react`    |

The three `@nx/js:tsc` packages publish from `dist/libs/<pkg>` because
`generatePackageJson: true` writes the consumer-facing manifest there, with
`main` pointing at compiled `.js`. **Never** `cd libs/<pkg> && npm publish` for
those three — the source manifest points `main` at `./src/index.js` but the
directory ships only `.ts`, so the tarball is non-functional. `bpm-core-react` is
the opposite: Vite emits into `libs/bpm-core-react/dist/` and its in-tree
manifest already has `files` and `main` pointing there, so the lib directory *is*
the package root.

The two `packageRoot` shapes are deliberate, not an inconsistency to tidy up.
Unifying on `dist` would mean rewriting the 40-plus `./dist/...` entries in
`bpm-core-react`'s `exports` map and adding a step to copy its manifest and
CHANGELOG into the output — reintroducing exactly the "metadata in the output
directory has to be kept in sync" problem that made stale-`dist` publishes
possible in the first place.

There is no post-build manifest fixup step. `tools/publish/finalize-dist-package.mjs`
used to inject `"type": "commonjs"` into the dist manifest; as of nx 22.7.1
`generatePackageJson` emits that field itself, verified by clean-rebuilding all
three packages, so the script and its `finalize-dist` targets were removed.
`pkg-quality` (publint) now depends directly on `build`.

### Consumer setup gotchas

Hosts that consume `@rytass/bpm-core-react` through pnpm (strict mode) need this in their `next.config.js`, otherwise Next 16 Turbopack fails to resolve transitive peer deps like `@rytass/bpm-core-client/workflow` from inside the pnpm-isolated bpm-core-react dir:

```js
/** @type {import('next').NextConfig} */
module.exports = {
  transpilePackages: ['@rytass/bpm-core-react'],
};
```

This is documented in `libs/bpm-core-react/README.md` and reproduced verbatim in `docs/11-consumer-quickstart.md` so consumers do not stumble on it.

---

## Package Map

```
shared  ◄─── client  ◄─── react
   ▲
   └─────── nestjs-module
```

| Package | Runtime | Layers depending on it |
|---|---|---|
| `@rytass/bpm-core-shared` | Pure TS types | client + react + nestjs-module |
| `@rytass/bpm-core-client` | fetch (browser + Node 20+) | react |
| `@rytass/bpm-core-nestjs-module` | NestJS backend | host apps only |
| `@rytass/bpm-core-react` | React 18+/19 | host apps only |

---

# 📦 `@rytass/bpm-core-shared`

Pure type contracts. No runtime code.

## `@rytass/bpm-core-shared` (root)

Re-exports the seven subpath modules listed below, plus the identity and organization contract types in the table that follows. There are no `identity` or `organization` subpaths: neither appears in the `exports` map, so `@rytass/bpm-core-shared/identity` and `@rytass/bpm-core-shared/organization` do not resolve.

| Name | Kind | Purpose |
|---|---|---|
| `MemberMetadata` | interface | Display-time member metadata |
| `MemberMetadataCacheEntry` | interface | Cached metadata + TTL |
| `OrgUnitType` | type | `'COMPANY' \| 'DIVISION' \| 'DEPARTMENT' \| 'TEAM'` (uppercase, the GraphQL wire format) |
| `ManagerResolutionScopeType` | type | `'MEMBER' \| 'ORG_UNIT' \| 'POSITION'` |
| `OrgUnit` | interface | Org-unit node |
| `Position` | interface | Position |
| `Membership` | interface | member × orgUnit × position relation |
| `ManagerResolution` | interface | "Who is whose manager" rule |

## `@rytass/bpm-core-shared/condition`

Audit-condition evaluation context structures.

| Name | Kind | Purpose |
|---|---|---|
| `ConditionContextType` | type | Union of all evaluation context kinds |
| `SubjectContext` | interface | Applicant's own attributes |
| `OrgContext` | interface | Applicant's organization |
| `PositionContext` | interface | Applicant's position |
| `EnvContext` | interface | Environment vars (amount, date, etc.) |
| `InstanceContext` | interface | `instance` in a workflow expression: `id`, `state`, `templateId`, `templateVersionId`, `title` |
| `LastDecisionContext` | interface | `lastDecision` in an edge condition: the newest decision on the node the edge leaves (`action`, `comment`, `decidedAt`, `decidedByMemberId`, `returnToNodeId`, `taskId`, `transferToMemberId`), or `null` before that node has one. Edge conditions are the only expressions that may name it |

## `@rytass/bpm-core-shared/form`

Form-schema definitions.

| Name | Kind | Purpose |
|---|---|---|
| `FormDefinitionSchema` | interface | Full form definition (fields + uiSchema) |
| `FormFieldDefinition` | type | Union of all field-definition variants |
| `FormFieldValue` | type | Union of all field-value variants (cell value or table rows) |
| `FormTableCellValue` | type | Primitive value contract for a flat field or a table cell |
| `FormTableRowValue` | type | One table row: column key to cell value |
| `TextFieldDefinition` | type | `text` / `textarea`, optional `minLength` / `maxLength`; `displayAs?: 'link'` renders a safe path or http(s) URL as a link in read-only views. Every field also takes `hidden?: boolean` (store only, never rendered; not a permission boundary) — see docs/08 §7 |
| `NumberFieldDefinition` | type | `number` / `money`, optional `minimum` / `maximum` |
| `DateFieldDefinition` | type | date / datetime |
| `FormSelectionMode` | type | `single` or `multiple` option selection |
| `FormDataSourceReference` | interface | Registered source key, version, and bindings |
| `FormDataSourceBinding` | interface | One parameter bound to a source |
| `FormDataSourceBindingSource` | type | Top-level field, primitive constant, or same-row column |
| `FormFieldOptionSource` | type | Static options / DataSource XOR union |
| `SelectFieldDefinition` | type | Select option field with single / multiple mode |
| `AutoCompleteFieldDefinition` | type | AutoComplete option field with single / multiple mode |
| `RadioFieldDefinition` | type | Fixed single-selection option field |
| `CheckboxFieldDefinition` | type | Fixed multiple-selection option field |
| `FormOptionFieldDefinition` | type | Union of the four option controls |
| `FormFieldOption` | interface | Option in a select field |
| `FormDataSourceValueSnapshot` | type | Persisted dynamic option labels and validation metadata; optional `revalidationPolicy` records the policy the source declared when the snapshot was written |
| `FormDataSourceValueSnapshots` | type | Field-keyed dynamic option snapshot map |
| `FormDataSourceOptionFieldDefinition` | type | Option field narrowed to a DataSource |
| `FormStaticOptionFieldDefinition` | type | Option field narrowed to static options |
| `BooleanFieldDefinition` | type | Boolean toggle |
| `FileUploadFieldDefinition` | type | Attachment upload |
| `MemberFieldDefinition` | type | 人員選擇 field — stores a member id, or an array of ids when `multiple` is true |
| `TableFieldDefinition` | type | Repeating-row table field (columns, row bounds, add-row label) |
| `TableColumnDefinition` | type | Union of the field types a table column may use |
| `TABLE_COLUMN_FIELD_TYPES` | const | Field types the structural lint accepts as a column |
| `FORM_TABLE_MAX_ROWS` | const | Hard ceiling (100) on table rows |
| `FormUiSchema` | interface | Layout description for renderer |
| `FormLayoutItem` | interface | One cell in the layout grid |
| `isFormOptionFieldDefinition()` | function | Option-control type guard |
| `isFormDataSourceFieldDefinition()` | function | DataSource-backed option type guard |
| `isFormStaticOptionFieldDefinition()` | function | Static-option type guard |
| `isMemberFieldDefinition()` | function | Member field type guard |
| `isFormMemberValue()` | function | Whether a value is a well-formed member value (non-empty string, or array of non-empty strings when `multiple`) |
| `readFormMemberIds()` | function | Member ids held by a member field value, whichever shape it has |
| `isTableFieldDefinition()` | function | Table field type guard |
| `isTableColumnFieldType()` | function | Whether a field type may be used as a column |
| `isFormTableCellValue()` | function | Primitive cell-value guard |
| `isFormTableRowValue()` | function | Single table row guard |
| `isFormTableRowValues()` | function | Table row array guard |
| `readFormTableCellValue()` | function | Narrow a field value to a cell value, `undefined` for table rows |
| `isFormIdentifierKey()` | function | Whether a key is a plain identifier (required for table and column keys) |
| `readFormFieldSelectionMode()` | function | Normalized control selection mode |
| `normalizeFormDefinitionSchema()` | function | Additive legacy-schema normalization, recursing into table columns |

## `@rytass/bpm-core-shared/status`

| Name | Kind | Values |
|---|---|---|
| `VersionStatus` | type | `'DRAFT' \| 'PUBLISHED' \| 'ARCHIVED'` |
| `ApprovalInstanceState` | type | DRAFT / RUNNING / APPROVED / REJECTED / RETURNED / CANCELLED / EXPIRED |
| `WorkflowTokenStatus` | type | `'ACTIVE' \| 'WAITING' \| 'CONSUMED'` |
| `TaskStatus` | type | PENDING / COMPLETED / CANCELLED / etc. |
| `TaskDecisionAction` | type | `'APPROVED' \| 'REJECTED' \| 'RETURNED' \| 'TRANSFERRED'` |
| `DelegationRuleStatus` | type | ACTIVE / EXPIRED / REVOKED |
| `DelegationScopeType` | type | ALL / TEMPLATE_LIST / CONDITION_BASED |

## `@rytass/bpm-core-shared/workflow`

| Name | Kind | Purpose |
|---|---|---|
| `WorkflowDefinition` | interface | Full definition (nodes + edges + meta) |
| `WorkflowDefinitionMeta` | interface | Version, author, etc. |
| `WorkflowNode` | type | Union of all node variants |
| `NodePosition` | interface | xyflow canvas coords |
| `BaseNodeData` | interface | Fields every node shares |
| `BaseWorkflowNode` | generic interface | Generic node base type |
| `WorkflowNodeTriggerMode` | type | `'AND' \| 'OR'` |
| `StartEventNode` / `EndEventNode` / `UserTaskNode` / `ServiceTaskNode` / `ExclusiveGatewayNode` / `ParallelGatewayNode` | type | Concrete node variants |
| `UserTaskNodeData` | interface | userTask-specific data |
| `ApproverResolver` | type | DIRECT / POSITION / ORG_UNIT_MEMBER / ORG_UNIT_POSITION / ORG_MANAGER / ORG_UNIT_MANAGER / DYNAMIC_FORM / EXPRESSION / ORG_MANAGER_CHAIN (`{ type, minPositionLevel, fallback? }` — every manager up the initiator's chain, ending at the first whose position level reaches `minPositionLevel`; on such a node a delegate or a manual transfer target must hold at least the position level of the member they replace — a delegation that falls short is not applied and is recorded in the `skippedDelegations` payload field of `TASK_CREATED` / `TASK_CANDIDATE_ACTIVATED`, a transfer is rejected with `ForbiddenException`; SLA escalation is exempt) |
| `ApproverResolverFallback` | type | Fallback when a manager resolver (`ORG_MANAGER` / `ORG_UNIT_MANAGER` / `ORG_MANAGER_CHAIN`) finds no manager: `NONE`, `DIRECT` (`memberId`, optional `allowInitiatorSelfApproval`), or `POSITION` (`positionId`, optional `allowInitiatorSelfApproval`; every current holder becomes an approver, the initiator is dropped unless self approval is allowed). `POSITION` is not yet released. Needs engine ≥ the version that introduced `POSITION`; older engines refuse a template carrying it at run time |
| `readUnsupportedApproverFallbackType(fallback)` | function | The fallback's `type` when this build does not know it (a definition saved by a newer version), otherwise `null`. The single list of known fallback types, read by both the engine (refuses at run time) and the designer (keeps it read-only); adding a member to `ApproverResolverFallback` does not compile until it is listed |
| `DecisionPolicy` | type | SINGLE / SEQUENTIAL / PARALLEL_ALL / PARALLEL_ANY / QUORUM |
| `ReturnBehavior` | interface | Return-handling settings (incl. `requireComment`) |
| `ReturnResubmitStrategy` | type | `'FROM_RETURN_POINT' \| 'RESTART'` |
| `SlaConfig` | interface | SLA timer config (incl. `calendar`) |
| `ExcludeInitiatorConfig` | interface | `UserTaskNodeData.excludeInitiator` — separation of duties: when present the instance's initiator is never one of the node's approvers (a delegate acting for them counts as them), and neither is the member who submitted on their behalf (`submittedByMemberId`, same rule; an `ORG_MANAGER_CHAIN` walk climbs past him instead of stopping at him). `{ whenEmpty }`; absent keeps the previous behaviour |
| `ExcludeInitiatorWhenEmpty` | type | What happens when no approver is left after the initiator is removed: `FAIL` / `INITIATOR_MANAGER` / `SKIP_NODE` |
| `SlaCalendarMode` | type | `'CALENDAR' \| 'BUSINESS_DAY'` |
| `FieldPermission` | interface | Per-node read/write permission — reserved, **not enforced** (the engine and screens never read `fieldPermissions`) |
| `NotificationOverride` | interface | Node-level notification overrides |
| `NotificationChannel` | type | `'IN_APP' \| 'EMAIL' \| 'WEBHOOK'` |
| `ServiceAction` | type | Action runnable by a serviceTask; `NOTIFY` may carry optional `webhooks` (ADR 18) |
| `NotifyWebhookTarget` / `NotifyWebhookEndpointReference` | interface | One host-registered webhook endpoint (`key` + exact `version`) a NOTIFY node calls, with a stable node-local `id` |
| `NotifyWebhookBinding` / `NotifyWebhookBindingSource` | interface/type | Parameter binding from a form field (`FIELD`), a constant (`CONSTANT`) or case context (`CONTEXT`) |
| `NotifyWebhookContextPath` | type | Case/node values a `CONTEXT` binding may read |
| `NotifyWebhookParameterType` | type | `'boolean' \| 'json' \| 'number' \| 'string' \| 'stringArray'` |
| `GatewayDirection` | type | `'split' \| 'join'` |
| `WorkflowEdge` / `WorkflowEdgeData` | interface | Edge with optional condition |
| `WorkflowEdgeConditionOperator` | type | Edge condition operators |

## `@rytass/bpm-core-shared/workflow-graph`

Pure, framework-agnostic structural transforms over a `WorkflowDefinition` (no React, DOM, or dagre). Canonical home for the designer's graph operations; reused by the command layer below and the frontend.

| Name | Kind | Purpose |
|---|---|---|
| `NodePaletteType` | type | `'userTask' \| 'serviceTask' \| 'exclusiveGateway'` |
| `WorkflowConnectionCandidate` | interface | Source/target/handle candidate for connection validation |
| `WorkflowNodeInsertResult` | interface | Definition + post-insert selection intent |
| `WorkflowEdgeIdFactory` | type | Injectable edge-id generator |
| `ConditionOperatorOption` / `ConditionValueOption` | interface | Condition UI option shapes |
| `WORKFLOW_INPUT_HANDLE_ID` / `WORKFLOW_OUTPUT_HANDLE_ID` | const | ReactFlow handle ids |
| `WORKFLOW_NODE_TYPE_LABELS` | const | zh-TW node type labels |
| `CONDITION_OPERATOR_OPTIONS` / `CONDITION_OPERATORS_REQUIRING_VALUE` | const | Condition operator catalog |
| `SlaDurationUnit` / `SlaDurationParts` / `SlaOption` | type/interface | Single-unit SLA duration authoring shapes |
| `SLA_DURATION_UNIT_OPTIONS` / `SLA_CALENDAR_MODE_OPTIONS` / `SLA_TIMEOUT_ACTION_OPTIONS` | const | zh-TW SLA select catalogs |
| `DEFAULT_SLA_CONFIG` | const | SLA applied when a node's timer is switched on |
| `composeSlaDuration` / `readSlaDurationParts` / `isSlaCalendarModeApplicable` | function | ISO duration ⇄ value+unit, and whether `BUSINESS_DAY` applies |
| `DEFAULT_QUORUM_THRESHOLD` | const | Threshold seeded when a `QUORUM` decision policy is first chosen |
| `composeQuorumThreshold` | function | Sanitises a quorum threshold (integer, min 1, `PERCENTAGE` capped at 100) |
| `readDesignTimeApproverCount` | function | Approvers a resolver is guaranteed to produce; `null` for runtime-resolved strategies |
| `isDecisionPolicyUnsatisfiable` | function | `true` when a `COUNT` quorum exceeds the approvers the node can ever collect |
| `defaultWorkflowEdgeId` | function | Default edge id factory |
| `createWorkflowNode` / `readNextWorkflowNodeIndex` | function | Node factory + id indexing. **Behaviour change:** a new `userTask` approver and a new NOTIFY `recipients` now default to `DEFAULT_MANAGER_RESOLVER` (the initiator's manager) instead of the placeholder `{ type: 'DIRECT', memberIds: ['member-001'] }`; callers that relied on the old placeholder must set a resolver themselves |
| `DEFAULT_MANAGER_RESOLVER` | const | `{ type: 'ORG_MANAGER', baseFromInitiator: true, levelsUp: 1 }` — the resolver `createWorkflowNode` seeds on new user and NOTIFY nodes, exported so a host can reuse or compare against it |
| `createWorkflowEdge` / `readInsertedOutgoingEdgeData` | function | Edge factory + inserted-edge data |
| `insertWorkflowNodeIntoDefinition` / `insertWorkflowNodeAtEdge` / `insertWorkflowNodeAfterNode` | function | Node insertion strategies |
| `renameWorkflowNode` / `applyWorkflowNodeTriggerMode` | function | Node data transforms |
| `normalizeDesignerWorkflowDefinition` / `removeAsyncNotifyOutgoingEdges` / `normalizeSingleIncomingTriggerModes` | function | Definition normalizers |
| `readFallbackWorkflowDefinition` / `isEmptyDesignerWorkflowDefinition` | function | Empty/default definition |
| `isWorkflowConnectionValid` / `isWorkflowNodeRemovable` / `isWorkflowNodeInputConnectable` / `isWorkflowNodeOutputConnectable` / `isAsyncNotifyServiceTask` | function | Connection rules |
| `isExclusiveGatewaySourceEdge` / `isParallelGatewaySourceEdge` / `toggleSelectedEdgeId` | function | Gateway/edge helpers |
| `readWorkflowDefinitionIssue` / `readApproverResolverIssue` / `hasConfiguredConditionEdges` / `readServiceTaskMemberIds` | function | Validation |
| `isOrgManagerChainDecisionPolicyInvalid` | function | `true` when an `ORG_MANAGER_CHAIN` approver is paired with a decision policy other than `SEQUENTIAL` / `PARALLEL_ALL` (or none); shared by `readWorkflowDefinitionIssue`, `lintWorkflowDefinition`, the designer and the `setUserTaskApprover` command, which swaps such a policy for `SEQUENTIAL` (the chain then signs nearest manager first) |
| `NOTIFY_WEBHOOK_TARGET_LIMIT` / `NOTIFY_WEBHOOK_CONTEXT_PATHS` / `NOTIFY_WEBHOOK_ENDPOINT_VERSION_MAX` | const | Per-node webhook cap (10), the allowed `CONTEXT` binding paths, and the endpoint version ceiling (int32) |
| `NotifyWebhookTargetIdFactory` / `NotifyWebhookStructureIssue` / `NotifyWebhookStructureIssueCode` | type/interface | Injectable target-id generator; registry-independent webhook shape issue as a code (formatted separately by the designer and the backend lint), located by `targetIndex` / `bindingIndex` / `parameter`, plus `property` for `UNKNOWN_PROPERTY` (a key outside the contract, relative to the target or binding) |
| `defaultNotifyWebhookTargetId` / `createNotifyWebhookTarget` / `readNotifyWebhookTargets` | function | NOTIFY webhook target factory and reader |
| `isNotifyRecipientsEmpty` / `readNotifyRecipientsIssue` | function | Empty `DIRECT` recipients (allowed only with webhooks) vs a misconfigured recipient resolver |
| `readNotifyServiceTaskIssue` | function | zh-TW issue for one NOTIFY node (recipients + webhooks); used by `readWorkflowDefinitionIssue` and the template designer's pre-save check |
| `EXCLUDE_INITIATOR_WHEN_EMPTY_VALUES` | const | The accepted `ExcludeInitiatorWhenEmpty` values |
| `readExcludeInitiatorIssue` | function | zh-TW issue when a userTask's `excludeInitiator` is set without a valid `whenEmpty`; used by `readWorkflowDefinitionIssue` and the template designer's pre-save check |
| `readNotifyWebhookStructureIssues` / `isNotifyWebhookContextPath` | function | Structural webhook checks shared by the designer and `lintWorkflowDefinition`, including rejection of unknown keys (no URL/header/secret may be stored) |
| `isFormFieldCompatibleWithWebhookParameter` / `isNotifyWebhookValueCompatibleWithParameter` | function | Whether a form field or a concrete value can feed a webhook parameter type |
| `NotifyWebhookEndpointContract` (optional `deprecated` / `disabled`) / `NotifyWebhookCatalogIssue` / `NotifyWebhookCatalogIssueCode` | type/interface | The descriptor subset the catalog lint reads, and a catalog/form publish problem as a code (`ENDPOINT_MISSING`, `ENDPOINT_DEPRECATED`, `ENDPOINT_DISABLED`, `PARAMETER_REQUIRED`, `PARAMETER_UNKNOWN`, `FIELD_MISSING`, `FIELD_INCOMPATIBLE`, `CONSTANT_REQUIRED_NULL`, `CONSTANT_INCOMPATIBLE`, `CONTEXT_INCOMPATIBLE`) |
| `readNotifyWebhookTargetCatalogIssues` / `readNotifyWebhookCatalogIssueMessage` | function | Checks one well-formed target against its endpoint and the form — the rules behind the backend publish lint and the template designer's publish check — and the designer's zh-TW wording of an issue |
| `readConditionField` / `readConditionOperator` / `readConditionOperatorIds` / `readConditionValueOptions` / `readNextConditionOperator` / `readNextConditionValue` / `shouldConditionOperatorUseValue` / `readConditionLabel` / `readConditionOperatorLabel` / `readConditionValueLabel` / `readFormFieldOption` / `readConditionExpression` / `readFormFieldReference` / `readConditionExpressionOperator` / `readConditionExpressionValue` | function | Condition compilation (UI state → CEL) |

## `@rytass/bpm-core-shared/workflow-command`

The serialisable command layer + pure reducer that both the designer UI and the LLM assistant drive the workflow through (single dispatch path).

| Name | Kind | Purpose |
|---|---|---|
| `WorkflowDesignerState` | interface | Single source of truth (definition + formSchema + selection + policy) |
| `WorkflowNodeAnchor` | interface | Where a new node wires in (`edgeId` / `afterNodeId`) |
| `WorkflowCommand` | type | Fine-grained primitive command union (add/rename/delete/connect/setEdgeCondition/setUserTaskReturnRequireComment/setUserTaskSla/setUserTaskDecisionPolicy/setUserTaskExcludeInitiator/…) |
| `WorkflowMacroCommand` | type | High-level intents (insertApprovalStep / insertNotification / insertConditionalBranch) |
| `AnyWorkflowCommand` | type | `WorkflowCommand \| WorkflowMacroCommand` |
| `WorkflowCommandEffects` | interface | Controller hints (`layout: boolean`) |
| `WorkflowCommandResult` | interface | `{ state, changed, error, issue, effects }` |
| `WorkflowCommandOptions` | interface | `{ createEdgeId? }` for deterministic runs |
| `applyWorkflowCommand` | function | Pure reducer for a single primitive command |
| `applyWorkflowMacroCommand` | function | Expands + folds a macro into primitives |
| `applyWorkflowCommands` | function | Folds a batch of primitives, threading state |
| `expandMacroCommand` | function | Macro → primitive command sequence |

## `@rytass/bpm-core-shared/workflow-toolset`

Provider-agnostic LLM toolset (JSON Schema) over the command layer, plus a read-only snapshot view.

| Name | Kind | Purpose |
|---|---|---|
| `JsonSchema` | type | `Readonly<Record<string, unknown>>` tool input contract |
| `WorkflowToolKind` | type | `'mutation' \| 'macro' \| 'query'` |
| `WorkflowTool` | interface | `{ name, description, inputSchema, kind }` |
| `WORKFLOW_TOOLSET` | const | The full tool catalog (mutations, macros, queries), incl. `set_user_task_return_require_comment`, `set_user_task_sla`, `set_user_task_exclude_initiator` and `set_user_task_decision_policy`. One mutation tool per designer-reachable command — the assistant's contract is parity with the property form |
| `WORKFLOW_TOOL_BY_NAME` | const | `ReadonlyMap<string, WorkflowTool>` lookup |
| `WorkflowNodeSnapshot` / `WorkflowEdgeSnapshot` / `WorkflowSnapshot` | interface | LLM-readable view of state |
| `readWorkflowSnapshot` | function | State → snapshot |
| `WorkflowToolResult` | type | Discriminated `{ ok, kind, … }` result |
| `ExecuteWorkflowToolOptions` | interface | Execution options (`createEdgeId?`, `resolveFormSchema?`) |
| `executeWorkflowTool` | function | Run one tool call (parse input → command → reducer) |

---

# 📦 `@rytass/bpm-core-client`

Cross-platform typed GraphQL/REST client. All functions ultimately use `fetch`.

## `@rytass/bpm-core-client` (root)

### Transport / Endpoint

| Name | Kind | Purpose |
|---|---|---|
| `requestGraphQl<T>(query, variables?, options?)` | async function | Generic GraphQL POST, returns typed data |
| `GraphQlRequestOptions` | interface | Per-request transport options; currently `signal?: AbortSignal` |
| `readGraphQlEndpoint()` | function | Resolve current GraphQL endpoint URL |
| `resolveDefaultGraphQlEndpoint(hostname)` | function | Pure helper to derive endpoint from hostname |
| `readApiBaseUrl()` | function | Resolve REST auth base URL |
| `resolveApiBaseUrlFromGraphQlEndpoint(url)` | function | Reverse-derive auth base URL from GraphQL URL |

### Client configuration

Process-wide overrides read by every request. `configureBPMClient()` replaces the whole configuration on each call; it does not merge.

| Name | Kind | Purpose |
|---|---|---|
| `BPMClientConfig` | interface | Optional `baseUrl`, `authBaseUrl`, `fetch` and `headers` |
| `configureBPMClient(config)` | function | Replace the active configuration |
| `readBPMClientConfig()` | function | Return the active configuration (for tests and inspection; do not mutate it) |
| `resolveBPMFetch()` | function | The configured `fetch`, falling back to the global `fetch` |
| `readBPMConfiguredHeaders()` | function | The configured `headers`, or an empty record; internal transports merge them into outbound requests |

### REST Auth Client

| Name | Kind | Purpose |
|---|---|---|
| `ApiMember` | interface | Authenticated member profile |
| `ApiPublicMember` | interface | Publicly visible test-member profile |
| `listApiTestMembers()` | async function | List demo wrapper-host accounts |
| `loginApi({ identifier, password })` | async function | POST `/auth/login`, browser auto-stores cookie |
| `logoutApi()` | async function | POST `/auth/logout` |
| `readApiCurrentMember()` | async function | GET `/auth/me`; returns `null` on 401 |

### Member Directory

| Name | Kind | Purpose |
|---|---|---|
| `MemberProfileRecord` | interface | id / name / email / avatar |
| `MemberDirectoryPage` | interface | Pagination wrapper |
| `resolveMembers(ids)` | async function | Batch memberId → profile (deduped) |
| `searchMembers(query)` | async function | Sends the query as `searchText`; which fields match is decided by the host's `BPMMemberResolver.search` |
| `listMemberDirectoryPage({ page, pageSize, searchText })` | async function | Full directory pagination |

## `@rytass/bpm-core-client/organization`

| Category | Names |
|---|---|
| Types | `OrgUnitType`, `ManagerResolutionScopeType` |
| Records | `OrgUnitRecord`, `OrgUnitRetirementImpactRecord`, `PositionRecord`, `MembershipRecord`, `ManagerResolutionRecord`, `OrganizationSummaryRecord`, `ResolvedManagerRecord` |
| Queries | `readOrganizationDashboard()`, `listMemberships()`, `listManagerResolutions()`, `readResolvedManager()`, `readOrgUnitRetirementImpact(id)` |
| OrgUnit Mutations | `createOrgUnit()`, `updateOrgUnit()`, `deleteOrgUnit(id, { transferToOrgUnitId? })`, `commitOrgUnitTreeDraft()` |
| Position Mutations | `createPosition()`, `updatePosition()`, `deletePosition(id)` |
| Membership Mutations | `createMembership()`, `updateMembership()`, `deleteMembership()` |
| ManagerResolution Mutations | `createManagerResolution()`, `updateManagerResolution()`, `deleteManagerResolution()` |

## `@rytass/bpm-core-client/form`

| Category | Names |
|---|---|
| Records | `FormDefinitionRecord`, `FormDefinitionVersionRecord`, `FormBuilderRecord`, `FormSchemaLintResult` |
| Type | `FormDefinitionListStatus` |
| Queries | `listFormDefinitions()`, `listFormDefinitionsPage()`, `readFormBuilder()`, `lintFormSchema()`, `listFormDataSources()`, `previewFormFieldOptions()`, `readFormFieldOptions()`, `previewResolveFormFieldOptions()`, `resolveFormFieldOptions()` |
| Mutations | `createFormDefinition(name)`, `updateFormDefinition()`, `updateFormDefinitionDraft()`, `publishFormDefinitionVersion()`, `publishFormDefinitionContent()` |
| Factory | `createFieldDefinition()` (accepts `'table'`), `createTableColumnDefinition()` |

### Form DataSource records

| Name | Kind | Purpose |
|---|---|---|
| `FormDataSourceControl`, `FormDataSourceParameterType`, `FormDataSourceRevalidationPolicy` | type | Client-facing descriptor unions |
| `FormDataSourceParameterRecord`, `FormDataSourceDescriptorRecord` | interface | Catalog descriptor records |
| `FormDataSourceOptionsResultRecord` | interface | Search result: page options, `nextCursor`, and `waitingForFieldKeys` |
| `FormDataSourceResolveResultRecord` | interface | Resolve result: authoritative options, `unresolvedValues`, and `waitingForFieldKeys` |
| `PreviewFormFieldOptionsInput`, `RuntimeFormFieldOptionsInput` | interface | Preview/runtime search input contracts (optional `signal`) |
| `PreviewResolveFormFieldOptionsInput`, `RuntimeResolveFormFieldOptionsInput` | interface | Preview/runtime resolve input contracts: `values` plus an optional `signal` |

`waitingForFieldKeys` is the authoritative answer to "can this control be queried
yet". The browser never receives the descriptor, so it cannot tell a required
parameter from an optional one; a non-empty list means no provider call was made
and `options` is empty. `unresolvedValues` reports the already-selected values
the source can no longer account for — the read-only resolve queries report the
gap instead of failing, while submit/resubmit stay all-or-nothing.

### Form DataSource state helpers

| Name | Kind | Purpose |
|---|---|---|
| `FormDataSourceFieldStatus` | type | Renderer state union: idle, dependency wait, loading, valid, stale, invalid, or unavailable |
| `mergeFormDataSourceOptions()` | function | Immutable selected/snapshot/page option merge with stable order |
| `readSelectedFormDataSourceOptions()` | function | Hydrate only selected options with authoritative labels |
| `readFormDataSourceSelectedValues()` | function | Read the selected option values carried by a field value, dropping blanks |
| `readMissingFormDataSourceOptionValues()` | function | Find selected values without an authoritative option |
| `readMissingFormDataSourceDependencies()` | function | Find FIELD (and, with row values, ROW_FIELD) bindings that are not yet present — advisory only; runtime callers must take `waitingForFieldKeys` from the server result |
| `readFormDataSourceValueSignature()` | function | Stable value signature for change detection |

### Form DataSource error helpers

| Name | Kind | Purpose |
|---|---|---|
| `FORM_DATA_SOURCE_ERROR_CODES` | const | Stable DataSource error codes returned by the GraphQL surface |
| `FormDataSourceErrorCode` | type | Union of the stable DataSource error codes |
| `readFormDataSourceErrorCode()` | function | Extract the DataSource code from a rejected request, else `null` |
| `readFormDataSourceErrorMessage()` | function | Map a rejected request to display copy, else `null` |
| `readFormSchemaLintMessage()` | function | Replace the code inside a publish-lint line, keeping the field path |

### Form DataSource builder helpers

| Name | Kind | Purpose |
|---|---|---|
| `FormDataSourceBindingFieldOption` | interface | Type-compatible form-field choice for a parameter binding |
| `FormDataSourceBindingValueKind` | type | `'CONSTANT' \| 'FIELD' \| 'ROW_FIELD'` binding discriminator |
| `isFormDataSourceDescriptorCompatible()` | function | Enforce descriptor capability requirements for a control |
| `readCompatibleFormDataSourceDescriptors()` | function | Filter catalog descriptors for a control |
| `readFormDataSourceParameterType()` | function | Map a form field to a DataSource parameter type |
| `readCompatibleFormDataSourceBindingFields()` | function | List type-compatible dependency fields, excluding the target |
| `readFormDataSourceBinding()` | function | Read one parameter binding from a dynamic field |
| `upsertFormDataSourceFieldBinding()` | function | Immutably add, replace, or remove one parameter binding |
| `renameFormDataSourceFieldBindings()` | function | Keep FIELD bindings valid when a form field key changes, including bindings inside table columns |
| `renameFormTableColumnBindings()` | function | Keep a table's ROW_FIELD bindings valid when a column key changes |
| `readFormDataSourceFieldDependencyKeys()` | function | List fields referenced by dynamic bindings |
| `readFormDataSourceBindingValue()` | function | Read a constant binding value |
| `readFormDataSourceBindingValueKind()` | function | Read the binding source discriminator (`CONSTANT` / `FIELD` / `ROW_FIELD`) |
| `readCompatibleFormTableColumnBindingFields()` | function | List type-compatible sibling columns for a ROW_FIELD binding |

### Form Rendering Helpers (pure functions, no GraphQL)

| Name | Kind | Purpose |
|---|---|---|
| `FormRendererValues` | type | Key → value map during render |
| `FormRendererValidationResult` | interface | Validation outcome |
| `ConditionOperator` | type | Operator union |
| `ParsedConditionRule` | type | Parsed condition AST |
| `buildFormRendererValues()` | function | Build initial values from schema (table fields seed `minRows` rows) |
| `readVisibleFormRendererFields()` | function | Filter visible fields by condition |
| `validateFormRendererValues()` | function | Whole-form validation, recursing into table rows; cell errors keyed by instance path |
| `focusFormRendererField(key)` | function | DOM focus on a field or a table cell instance path |
| `readFormTableCellPath()` | function | Build the `<tableKey>[<i>].<columnKey>` instance path |
| DataSource query inputs | interface | `PreviewFormFieldOptionsInput` / `RuntimeFormFieldOptionsInput` / `PreviewResolveFormFieldOptionsInput` / `RuntimeResolveFormFieldOptionsInput` accept an optional `rowValues`, and their `fieldKey` accepts a `<tableKey>.<columnKey>` schema path |
| `readFormTableRows()` | function | Narrow a field value to table rows |
| `readFormTableRowBounds()` | function | Resolve a table's effective `minRows` / `maxRows` |
| `createFormTableRow()` | function | Build one row seeded from the column defaults |
| `isFormRendererFieldVisible / Required / Readonly` | function | Predicate helpers |
| `evaluateConditionExpression()` | function | Evaluate a condition expression |
| `parseConditionRule()` / `buildConditionExpression()` | function | Rule ↔ string conversion |
| `readDefaultConditionOperator / Value()` | function | Defaults for condition UI |
| `readConditionOperatorOptions / Option()` | function | Operator menu helpers |
| `readDatePickerValue` / `formatDatePickerValue` / `formatDateTimePickerValue` | function | Mezzanine DatePicker bridging |
| `isNumberFieldDefinition / isDateFieldDefinition / isSelectFieldDefinition` | function | Type guards |
| `readSelectOption / readFieldOptionAsSelectOption` | function | Select-option helpers |
| `parseOptionalNumberInput`, `clampOptionalNumber` | function | Numeric-input helpers |

## `@rytass/bpm-core-client/template`

| Category | Names |
|---|---|
| Records | `ApprovalTemplateRecord`, `ApprovalTemplateCategoryRecord`, `ApprovalTemplateVersionRecord`, `FormDefinitionRecord`, `FormDefinitionVersionRecord`, `PublishedFormVersionOption`, `MemberProfileRecord`, `WorkflowDryRunStepRecord`, `WorkflowDryRunResultRecord`, `TemplateDesignerRecord`, `ApprovalTemplatesPage`, `ApprovalTemplateCategoriesPage`, `ComposeApprovalTemplateWithFormResult` |
| Types | `ApprovalTemplateListStatus`, `ApprovalTemplateCategoryStatus` |
| Queries | `listApprovalTemplates()`, `listApprovalTemplatesPage()`, `listApprovalTemplateCategoriesPage()`, `readTemplateDesigner()`, `searchPublishedFormVersionOptions()`, `resolveMemberOptions()`, `searchMemberOptions()` |
| Mutations | `createApprovalTemplate()`, `createApprovalTemplateCategory()`, `updateApprovalTemplateCategory()`, `deleteApprovalTemplateCategory()`, `updateApprovalTemplateDraft()`, `forkApprovalTemplate()`, `publishApprovalTemplateVersion()`, `rollbackApprovalTemplateVersion()`, `composeApprovalTemplateWithForm()`, `activateApprovalTemplate(id)`, `deactivateApprovalTemplate(id)` |
| Types | `ApprovalTemplateActivationStatus` (`'ACTIVE' \| 'ALL' \| 'INACTIVE'`, accepted by `listApprovalTemplates()` / `listApprovalTemplatesPage()`) |
| Dry-run | `dryRunApprovalWorkflow()` |
| Webhook catalog | `listWorkflowWebhookEndpoints({ includeDeprecated? })` (designer-only; no URL, header or secret), `WorkflowWebhookEndpointRecord` (P6 adds `disabled`), `WorkflowWebhookParameterRecord`, `WorkflowWebhookEndpointSource` |
| Webhook endpoint administration (P6) | `readWorkflowWebhookEndpointManagement()`, `listWorkflowWebhookManagedEndpoints()`, `listWorkflowWebhookEndpointAudits(endpointId)`, `createWorkflowWebhookEndpoint(input)`, `updateWorkflowWebhookEndpoint(input)`, `setWorkflowWebhookEndpointActive(id, active)`, `rotateWorkflowWebhookEndpointSecret(id, signingSecret)`, `testWorkflowWebhookEndpoint(id)`; records `WorkflowWebhookEndpointManagementRecord`, `WorkflowWebhookManagedEndpointRecord` (header names and `hasSigningSecret` only), `WorkflowWebhookEndpointAuditRecord`, `WorkflowWebhookEndpointAuditAction`, `WorkflowWebhookEndpointTestResultRecord`; inputs `CreateWorkflowWebhookEndpointInput`, `UpdateWorkflowWebhookEndpointInput`, `WorkflowWebhookEndpointHeaderInput`, `WorkflowWebhookEndpointParameterInput` (administrator-only) |

## `@rytass/bpm-core-client/workflow`

### Types / Records

| Group | Names |
|---|---|
| Instance | `ApprovalInstanceState`, `ApprovalInstanceRecord` (incl. `formDataOptionSnapshot` / `formDataOptionSnapshotJson` and the optional `submittedByMemberId` — the member who filed it when that is not the initiator; `null`, absent or equal to `initiatorMemberId` means the initiator did), `ApprovalInstanceView`, `ApprovalInstancesPageInput / Result`, `ApprovalInstancePageInfoRecord`, `LaunchContext`, `LaunchableTemplateRecord` |
| Task | `TaskStatus`, `TaskAssignmentType`, `TaskDecisionAction`, `TaskRecord` (incl. `isAdhoc` / `adhocType` / `adhocOriginTaskId` / `adhocDirectiveId` / `candidateMemberIds` / `openCandidateMemberIds` / `nodeLabel`), `TaskCandidateRecord` (incl. `sequence`), `TaskDecisionRecord`, `WorkflowTokenRecord`, `MemberOpenTaskRecord`, `MemberTaskRole`, `TaskReassignmentOutcome`, `TaskReassignmentErrorCode`, `TaskReassignmentResultRecord` |
| Ad-hoc | `AdhocDirectiveType`, `AdhocDirectiveStatus`, `AdhocTargetKind`, `AdhocPreApprovalRejectBehavior`, `AdhocTargetOptions`, `AdhocDirectiveRecord` |
| Webhook delivery | `WorkflowWebhookDeliveryStatus`, `WorkflowWebhookDeliveryRecord` (no URL, header or payload; `endpointLabel` is `null` once the endpoint is unregistered) |
| Form snapshot | `FormDefinitionSnapshot`, `WorkflowFormData` |
| Activity | `ActivityLogRecord` |
| Member | `MemberProfileRecord`, `MemberDirectoryPage` |
| Delegation | `DelegationScopeType`, `DelegationRuleStatus`, `DelegationRuleRecord` |
| Notification | `NotificationChannel`, `NotificationDigestMode`, `NotificationStatus`, `NotificationType`, `NotificationResolution`, `NotificationRecord` (incl. `silenced` — recorded but not announced), `NotificationPreferenceRecord` |
| Attachment / Signature | `AttachmentRecord`, `SignatureRecord`, `SignatureVerificationRecord` |
| Template embed | `ApprovalTemplateRecord`, `ApprovalTemplateVersionRecord` |
| Dashboard | `WorkflowDashboardSummaryRecord` |

### Queries

| Name | Purpose |
|---|---|
| `listApprovalInstances()` | All instances (unpaginated) |
| `listApprovalInstancesPage({ view, state, searchText, page, pageSize })` | Paginated list (shared by inbox / sent / cc / search) |
| `readApprovalInstance(id)` | One full instance with all relations |
| `readLaunchContext(templateId)` | Launch-page bootstrapping data |
| `listLaunchableTemplates()` | Templates the current member may launch |
| `listInboxTasks(memberId)` | My pending tasks |
| `listMemberOpenTasks(memberId)` | Administrator: the open tasks a member holds on running instances (assignee, or a PENDING / CLAIMED / WAITING candidate seat), with `memberRole` and `candidateStatus` |
| `listApprovalHistoryTasks(memberId)` | My historical decisions |
| `readWorkflowDashboardSummary({ currentMemberId, from, to })` | Dashboard metrics. The four instance counts (`activeInstanceCount`, `completedInstanceCount`, `rejectedInstanceCount`, `totalInstanceCount`) cover the instances the member can read within the range; `pendingTaskCount` / `overdueTaskCount` count only the member's own to-dos — the same set as `listInboxTasks`, so sequential `WAITING` candidates and a settled countersign vote are not counted — narrowed to those instances |
| `listTaskDecisions(taskId)` | All decisions on one task |
| `listAttachments(instanceId)` | Attachment list |
| `readAttachmentDownloadUrl / PreviewUrl({ ... })` | Signed download/preview URLs |
| `readInstanceSignatures(id)` | Signature/verification records |
| `listAdhocDirectives(instanceId)` | Ad-hoc directives recorded on one instance |
| `listWorkflowWebhookDeliveries(instanceId)` | Notify-node webhook deliveries of one instance, oldest first (administrator-only) |

### Mutations

| Name | Purpose |
|---|---|
| `submitApprovalInstance({ ... })` | Launch a new instance. The service command also takes an optional `submittedByMemberId` (who actually pressed submit when it is not the applicant); the GraphQL mutation always sets it to the signed-in member and does not accept it as input. Absent means the initiator. Nodes with `excludeInitiator` keep that member out of their approvers exactly like the initiator; the instance exposes it as `ApprovalInstance.submittedByMemberId` (nullable — `null` on rows written before the column existed means "the initiator submitted it"), and `INSTANCE_STARTED` carries it in its payload. A distinct submitter can read the instance (detail, timeline, attachments) and finds it in the `SENT` and ordinary readable lists, but resubmit and cancel stay initiator-only; the initiator's `INSTANCE_COMPLETED` notification then reads "…已完成。（由 X 代為送出）" and its payload carries `submittedByMemberId` and the rendered sentence `submittedByNote` (the built-in body is `…已完成。{{submittedByNote}}`; both keys are absent, and the body unchanged, when the initiator submitted it themselves). The name is looked up once at submit, before the submit transaction, and recorded as `submittedByName` on `INSTANCE_STARTED` (absent when the initiator submitted); the lookup (`NotificationService.readMemberDisplayName(memberId)`, public so the engine can call it before opening the transaction; call it outside any transaction) falls back to the member id on error or after 2 s, and completion reads that record instead of calling the identity source inside the approval transaction |
| `decideTask({ ... })` | Decide a task (`action`: APPROVED / REJECTED / RETURNED / TRANSFERRED) |
| `cancelApprovalInstance({ ... })` | Cancel an instance |
| `resubmitApprovalInstance({ ... })` | Re-submit after return |
| `uploadAttachment({ ... })` | Multipart upload |
| `requestAdhocCountersign({ taskId, target, comment? })` | Ad-hoc countersign — parallel task joins the next user task |
| `requestAdhocPreApproval({ taskId, target, onReject, comment? })` | Ad-hoc pre-approval — blocks the current stage until approved |
| `configureAdhocStageNotification({ taskId, target, channels? })` | Notify targets when the current stage ends (any outcome) |
| `configureAdhocCompletionNotification({ taskId, target, channels? })` | Notify targets when the instance reaches a terminal state |
| `cancelAdhocDirective(directiveId)` | Withdraw a still-pending ad-hoc directive |
| `retryWorkflowWebhookDelivery(id)` | Re-queue an attempted `FAILED` webhook delivery under the same id (administrator-only) |
| `reassignTask({ taskId, fromMemberId, toMemberId, reason, dryRun? })` | Administrator: move one open seat of a task to another member in place. The task id does not change and no decision or signature is written. The node's `allowTransfer` does not apply: it limits the holder, not the administrator. A refusal rejects with the error code in the message unless `dryRun` is set, which reports the outcome and writes nothing |
| `reassignMemberTasks({ fromMemberId, toMemberId, reason, dryRun? })` | Administrator: move every open task a member holds, one transaction and one result per task; a refused task does not stop the others |

### Member helpers (in workflow subpath)

`resolveMemberProfiles(ids)`, `searchMembers(query)`, `listMemberDirectoryPage({ ... })`.

### Delegation

`listDelegationRules({ ... })`, `listDelegationRulesPage({ ... })`, `createDelegationRule({ ... })`, `revokeDelegationRule({ ... })`.

### Notification

`listNotifications({ ... })` (accepts `includeArchived`; not yet released: `beforeId` keyset paging and `changedSince`, and `NotificationRecord.updatedAt`), `readUnreadNotificationCount(memberId)`, `readNotificationSummary()` (not yet released; `NotificationSummaryRecord` — `{ unreadCount, latestUpdatedAt }`), `markNotificationRead({ ... })`, `markNotificationsRead({ ids })` (not yet released; resolves to the ids that changed), `markAllNotificationsRead({ ... })`, `archiveNotifications({ ids })`, `unarchiveNotifications({ ids })`, `readNotificationPreference(memberId)`, `updateNotificationPreference({ ... })`.

### Pure helpers

| Name | Purpose |
|---|---|
| `readApprovalInstanceCaseTitle(instance)` | Display title from an instance |
| `readFormDataCaseTitle({ ... })` | Display title from form data before submission; skips table fields and labels a table value as `N 列` |

---

# 📦 `@rytass/bpm-core-nestjs-module`

NestJS module, entities, services, migrations. Embedded via `BPMRootModule`.

## Module entry

| Name | Kind | Purpose |
|---|---|---|
| `BPMRootModule` | NestJS Module | Embed everything in one import |
| `BPMRootModuleOptions` / `BPMRootModuleAsyncOptions` | interface | Host wiring. **Every field is optional** — `forRoot()` and `forRootAsync()` boot with no arguments. Wiring-time only (never from `useFactory`, because Nest reads them while building routes, the schema, and handler metadata): `memberResolverProvider`, `attachmentStorageProvider`, `businessCalendarProvider`, `formDataSourceRegistryProvider`, `workflowServiceTaskDispatcherProvider`, `workflowWebhookRegistryProvider`, `resolverMetadataFactory`, `attachmentRoutePrefix`, `identityRegisterResolvers`, `imports`, `inject`. Everything else lives on `BPMRootRuntimeOptions` and can come from `useFactory`. |
| `BPMRootRuntimeOptions` | interface | Everything settable at runtime: the flattened notification/attachment/signature/identity options, `authContextFactory`, the flattened workflow-webhook options (`workflowWebhookTargetSources`, `workflowWebhookAllowedUrlPatterns`, `workflowWebhookEnforceAllowlistForRegistry`, `workflowWebhookSecretEncryptionKey`, and the `workflowWebhookDelivery*` scheduler/retry/timeout settings), `organizationTimeZone` (IANA zone in which organization effective dates are read; default `Asia/Taipei`, see the organization section), and ready instances `memberResolver`, `attachmentStorage`, `businessCalendar`, `formDataSourceRegistry`, `workflowServiceTaskDispatcher`, `workflowWebhookRegistry`. This is exactly what a `forRootAsync` `useFactory` returns, and it is embedded in `BPMRootModuleOptions` too, so a setting moves between `forRoot` and `forRootAsync` without reshaping. Prefer an instance over its `*Provider` twin whenever the value needs a secret. |
| `BPMRootModuleAsyncFactoryOptions` | type (deprecated) | Alias of `BPMRootRuntimeOptions` |
| `BPM_ROOT_OPTIONS` | injection token | The resolved `BPMRootRuntimeOptions`. BPM resolves the host `useFactory` **once** and publishes it here; every BPM sub-module reads this one token. Previously each sub-module called the host factory itself (five times per boot), so an instance-constructing factory handed a different instance to each consumer. |
| `BPMRootOptionsModule` / `BPMRootOptionsModuleAsyncOptions` | Module / interface | Global module publishing `BPM_ROOT_OPTIONS`; wired for you by `BPMRootModule` |
| `buildTypeOrmModuleOptions(config)` | function | Build TypeORM options including migrations |
| `BPM_CORE_MIGRATIONS` | const | 28-class migration array |
| `AllExceptionsFilter` | ExceptionFilter | Unified GraphQL/REST exception filter |

## `@rytass/bpm-core-nestjs-module/bpm-auth`

Auth contract layer — lib does not own auth; host plugs in.

| Name | Kind | Purpose |
|---|---|---|
| `BPMAuthContext` | interface | Current-user context the host provides |
| `BPMAuthContextFactory` | type | Host callback that produces the `BPMAuthContext` for a request |
| `BPMAuthContextAccessor` | interface | Reads the current auth context (bound to `BPM_AUTH_CONTEXT_ACCESSOR`) |
| `BPM_AUTH_CONTEXT_ACCESSOR`, `BPM_AUTH_MODULE_OPTIONS` | injection token (`Symbol`) | Accessor binding and resolved module options |
| `BPMAuthModule` | Module | Auth contract module |
| `BPMAuthModuleOptions`, `BPMAuthModuleAsyncOptions` | interface | Module options (e.g., `authContextFactory`) and their async variant |
| `readAuthenticatedBPMContext()` | async function | Read the current auth context, failing when there is none |
| `BPMAuthenticatedGuard`, `BPMAdminGuard`, `BPMDesignerGuard` | Guard | Route protection for any signed-in member, administrators, and designers |
| `BPMAuthenticated()`, `BPMAdminOnly()`, `BPMDesignerOnly()` | decorator | Class or method decorators that set the guard requirement |
| `BPMCurrentAuthContext()`, `BPMCurrentMemberId()` | parameter decorator | Inject the current auth context or member id into a resolver argument |
| `isBPMAdmin()`, `isBPMDesigner()` | function | Role predicates behind the admin and designer guards |
| `BPMResolverAccessLevel` | type | `'admin' \| 'designer' \| 'authenticated'` — the authority BPM's own guards require for one handler |
| `BPMResolverHandlerDescriptor` | interface | `{ access, resolverName, methodName }` describing one BPM GraphQL handler |
| `BPMResolverMetadataFactory` | type | Host callback returning the route metadata to stamp on a handler |
| `applyBPMResolverMetadata(factory)` | function | Replays a factory over every registered BPM handler, writing metadata onto the prototype method a guard receives as `context.getHandler()`. Called for you by `BPMRootModule` when `resolverMetadataFactory` is set. |
| `listBPMResolverHandlers()` | function | Every handler the factory will be offered — used to build a host permission map |
| `registerBPMResolverClassAccess`, `registerBPMResolverMethodAccess` | function | Internal registration used by BPM's own authorization decorators |
| `withBPMResolverAccess(access, decorate)` | function | Wraps a BPM authorization decorator so the decorated class/method joins the registry |

## `@rytass/bpm-core-nestjs-module/identity`

| Name | Kind | Purpose |
|---|---|---|
| `BPM_MEMBER_RESOLVER`, `MEMBER_RESOLVER` (deprecated alias) | injection token | Host identity source. Optional since the zero-configuration round — BPM registers `defaultMemberResolverProvider` when the host supplies neither `memberResolver` nor `memberResolverProvider` |
| `DefaultBPMMemberResolver` | class | Built-in fallback resolving every member to its own id, so BPM boots without a directory. Names are raw ids and emails are empty, so email notifications through it go nowhere; it warns once at construction outside `development` / `test` |
| `defaultMemberResolverProvider` | provider | Registers `BPM_MEMBER_RESOLVER`, preferring a `memberResolver` instance published under `BPM_ROOT_OPTIONS` and otherwise `DefaultBPMMemberResolver` |
| `BPMMemberResolver`, `MemberResolver` (deprecated alias) | interface | Resolver contract — `resolve`/`resolveMany`/`search?`/`searchPaged?` |
| `BPMMemberSearchPage`, `BPMMemberSearchPageOptions` | interface | Paged-search result (`items` + `total`) and 1-based page request for `searchPaged?` |
| `BPMRootIdentityOptions` | interface | Host-facing identity options: `identityMemberMetadataCacheTtlMs`, and `identityRegisterResolvers` (default `true`; set `false` when the host already publishes `member` / `members` / `memberCount` / `searchMembers`, keeping `IdentityService` without the colliding GraphQL fields) |
| `BPMResolvedIdentityOptions`, `DEFAULT_BPM_IDENTITY_OPTIONS`, `BPM_IDENTITY_OPTIONS` | interface / const / injection token | Resolved identity options, their defaults, and the token that carries them |
| `resolveBPMIdentityOptions()` | function | Apply defaults to a `BPMRootIdentityOptions` |
| `MemberNotFoundException` | exception | Raised when a member id cannot be resolved |
| `BPMMemberBaseDirectory`, `BPMMemberBaseSearchPage` | interface | Host directory contract (incl. optional `searchMembersPaged`) and its host-shaped page |
| `BPMMemberBaseAdapterOptions`, `BPMMemberBaseResolverProviderOptions` | interface | Field readers + provider options for the member-base adapter |
| `BPMMemberBaseResolverAdapter` | class | Adapts a `BPMMemberBaseDirectory` into a `BPMMemberResolver` (exposes `searchPaged` only when the directory implements `searchMembersPaged`) |
| `createBPMMemberBaseResolverProvider`, `createBPMAuthContextFromMemberBaseMember`, `readMemberMetadataFromMemberBaseMember` | function | Provider factory, auth-context projector, and metadata reader |

## `@rytass/bpm-core-nestjs-module/organization`

| Category | Names |
|---|---|
| Entities | `OrgUnitEntity`, `PositionEntity`, `MembershipEntity`, `ManagerResolutionEntity` |
| ObjectTypes | `OrgUnitRetirementImpactObject`, `OrgUnitTreeCommitResultObject`, `OrganizationSummaryObject`, `ResolvedManagerObject` |
| Enums | `OrgUnitTypeEnum`, `ManagerResolutionScopeTypeEnum` |
| DTOs | `CreateOrgUnitInput`, `UpdateOrgUnitInput`, `CommitOrgUnitTreeDraftInput`, `CommitOrgUnitTreeDraftMoveInput`, `CreatePositionInput`, `UpdatePositionInput`, `CreateMembershipInput`, `UpdateMembershipInput`, `CreateManagerResolutionInput`, `UpdateManagerResolutionInput` |
| Service | `OrganizationService`, `DeleteOrgUnitOptions` |
| Time zone | `BPMRootOrganizationOptions` (the `organizationTimeZone` root option), `DEFAULT_BPM_ORGANIZATION_TIME_ZONE`, `resolveBPMOrganizationTimeZone(value)` (validates and applies the default; throws on an unknown zone), `formatDateOnlyInTimeZone(date, timeZone)` (the `YYYY-MM-DD` date an instant falls on in a zone) |
| Module | `OrganizationModule` |
| GraphQL | `OrganizationQueries`, `OrganizationMutations` |

> GraphQL-nullable fields on these inputs are **optional** in TypeScript
> (`parentId?: string | null`). Exactly five of them are genuinely three-state
> — omitting the field and passing `null` do different things:
>
> | Field | omitted | `null` |
> |---|---|---|
> | `UpdateOrgUnitInput.parentId` | keep the current parent | move to the top level |
> | `UpdateMembershipInput.positionId` | keep the current position | clear the position |
> | `UpdateMembershipInput.effectiveTo` | keep the current end date | clear the end date |
> | `UpdateManagerResolutionInput.effectiveTo` | keep the current end date | clear the end date |
> | `UpdateApprovalTemplateInput.categoryId` | keep the current category | detach the category |
>
> On every other field (`code`, `name`, `type`, `description`, …) the service
> reads `input.x ?? existing.x`, so `null` and omission are equivalent — those
> are optional only so a caller can leave out what it is not changing.
>
> `UpdateOrgUnitInput.metadataJson` and `UpdatePositionInput.metadataJson` are
> a known wart rather than a contract: the service tests them for truthiness
> (`input.metadataJson ? parse(...) : existing.metadata`), so metadata can be
> replaced but never emptied — `'{}'` works, `''` and `null` are both read as
> "unchanged".
>
> `OrganizationService.deletePosition(id)` hard-deletes a position and refuses
> while anything still references it (`PositionEntity` has no `deleted_at`):
>
> 1. a membership (also a real foreign key);
> 2. a `POSITION`-scoped manager resolution;
> 3. a non-`ARCHIVED` approval template version whose workflow definition
>    routes approvers through it (`POSITION` / `ORG_UNIT_POSITION`);
> 4. a `PENDING` ad-hoc directive on a running instance whose `targetKind` is
>    `POSITION`.
>
> Checks 3 and 4 read `jsonb`, where no foreign key can stand in for them, and
> are skipped when the template / workflow tables are absent — so an
> `OrganizationModule`-only host is unaffected. Exposed as the `deletePosition`
> GraphQL mutation and as `deletePosition(id)` in
> `@rytass/bpm-core-client/organization`.
>
> `OrganizationService.deleteOrgUnit(id, { transferToOrgUnitId? })` (successor retirement is not yet released; see Release status) retires a
> unit with a soft delete. It always refuses while live child units remain. It
> also refuses while the unit has **open** memberships or open
> `ORG_UNIT`-scoped manager rules — open meaning `effectiveTo` is empty or
> today or later in `organizationTimeZone`, which includes rows that only start
> later — unless `transferToOrgUnitId` names a live successor. With one, in a
> single transaction: a membership that already started is ended yesterday and
> continued in the successor from today (unless the member already holds that
> position there); a membership starting today or later is moved as it is; the
> unit's open manager rules are ended, and ones that never took effect are
> removed. Ended rows never block the delete and stay pointing at the retired
> unit as history. The refusal message still starts with
> `Org unit with memberships cannot be deleted`.
> `readOrgUnitRetirementImpact(id)` (GraphQL `orgUnitRetirementImpact`) returns
> the three counts so a UI can ask for the successor before deleting; the
> admin organization view does exactly that.

`effectiveFrom` / `effectiveTo` are plain dates, so "is this membership or
manager rule in force?" needs a notion of *today*, and that depends on the
zone. BPM reads today in the `organizationTimeZone` root option (an IANA name,
default `Asia/Taipei`, BPM's business time zone) everywhere it compares against
those two columns: the workflow engine's `ORG_MANAGER`, `ORG_MANAGER_CHAIN`,
`POSITION`, org-unit member and org-unit position resolvers, the
initiator-manager replacement, the default initiator snapshot, the engine's dry run,
`OrganizationService.resolveManagerMemberId` (SLA escalation and notification
use it) and the `activeOnly` membership and manager resolution listings. A host
whose organization dates are kept in UTC sets `organizationTimeZone: 'UTC'`. An
unknown zone makes BPM fail at startup. Stored effective dates and the
`startAt` / `endAt` / `createdAt` timestamps are untouched. This is separate
from `notificationSlaBusinessCalendarTimeZone` (SLA business days); a host may
set both to the same value.

Before this option the workflow engine read the UTC date (so between 00:00 and
08:00 in UTC+8 a rule effective from today did not apply yet) while
`OrganizationService` already read `Asia/Taipei`. Both now follow the option;
the `OrganizationService` reading is unchanged for a host that sets nothing, and
the engine's moves from UTC to `Asia/Taipei`.

> **Compatibility change.** A host that sets nothing gets a different approver
> resolution in one window: for a membership or manager rule whose
> `effectiveFrom` or `effectiveTo` is today, the engine now applies or retires
> it from local midnight in `Asia/Taipei`, up to eight hours earlier than
> before. A host whose organization dates are kept in UTC, or that relied on
> the engine's UTC reading, sets `organizationTimeZone: 'UTC'` before
> upgrading. Instances already running keep the tasks they have; only
> resolutions made after the upgrade read the new date.

Known limitation: the template designer's browser-side dry-run snapshot
(`readTodayDateOnlyString` in `TemplateDesignerView`) builds its simulated
initiator from the browser's UTC date, because the client has no access to the
host's `organizationTimeZone`. Between local midnight and the UTC offset that
preview can disagree with the engine's dry run and with real runs for a
membership effective from today.

## `@rytass/bpm-core-nestjs-module/form`

| Category | Names |
|---|---|
| Entities | `FormDefinitionEntity`, `FormDefinitionVersionEntity` |
| DTOs | `CreateFormDefinitionInput`, `UpdateFormDefinitionInput`, `UpdateFormDefinitionDraftInput`, `PublishFormDefinitionContentInput`, `LintFormSchemaInput` |
| Objects | `FormSchemaLintResult`, `FormSchemaLintResultObject` |
| Functions | `lintFormSchemaJson()`, `parseAndValidateFormSchemas()`, `ParsedFormSchemas` (type), `EMPTY_FORM_SCHEMA`, `EMPTY_FORM_UI_SCHEMA` |
| Enums | `FormDefinitionListStatusEnum`, `FormDefinitionVersionStatusEnum` |
| Service | `FormService` |
| Module | `FormModule` |

> `FormService.createFormDefinition` / `updateFormDefinitionDraft` /
> `publishFormDefinitionVersion` / `publishFormDefinitionContent` accept an
> optional trailing `manager?: EntityManager` (backward-compatible) so they can
> join an outer transaction. Used by
> `TemplateService.composeApprovalTemplateWithForm`.
>
> Form definitions keep no draft in parallel with a published version: before
> the first publish the single draft is updated in place; afterwards
> `publishFormDefinitionContent` publishes a brand-new version directly
> (content-identical saves are a no-op returning the current version).

## `@rytass/bpm-core-nestjs-module/form-data-source`

Versioned host registry and guarded runtime boundary for dynamic form options.

| Category | Names |
|---|---|
| Contract | `BPMFormDataSource`, `BPMFormDataSourceDescriptor`, `BPMFormDataSourceParameter`, `BPMFormDataSourceParameterType`, `BPMFormDataSourceControl`, `BPMFormDataSourceRevalidationPolicy` |
| Requests | `BPMFormDataSourceSearchRequest`, `BPMFormDataSourceResolveRequest`, `BPMFormDataSourceSearchResult`, `BPMFormDataSourceResolveFieldInput` (optional `rowValues` for a table cell), `BPMFormDataSourceSnapshotResolutionInput` |
| Registry | `BPMFormDataSourceRegistry`, `BPM_FORM_DATA_SOURCE_REGISTRY`, `EmptyBPMFormDataSourceRegistry`, `StaticBPMFormDataSourceRegistry`, `defaultFormDataSourceRegistryProvider` (prefers a `formDataSourceRegistry` instance from `BPM_ROOT_OPTIONS`, else an empty catalog) |
| Snapshot resolver | `BPMFormDataSourceValueResolver`, `BPM_FORM_DATA_SOURCE_VALUE_RESOLVER` |
| Module | `FormDataSourceModule`, `FormDataSourceModuleOptions` |
| Service | `FormDataSourceService`, `BPMFormDataSourceOptionResult`, `BPMFormDataSourceResolveResult` |
| Service inputs | `BPMFormDataSourcePreviewInput`, `BPMFormDataSourceRuntimeInput`, `BPMFormDataSourcePreviewResolveInput`, `BPMFormDataSourceRuntimeResolveInput` — all four accept an optional `rowValuesJson`, and their `fieldKey` accepts a `<tableKey>.<columnKey>` schema path |
| Errors | `BPM_FORM_DATA_SOURCE_ERROR_CODES`, `BPMFormDataSourceErrorCode`, `BPMFormDataSourceException`, `BPMFormDataSourceForbiddenException` |
| GraphQL objects | `FormDataSourceParameterObject`, `FormDataSourceDescriptorObject`, `FormFieldOptionObject`, `FormDataSourceOptionsResultObject`, `FormDataSourceResolveResultObject` |
| GraphQL inputs | `PreviewFormFieldOptionsInput`, `RuntimeFormFieldOptionsInput`, `PreviewResolveFormFieldOptionsInput`, `RuntimeResolveFormFieldOptionsInput` |
| Resolver | `FormDataSourceQueries` (`formDataSources`, `previewFormFieldOptions`, `formFieldOptions`, `previewResolveFormFieldOptions`, `resolveFormFieldOptions`) |

`formDataSources`, `previewFormFieldOptions` and `previewResolveFormFieldOptions`
require designer permission; `formFieldOptions` and `resolveFormFieldOptions`
require authentication.

`resolveFormFieldOptions` / `previewResolveFormFieldOptions` are the read-only
counterpart to the submit-time resolve. They confirm already-selected values and
report the ones the source can no longer account for in `unresolvedValues`
instead of throwing, so a renderer can mark dead options individually. The
authoritative resolve behind `submitApprovalInstance` /
`resubmitApprovalInstance` is unchanged and stays all-or-nothing: one value the
provider no longer offers fails the whole submission with
`FORM_DATA_SOURCE_VALUE_NOT_RESOLVED`.

Both option results carry `waitingForFieldKeys`. When a required parameter has
no value, the service returns that field-key list and never calls the provider,
rather than raising `FORM_DATA_SOURCE_WAITING_FOR_DEPENDENCIES` at the query
boundary. A required parameter no binding feeds, or one fed by an empty
constant, remains `FORM_DATA_SOURCE_INVALID_BINDING` — nobody can fix that by
typing.

Every field on all four GraphQL inputs carries a `@MaxLength` bound (schema JSON
262 144, form-data JSON 65 536, values JSON 8 192, cursor 512, field key 256,
search text 200, identifiers 128). An over-long input is rejected with the
stable `FORM_DATA_SOURCE_INVALID_BINDING` code, never a class-validator
sentence describing the limits.

`FORM_DATA_SOURCE_VALUE_NOT_RESOLVED` marks a submitted value that is no longer
selectable, and stays distinct from `FORM_DATA_SOURCE_INVALID_PROVIDER_RESULT`
(a host provider contract breach) so renderers can tell a bad selection apart
from a broken source. A host without a registered registry keeps working for
static forms, but publishing or submitting a DataSource-backed field fails with
`FORM_DATA_SOURCE_MISSING` instead of silently skipping validation.
`formFieldOptions` and `resolveFormFieldOptions` derive the referenced source
from the published template version or returned-instance snapshot; clients cannot
submit an arbitrary source reference or binding definition. Both runtime inputs
require **exactly one** of `templateId` (launch context) or `instanceId` (a
returned instance being edited) — passing both, or neither, is
`FORM_DATA_SOURCE_RUNTIME_CONTEXT_FORBIDDEN`. An instance being resubmitted must
be addressed by `instanceId` alone so its options resolve against its own form
definition snapshot rather than whatever version the template publishes today.

## `@rytass/bpm-core-nestjs-module/template`

| Category | Names |
|---|---|
| Entities | `ApprovalTemplateEntity`, `ApprovalTemplateVersionEntity`, `ApprovalTemplateCategoryEntity` |
| DTOs | `CreateApprovalTemplateInput`, `UpdateApprovalTemplateInput`, `UpdateApprovalTemplateDraftInput`, `CreateApprovalTemplateCategoryInput`, `UpdateApprovalTemplateCategoryInput`, `ComposeApprovalTemplateWithFormInput` |
| Objects | `ComposeApprovalTemplateWithFormObject` (the client's result type is `ComposeApprovalTemplateWithFormResult`) |
| Functions | `parseWorkflowDefinitionJson()`, `lintWorkflowDefinition()`, `WorkflowDefinitionLintResult` (type), `EMPTY_WORKFLOW_DEFINITION` |
| Enums | `ApprovalTemplateListStatusEnum`, `ApprovalTemplateActivationStatusEnum`, `ApprovalTemplateCategoryStatusEnum`, `ApprovalTemplateVersionStatusEnum`, `BPMTemplateChangeActionEnum` |
| Service | `TemplateService` |
| Token | `BPM_TEMPLATE_OBSERVER` + `BPMTemplateObserver` / `BPMTemplateChangedEvent` / `BPMTemplateChangeActionEnum` (host observes template changes, for audit) |
| Module | `TemplateModule` |

> `composeApprovalTemplateWithForm` mutation (`ComposeTemplateMutations`) builds
> and optionally publishes a form definition together with the approval template
> that binds it, atomically in a single DB transaction. The `publish` flag
> toggles draft-only vs. publish-both. `TemplateService` methods
> (`createApprovalTemplate` / `updateApprovalTemplateDraft` /
> `publishApprovalTemplateVersion` / `forkApprovalTemplate`) accept an optional
> trailing `manager?: EntityManager` for this composition (backward-compatible).

**Publish-time member reference check.** `publishApprovalTemplateVersion` also
checks every `DYNAMIC_FORM` resolver against the bound form version: each user
task `approverResolver.formPath` and each NOTIFY `action.recipients.formPath`
must equal the `fieldKey` of a `member` (人員選擇) field, otherwise publish fails
with `workflow.nodes.<id>.approverResolver.formPath must reference a member
(人員選擇) field of the bound form: <path>` (or `...action.recipients.formPath`).
The field must also be one the submit validation guarantees a value for —
`required: true`, no `visibleWhen`, not `hidden` — otherwise publish fails with
`<path> must reference a required member field that no visibility rule or
hidden flag can leave empty: <fieldKey>`. A path that names no member field, or
a member field left empty, resolves to nobody at runtime and throws while the
task or notification is created; on a node past the first one that throw lands
inside the previous approver's decision, which could then never commit. The
designer still lists such fields, marked with the reason publishing refuses them.

> **Compatibility change.** This check is new: a `DYNAMIC_FORM` resolver whose
> `formPath` points at a non-member field can no longer be published. Such a
> draft could only be written through the API or the AI assistant before the
> `member` field type existed. It still saves as a draft
> (`updateApprovalTemplateDraft` does not run the check), but publishing it now
> fails until the path is re-pointed at a member field.
> Versions published before the check are not re-validated.

**Template lifecycle.** `ApprovalTemplateEntity.isActive` (column `is_active`,
`NOT NULL DEFAULT true`, matching `ApprovalTemplateCategoryEntity`) takes a
template out of service without deleting it or archiving its published version.
`TemplateService` adds `activateApprovalTemplate(id)` /
`deactivateApprovalTemplate(id)`, mirroring the existing category pair, and
`listApprovalTemplates` accepts `activationStatus` typed as the new
`ApprovalTemplateActivationStatusEnum` (`ACTIVE` / `ALL` / `INACTIVE`, shaped
like `ApprovalTemplateCategoryStatusEnum`). This is deliberately **not**
`ApprovalTemplateListStatusEnum` — `DRAFT` / `PUBLISHED` is derived from version
state, an orthogonal dimension. Omitting `activationStatus` means `ALL`, so
existing callers are unaffected and admin screens still see deactivated
templates in order to reactivate them.

**Template category writes go through the relation.**
`ApprovalTemplateEntity.categoryId` and `ApprovalTemplateEntity.categoryDetail`
map to the same `category_id` column, and TypeORM gives the relation precedence
on persist. `categoryId` is therefore declared `insert: false, update: false` —
it is a read-only projection, still usable for reading and in `where` clauses.
Code that persists a category change must assign `categoryDetail`; assigning
`categoryId` is silently discarded. **This includes `repository.update()`** —
`UpdateQueryBuilder` skips columns declared `update: false` without raising, so
`update({ id }, { categoryId })` becomes a no-op rather than an error. Direct
writers should either call `TemplateService.updateApprovalTemplate()` (which
also restores the category validation) or set the relation. `TemplateService.createApprovalTemplate` and
`updateApprovalTemplate` re-read the row before returning, so their result never
reports a `categoryId` that disagrees with `categoryDetail`.

**Deleting a referenced category throws (breaking).**
`TemplateService.deleteApprovalTemplateCategory(id)` previously degraded into a
*deactivation* when templates still referenced the category: it returned
successfully, the category survived, and its `isActive` flag was flipped as a
side effect the caller never asked for. It now raises `BadRequestException`
naming the number of referencing templates, and leaves the category untouched.
Callers that want the old outcome should call
`deactivateApprovalTemplateCategory(id)`, which has always existed — so no
capability is lost, only the silent substitution.
>
> A deactivated template rejects `submitApprovalInstance` **and**
> `resubmitApprovalInstance` with `ConflictException('Approval template is
> deactivated')`. The guard runs right after the template is loaded, ahead of
> form-data validation, so callers get the lifecycle reason rather than a
> misleading field error. `launchableApprovalTemplates` filters deactivated
> templates out. Instances already in flight are unaffected — they run from
> `workflowSnapshot`.

`publishApprovalTemplateVersion` and `rollbackApprovalTemplateVersion` apply
the same guard: a deactivated template cannot gain a new published version or
move its published pointer, and both raise
`ConflictException('Approval template is deactivated')`.
`composeApprovalTemplateWithForm` inherits it through its publish step, so
`publish: true` on a deactivated template is refused while a draft-only compose
still succeeds. Before this the engine refused to *run* a deactivated template
while the designer happily published onto it — the same user action behaved
differently depending on which button was pressed.

**Audit hook.** `BPM_TEMPLATE_OBSERVER` exists so a host can answer "who
changed the approval flow, and when". BPM registers
`publishApprovalTemplateVersion`, `rollbackApprovalTemplateVersion` and
`composeApprovalTemplateWithForm` on the same GraphQL schema as the host's own
resolvers, and the embedded `<WorkflowDesigner>` calls them directly, so
without this hook the only way to notice a template change is a global
interceptor matching those field names — coupling the host to BPM's schema
rather than to an interface.

One `onTemplateChanged(event)` fires per host-facing mutation, carrying
`action` (`COMPOSED` / `VERSION_PUBLISHED` / `VERSION_ROLLED_BACK`), the
resulting `template` and `version`, the `previousVersionId` the template
pointed at beforehand, whether the version is now `published`, and
`actorMemberId`. A compose that also publishes reports a single `COMPOSED`
event with `published: true`, so a host never has to de-duplicate two events
for one change. `manager` is present only when the change was written inside a
caller-supplied transaction and is therefore **not committed yet**, exactly as
in `BPM_NOTIFICATION_OBSERVER`. Observer failures are logged and swallowed: an
audit sink must not be able to fail the mutation it observes.

`rollbackApprovalTemplateVersion` now takes an optional trailing
`rolledBackByMemberId`, supplied by the mutation from `@BPMCurrentMemberId()`,
so the rollback event names an actor.

## `@rytass/bpm-core-nestjs-module/workflow-engine`

Workflow execution engine — the heaviest module.

| Category | Names |
|---|---|
| Entities | `ApprovalInstanceEntity` (incl. `formDataOptionSnapshot` / `formDataOptionSnapshotJson` and the nullable `businessKey`), `TaskEntity` (incl. `isAdhoc` / `adhocType` / `adhocOriginTaskId` / `adhocDirectiveId` / `slaStartedAt` / `nodeLabel`), `TaskDecisionEntity`, `TaskCandidateEntity` (incl. `sequence`; status `WAITING` = not this candidate's turn yet in a `SEQUENTIAL` task, and `ActivityLogEventTypeEnum.TASK_CANDIDATE_ACTIVATED` is logged when the turn passes), `WorkflowTokenEntity`, `ActivityLogEntity`, `AdhocDirectiveEntity` |
| DTOs | `SubmitApprovalInstanceInput`, `DecideTaskInput`, `CancelApprovalInstanceInput`, `ResubmitApprovalInstanceInput`, `DryRunApprovalWorkflowInput`, `AdhocTargetInput`, `AdhocNotificationInput`, `ReassignTaskInput`, `ReassignMemberTasksInput` |
| Objects | `ApprovalInstancePageInfoObject`, `WorkflowDryRunResultObject`, `WorkflowDryRunStepObject`, `WorkflowDashboardSummaryObject`, `TaskReassignmentResultObject` (fields `taskId`, `instanceId`, `nodeId`, `outcome`, `errorCode`, `message`; the engine's plain shape is the interface `TaskReassignmentResult`), `MemberOpenTaskObject` |
| Engine | `WorkflowEngineService` (incl. `findApprovalInstanceByBusinessKey`, `requestAdhocCountersign` / `requestAdhocPreApproval` / `configureAdhocNotification` / `cancelAdhocDirective` / `listAdhocDirectives`, `reassignTask` / `reassignMemberTasks` / `listMemberOpenTasks`), `evaluateWorkflowEdgeCondition()`, `WorkflowConditionContext` |
| Decision options | `DecideTaskOptions` (engine-internal knobs kept out of the GraphQL schema), `ExpireApprovalInstanceCommand` (`instanceId`, optional `comment`, `nodeId`, `taskId`; the input of `WorkflowEngineService.expireApprovalInstance`, which SLA `TERMINATE_INSTANCE` calls), `ReassignTaskOptions` (`actorMemberId`, `fromMemberId`, `toMemberId`, `reason`, `dryRun`; the options of `WorkflowEngineService.reassignTask` / `reassignMemberTasks`), the engine's plain return shapes `TaskReassignmentResult` (interface, same name as the GraphQL object) and `MemberOpenTaskRecord`, `MANUAL_TRANSFER_DELEGATION_REASON`, `ADMIN_REASSIGN_DELEGATION_REASON` (`'ADMIN_REASSIGN'`, the delegation-chain reason of an administrator reassignment; its step carries `actorMemberId` and `comment`, both optional on `DelegationStep`) |
| Business key | `MAX_APPROVAL_INSTANCE_BUSINESS_KEY_LENGTH` (200 characters, counted as code points) |
| Tokens | `BPM_WORKFLOW_ENGINE_SERVICE` (typed by the `BPMWorkflowEngineService` interface: `cancelApprovalInstance`, `decideTask`, `expireApprovalInstance`), `BPM_WORKFLOW_SERVICE_TASK_DISPATCHER` |
| Service tasks | `BPMWorkflowServiceTaskDispatcher`, `BPMWorkflowWebhookDispatchInput`, `BPMWorkflowWebhookDispatchResult`, `DefaultWorkflowServiceTaskDispatcher` (`fetch`-based) |
| Enums | `ApprovalInstanceStateEnum`, `ApprovalInstanceListViewEnum`, `WorkflowTokenStatusEnum`, `TaskStatusEnum`, `TaskAssignmentTypeEnum`, `TaskCandidateStatusEnum`, `TaskDecisionActionEnum`, `AdhocDirectiveTypeEnum`, `AdhocDirectiveStatusEnum`, `AdhocTargetKindEnum`, `AdhocPreApprovalRejectBehaviorEnum`, `MemberTaskRoleEnum`, `TaskReassignmentOutcomeEnum`, `TaskReassignmentErrorCodeEnum`. `ActivityLogEventTypeEnum` gains `INSTANCE_EXPIRED` (an SLA `TERMINATE_INSTANCE` ended the instance; no actor, the overdue task's `nodeId` / `taskId`) and `TASK_REASSIGNED`, written once per administrator reassignment with `actorMemberId`, `fromMemberId`, `toMemberId`, `reason`, `assigneeChanged`, `candidateStatus` and `sequence` in its payload |
| Module | `WorkflowEngineModule`, `WorkflowEngineModuleOptions` |

`WorkflowEngineService` picks its dispatcher rather than reading a registered
default: a binding under `BPM_WORKFLOW_SERVICE_TASK_DISPATCHER` first (the
host's own provider, or `workflowServiceTaskDispatcherProvider`), then the
`workflowServiceTaskDispatcher` runtime value, then the built-in `fetch`
dispatcher. `WorkflowEngineModule.forRoot` deliberately registers nothing when
the host passes no provider — a module-local default would shadow a token the
host bound from its own global module, silently sending WEBHOOK service tasks
through `fetch` instead of the host's signing or queueing dispatcher.

Note that Nest builds **two** `WorkflowEngineService` instances:
`FormDataSourceModule` imports the plain `WorkflowEngineModule` class while
`BPMRootModule` imports `WorkflowEngineModule.forRoot(...)`, and a dynamic
module gets its own instance. `workflowServiceTaskDispatcherProvider` therefore
configures only the copy it is registered on; the `workflowServiceTaskDispatcher`
runtime value reaches both, because the service resolves it from the global
`BPM_ROOT_OPTIONS`.

GraphQL surface added by the ad-hoc feature: mutations `requestAdhocCountersign`, `requestAdhocPreApproval`, `configureAdhocStageNotification`, `configureAdhocCompletionNotification`, `cancelAdhocDirective`; query `adhocDirectives(instanceId)`. Countersign / pre-approval are gated by the node's `allowAddSigner` flag and only affect the single instance (never the template).

### Business key (host document ↔ instance)

A host that submits instances from its own documents (a purchase order, say)
labels each one with a **business key** instead of tucking it into `form_data`.

- **Service layer only.** `WorkflowEngineService.submitApprovalInstance` takes an
  optional `businessKey?: string | null`. The GraphQL `submitApprovalInstance`
  input has no such field and the mutation always passes `businessKey: null`, so
  an end user can never claim a key. `ApprovalInstance.businessKey` is a
  nullable read-only GraphQL field.
- **Normalised.** The key is trimmed; empty or whitespace-only becomes `null`;
  more than 200 characters, counted as code points (`MAX_APPROVAL_INSTANCE_BUSINESS_KEY_LENGTH`) is a
  `BadRequestException` (`業務鍵長度不可超過 200 個字元`).
- **Unique per template.** The partial unique index
  `approval_instances_business_key_key` on `(template_id, business_key) WHERE
  business_key IS NOT NULL` is the only arbiter: instances without a key never
  conflict with each other, and the same key on another template is fine. A
  second submit with the same `(template, key)` is a `ConflictException`
  (`此範本已有相同業務鍵（<key>）的簽核單`), raised by translating the unique
  violation of the insert rather than by a pre-check, so two concurrent submits
  cannot both succeed.
- **State does not matter.** A CANCELLED or REJECTED instance still holds its
  key, and the engine never frees one on its own; what a rejected or cancelled
  document may do next (submit again under a new key, say) is the host's call.
- **Immutable.** Resubmitting a returned instance, returning, and cancelling all
  leave the key unchanged; there is no API to change it after submit.
- **Lookup.** `findApprovalInstanceByBusinessKey(templateId, businessKey)`
  returns the instance (any state) or `null`; the key is trimmed first and a
  blank or over-long key, or a `templateId` that is not a uuid, returns `null`
  without querying. There is deliberately
  no GraphQL query or `@rytass/bpm-core-client` wrapper: hosts call the service
  directly, like every other engine lookup that is not an end-user screen.

## `@rytass/bpm-core-nestjs-module/workflow-webhook`

NOTIFY webhook endpoints (ADR 18): the host-facing catalog, the designer query, the URL allowlist, the publish rules that need the catalog, and the delivery outbox.

| Category | Names |
|---|---|
| Registry | `BPMWorkflowWebhookRegistry`, `BPM_WORKFLOW_WEBHOOK_REGISTRY`, `EmptyBPMWorkflowWebhookRegistry`, `StaticBPMWorkflowWebhookRegistry`, `defaultWorkflowWebhookRegistryProvider` (prefers a `workflowWebhookRegistry` instance from `BPM_ROOT_OPTIONS`, else an empty catalog) |
| Endpoint contract | `BPMWorkflowWebhookEndpoint` (`descriptor` + `buildRequest`), `BPMWorkflowWebhookEndpointDescriptor` (P6 adds optional `disabled`), `BPMWorkflowWebhookParameter`, `BPMWorkflowWebhookRequest`, `BPMWorkflowWebhookEvent`, `readWorkflowWebhookEndpointKey` |
| Sources | `BPMWorkflowWebhookEndpointSource` (`get(key, version, manager?)`), `BPMWorkflowWebhookEndpointSourceKind` (`'REGISTRY' \| 'DATABASE'`), `BPMWorkflowWebhookEndpointEntry` |
| Service | `WorkflowWebhookService` (`hasEndpointSources` / `hasDatabaseSource` / `listEndpoints` / `getEndpoint(key, version, manager?)` (P6: an optional transaction manager so the engine's enqueue reuses its connection) / `listRegistryEndpoints` / `isEndpointUrlAllowedAtPublish` (P6: a database endpoint's current URL against the allowlist) / `readOptions`), `ListWorkflowWebhookEndpointsOptions`, `readRegistryDescriptorErrors` |
| Database source (P6) | `DatabaseWorkflowWebhookEndpointSource` (reads `workflow_webhook_endpoints` on every lookup, decrypts headers and the signing secret per attempt; a disabled row is returned flagged `disabled` and `deprecated`), `WorkflowWebhookEndpointEntity` / `WorkflowWebhookStoredParameter` (table `workflow_webhook_endpoints`), `WorkflowWebhookEndpointAuditEntity` / `WorkflowWebhookEndpointAuditActionEnum` (table `workflow_webhook_endpoint_audits`; field names only, never values) |
| Encryption (P6) | `WorkflowWebhookSecretCipher` (AES-256-GCM, envelope `v1:<base64(iv \| tag \| ciphertext)>`), `parseWorkflowWebhookSecretKey` (32 bytes as 64 hex or base64; anything else throws at boot) |
| Endpoint administration (P6) | `WorkflowWebhookEndpointAdminService` (`list` / `listAudits` / `create` / `update` / `setActive` / `rotateSecret` / `testSend`; validates key, version, parameters, headers, timeout and the URL against the allowlist, refuses a key a registered endpoint uses and a changed parameter contract, rate-limits test sends per endpoint and process), `CreateWorkflowWebhookEndpointData`, `UpdateWorkflowWebhookEndpointData`, `WorkflowWebhookEndpointHeaderData`, `WorkflowWebhookEndpointParameterData`, `readWorkflowWebhookHeaderNames`, `WORKFLOW_WEBHOOK_TEST_MIN_INTERVAL_MS` / `WORKFLOW_WEBHOOK_TEST_WINDOW_MS` / `WORKFLOW_WEBHOOK_TEST_MAX_PER_WINDOW` |
| Endpoint administration GraphQL (P6) | `WorkflowWebhookEndpointAdminResolver` (administrator-only: `workflowWebhookEndpointManagement`, `workflowWebhookManagedEndpoints`, `workflowWebhookEndpointAudits(endpointId)`, `createWorkflowWebhookEndpoint(input)`, `updateWorkflowWebhookEndpoint(input)`, `setWorkflowWebhookEndpointActive(id, active)`, `rotateWorkflowWebhookEndpointSecret(id, signingSecret)`, `testWorkflowWebhookEndpoint(id)`), inputs `CreateWorkflowWebhookEndpointInput` / `UpdateWorkflowWebhookEndpointInput` / `WorkflowWebhookEndpointHeaderInput` / `WorkflowWebhookEndpointParameterInput`, objects `WorkflowWebhookManagedEndpointObject` (header names and `hasSigningSecret` only), `WorkflowWebhookEndpointAuditObject`, `WorkflowWebhookEndpointTestResultObject`, `WorkflowWebhookEndpointManagementObject` |
| Options | `BPMRootWorkflowWebhookOptions`, `BPMResolvedWorkflowWebhookOptions`, `BPM_WORKFLOW_WEBHOOK_OPTIONS`, `DEFAULT_BPM_WORKFLOW_WEBHOOK_OPTIONS`, `resolveBPMWorkflowWebhookOptions`, `readDisabledWorkflowWebhookSourceReason`, `resolveAndReportWorkflowWebhookOptions` (resolves and logs why a requested `DATABASE` source was dropped; used by `WorkflowWebhookOptionsModule`) |
| Allowlist | `parseWorkflowWebhookUrlPattern`, `parseWorkflowWebhookUrlPatterns`, `isWorkflowWebhookUrlAllowed`, `isInternalHostname`, `ParsedWorkflowWebhookUrlPattern`, `WorkflowWebhookUrlPatternParseResult`, `WorkflowWebhookUrlScheme` |
| Publish lint | `lintWorkflowWebhookTargets`, `LintWorkflowWebhookTargetsInput` (P6 adds optional `isEndpointUrlAllowed`, reported as `WORKFLOW_WEBHOOK_URL_NOT_ALLOWED`) |
| Errors | `BPM_WORKFLOW_WEBHOOK_ERROR_CODES` (P6 adds `DATABASE_SOURCE_DISABLED`, `ENDPOINT_DISABLED`, `ENDPOINT_KEY_CONFLICT`, `ENDPOINT_INVALID`, `ENDPOINT_CONTRACT_CHANGED`, `TEST_RATE_LIMITED`), `BPMWorkflowWebhookErrorCode`, `BPMWorkflowWebhookException` |
| GraphQL | `WorkflowWebhookQueries` (`workflowWebhookEndpoints(includeDeprecated)`, designer-only), `WorkflowWebhookEndpointObject` (P6 adds `disabled`), `WorkflowWebhookParameterObject`, `WorkflowWebhookEndpointSourceEnum` (GraphQL enum `BPMWorkflowWebhookEndpointSource`), `WorkflowWebhookParameterTypeEnum` (GraphQL enum `BPMWorkflowWebhookParameterType`) |
| Delivery | `WorkflowWebhookDeliveryService` (`enqueueNotifyWebhooks` inside the engine transaction, `deliverDue` for the scheduler, `deliverByIds` after commit, `listInstanceDeliveries`, `retryFailedDelivery` (an attempted `FAILED` row → `PENDING` with `attemptCount` 0; a row that failed while being queued is refused, a `WEBHOOK_DELIVERY_RETRIED` activity log in the same transaction, then an immediate attempt after commit), `readEndpointLabel`, `sendTestEvent` (P6: one event through the normal checks without a delivery row), `readRetryDelay`, `readCurrentTime`), `WorkflowWebhookTestOutcome`, `WorkflowWebhookDeliverySubscriber` (TypeORM subscriber that releases queued ids on commit and drops them on rollback), `WorkflowWebhookDeliverySchedulerService`, `BPM_WORKFLOW_WEBHOOK_FETCH` / `WorkflowWebhookFetch` (HTTP client, defaults to global `fetch`) |
| Observability | `WorkflowWebhookDeliveryResolver` (administrator-only `workflowWebhookDeliveries(instanceId)` and `retryWorkflowWebhookDelivery(id)`), `WorkflowWebhookDeliveryObject` (GraphQL `BPMWorkflowWebhookDelivery`; no frozen event, parameters or token id) |
| Outbox record | `WorkflowWebhookDeliveryEntity` (table `workflow_webhook_deliveries`, not a GraphQL type), `WorkflowWebhookFrozenEvent`, `WorkflowWebhookDeliveryStatusEnum` (GraphQL enum `BPMWorkflowWebhookDeliveryStatus`), `WORKFLOW_WEBHOOK_DELIVERY_ERROR_CODES` (P6 adds `ENDPOINT_DISABLED` → `WEBHOOK_ENDPOINT_DISABLED`), `WorkflowWebhookDeliveryErrorCode` |
| Enqueue | `buildWorkflowWebhookDeliveryDrafts`, `WorkflowWebhookEnqueueContext`, `WorkflowWebhookDeliveryDraft` |
| Delivery options | `BPMResolvedWorkflowWebhookDeliveryOptions`, `WORKFLOW_WEBHOOK_MAX_TIMEOUT_MS` (30 s cap on any single request) |
| Module | `WorkflowWebhookModule`, `WorkflowWebhookModuleOptions`, `WorkflowWebhookOptionsModule`, `WorkflowWebhookOptionsModuleAsyncOptions` |

The catalog carries **no URL, header or secret**, whichever source an endpoint came from: the browser only ever sees key, version, label, description, parameters and source. `buildRequest()` is called once per delivery attempt rather than at enqueue time, so a rotated credential reaches deliveries that are already queued.

Delivery never happens inside the engine transaction. `enqueueNotifyWebhooks` writes `PENDING` rows (or `FAILED` ones, with their terminal activity log, when the endpoint is gone, its lookup threw, or a parameter no longer fits); the subscriber kicks `deliverByIds` once that transaction commits, and the scheduler (on by default whenever an endpoint is registered; `workflowWebhookDeliverySchedulerEnabled` overrides) retries the rest. Each attempt calls `buildRequest()`, refuses non-http(s) URLs and — for `DATABASE` endpoints, or all endpoints under `workflowWebhookEnforceAllowlistForRegistry` — URLs outside the allowlist, refuses a URL carrying credentials, a method other than `POST`/`PUT`/`PATCH` and a `buildRequest()` result without a string `url`, then sends with `redirect: 'manual'` and a timeout. Each row is re-stamped as its own attempt starts and written back only while that stamp still matches, so a row another worker reclaimed is never sent twice by this one nor overwritten by its late result. `2xx` is `SENT`; `408`/`429`/`5xx`, timeouts, network errors, a throwing `buildRequest()` and a throwing endpoint lookup retry with `base·2^(n−1)` backoff (±20 % jitter, never above the cap); other `4xx`, `3xx`, a missing endpoint and a refused URL fail at once. Rows are claimed at most five at a time and attempted together, the next five only once those finish, so a claimed row is always a row in flight and one receiver running into its timeout delays at most the other four in its group. Error details keep a host error's kind and a network error's system code, never a message that could quote the URL or a secret; at most 500 characters of a failing response body are kept, read from a 4 KB prefix, and NUL is stripped from every stored detail. An unexpected error inside BPM is recorded as `WEBHOOK_INTERNAL_ERROR` and retried. BPM sets `x-bpm-delivery-id`, `x-bpm-event` and, with a `signingSecret`, `x-bpm-timestamp` (the time of sending) and `x-bpm-signature-sha256 = HMAC-SHA256(secret, "<timestamp>.<body>")`; a host header cannot override any `x-bpm-*` header. Only the terminal outcome reaches the activity log (`SERVICE_TASK_EXECUTED` / `SERVICE_TASK_FAILED` with `action: 'NOTIFY_WEBHOOK'`, the endpoint key, version and label), and never the URL or response body. An administrator's retry adds `WEBHOOK_DELIVERY_RETRIED` (`ActivityLogEventTypeEnum`), carrying the acting member and the previous error code.

`workflowWebhookTargetSources` defaults to `['REGISTRY']`. `'DATABASE'` (P6) is dropped from the resolved list unless both `workflowWebhookAllowedUrlPatterns` and `workflowWebhookSecretEncryptionKey` are set; the module logs a warning naming whichever is missing (`resolveAndReportWorkflowWebhookOptions`). An invalid URL pattern throws while options resolve, so it fails the boot rather than silently allowing or denying everything.

## `@rytass/bpm-core-nestjs-module/condition`

| Name | Purpose |
|---|---|
| `ConditionService` | Condition-expression evaluation engine |
| `ConditionModule` | Module wrapper |

> `cel-js` is loaded on first parse, not at module import. Importing anything
> from the package root therefore no longer drags the ESM-only `cel-js` (and
> its `chevrotain` exports map, which `jest-resolve` cannot follow) into a
> host's jest run — consumer suites need no `moduleNameMapper` stub.

## `@rytass/bpm-core-nestjs-module/delegation`

| Category | Names |
|---|---|
| Entity | `DelegationRuleEntity` (`priority`: higher wins among a principal's matching active rules, ties go to the rule created first — the same direction as manager rules) |
| DTOs | `CreateDelegationRuleInput`, `UpdateDelegationRuleInput` |
| Enums | `DelegationRuleStatusEnum`, `DelegationScopeTypeEnum` |
| Service | `DelegationService` |
| Module | `DelegationModule` |

## `@rytass/bpm-core-nestjs-module/calendar`

Business-day SLA scheduling. BPMCore ships **no** national holiday data — hosts that need real working-day semantics register their own calendar.

| Category | Names |
|---|---|
| Service | `BPMSlaScheduleService` (`resolveTaskSlaDueAt({ node, now })`) |
| Contract | `BPMBusinessCalendar` (`timeZone` + `isBusinessDay(localDate)`) |
| Token | `BPM_BUSINESS_CALENDAR` (host injects the calendar source) |
| Default | `BPMWeekdayBusinessCalendar`, `defaultBusinessCalendarProvider` — prefers a `businessCalendar` instance from `BPM_ROOT_OPTIONS`, else Mon–Fri with no holidays. Supplying the instance instead of `businessCalendarProvider` also sidesteps the DI cycle described below, because the host's own factory builds it |
| Module | `CalendarModule`, `CalendarModuleOptions` (global; wired by `BPMRootModule`). Options now extend `Pick<ModuleMetadata, 'imports'>`, and `BPMRootModule` threads its own `imports` through, so a `useClass` / `useFactory` `businessCalendarProvider` can depend on host repositories or config services without a host-side `@Global()` module |

`SlaConfig.calendar: 'BUSINESS_DAY'` advances only the duration's **day** component across business days; an hour/minute component is added afterwards as plain elapsed time (the template linter warns when both are combined). Omitting `calendar` keeps the pre-0.7.0 elapsed-time behaviour.

**The calendar provider must not depend on BPM.** Because `BPMRootModule`
forwards its `imports` into `CalendarModule`, it is easy for a
`businessCalendarProvider` to reach a host service that itself depends on
`TemplateService` or another BPM provider. Nest cannot resolve the resulting
cycle **and does not report one**: the application simply never finishes
bootstrapping. There is no exception, nothing for `bootstrap().catch()` to
catch, no stack trace, and the process exits with code `0`; the last log line
is usually an unrelated `pg` deprecation warning. Confirming it means attaching
`async_hooks` and dumping promises still pending at `beforeExit`, where the
stacks point at `@nestjs/core/helpers/barrier.js`.

Keep the calendar's dependency chain to host-owned services that never reach
back into BPM. A calendar that needs BPM data should read it from its own
narrow, read-only service rather than from a BPM provider.

## `@rytass/bpm-core-nestjs-module/notification`

| Category | Names |
|---|---|
| Services | `NotificationService`, `NotificationDeliveryService` |
| Entities | `NotificationEntity`, `NotificationPreferenceEntity` — hosts needing cross-recipient reads (delivery statistics, audit) can now get the repository type-safely instead of looking it up by entity-name string |
| Objects | `NotificationSummaryObject` (GraphQL `NotificationSummary`: `unreadCount`, `latestUpdatedAt`) — not yet released |
| Const | `MARK_NOTIFICATIONS_READ_LIMIT` (`500`, the most distinct ids one `markNotificationsRead` call accepts) — not yet released |
| Token | `BPM_NOTIFICATION_DISPATCHER` (interface `BPMNotificationDispatcher`; host injects email/webhook adapter; optional `dispatchDigest(notifications, options)` for combined daily-digest sends) |
| Token | `BPM_NOTIFICATION_OBSERVER` + `BPMNotificationObserver` / `BPMNotificationsCreatedEvent` (host observes rows as they are created, every channel) |
| DTOs | `UpdateNotificationPreferenceInput` |
| Options | `BPMRootNotificationOptions`, `BPMResolvedNotificationOptions`, `DEFAULT_BPM_NOTIFICATION_OPTIONS`, `BPM_NOTIFICATION_OPTIONS`, `resolveBPMNotificationOptions()`, `NotificationOptionsModule`, `NotificationOptionsModuleAsyncOptions`, `NotificationFeatureToggle`, `NotificationTemplateEngine` |
| Enums | `NotificationChannelEnum`, `NotificationDigestModeEnum`, `NotificationResolutionEnum`, `NotificationStatusEnum`, `NotificationTypeEnum` |
| Schedule | `isWithinQuietHours`, `resolveQuietHoursEnd`, `resolveEmailReleaseAt`, `normalizeDigestHour`, `DEFAULT_EMAIL_DIGEST_HOUR`, `DEFAULT_QUIET_HOURS_TIME_ZONE`, `NotificationQuietHours`, `EmailReleaseOptions` (pure functions behind quiet-hours / digest scheduling) |
| Const | `SLA_ESCALATION_DELEGATION_REASON` (delegation-chain marker that makes SLA `ESCALATE` idempotent) |
| Module | `NotificationModule` |

**Realtime hook.** `BPM_NOTIFICATION_OBSERVER` fires after
`createNotifications` persists a batch, for **every** channel — including
`IN_APP`, which `BPM_NOTIFICATION_DISPATCHER` never sees because in-app
notifications have no delivery step. It exists so a host can drive SSE /
WebSocket push off the same rows BPM writes, instead of polling the table or
putting a trigger on it.

The observer receives the whole batch in one call, along with `type`,
`instanceId` and `taskId` lifted to the event so a host can route without
unpacking a row. A batch is always for **one recipient** — several rows mean
several channels, not several people, so a node assigned to three approvers
produces three events. It also receives the `EntityManager` when the rows were
written inside a caller-supplied transaction — in that case they are **not committed yet**, and a
host should defer its push until that transaction commits. The manager is absent
when BPM owned the write, meaning the rows are already durable. Observer
failures are logged and swallowed: a host's realtime push must never roll back
the approval that produced the notification.

**Recording vs announcing.** A member preference decides whether a
notification is *announced*; it no longer decides whether it is *recorded*.
`inAppEnabled: false` used to filter the channel out **before** the insert, so
silencing notifications for an afternoon destroyed every notification raised
in it — turning the preference back on recovered nothing. In-app rows are now
always written and carry `NotificationEntity.silenced`, set when the recipient
turned in-app off or the notification arrived inside their quiet hours. Hosts
driving a realtime channel should skip the toast or push for a silenced row and
still place it in the list. The bell badge counts silenced rows: they are
unread notifications, and a badge that ignored them would leave the member
opening an app full of entries that never announced themselves.

Dropping in-app rows entirely is still possible, but only as a wiring
decision: `notificationInAppEnabled: false` means "run BPM without notification
centre data" and is not something a member can trip. Email and webhook rows are
unchanged — they have no BPM-side record to lose, so `emailEnabled: false`
still means no row.

**Quiet hours and digests are enforced.** `quietHoursStart` / `quietHoursEnd`
and `emailDigestMode` were persisted and validated but read by nothing before
this. They now behave as their names claim:

- an email raised inside quiet hours has `nextRetryAt` set to the instant the
  window closes, so the existing delivery scan releases it afterwards — quiet
  hours **delay** a notification, never drop it;
- a recipient on `emailDigestMode: DAILY` has their email held until the next
  digest hour, and the delivery scan then sends **one** message covering every
  notification waiting for them (a lone notification is sent on its own rather
  than as a digest of one);
- an in-app notification arriving inside quiet hours is recorded with
  `silenced: true`.

Two options configure this. `notificationQuietHoursTimeZone` is the zone the
bare `HH:mm` preferences are read in. When it is omitted BPM reads the zone off
the registered `BPM_BUSINESS_CALENDAR` — the host's own calendar when it
supplied one, otherwise the built-in weekday calendar built from
`notificationSlaBusinessCalendarTimeZone` — and only falls back to `UTC` when
neither answers. Deferring to the calendar rather than to the flattened option
matters: a host that registers its own calendar never sets
`notificationSlaBusinessCalendarTimeZone` (BPM ignores it in that case), so
resolving the zone at wiring time would silently read a Taiwan
`20:00–08:00` window in UTC and silence the whole working afternoon.
`notificationEmailDigestHour` (default `9`) is the local hour a `DAILY`
recipient's held email is flushed. A window whose start equals its end counts
as *no* quiet hours rather than as all day.

Note that a held email needs something to release it: with
`notificationDeliverySchedulerEnabled: false` (the default) nothing scans for
due deliveries, so a host that enforces quiet hours should either enable the
scheduler in a worker process or call
`NotificationDeliveryService.deliverPendingNotifications` itself. Digest
merging is BPM's built-in SMTP behaviour; a host with its own
`BPM_NOTIFICATION_DISPATCHER` gets the hold either way and gets merging only if
it implements the optional `dispatchDigest`.

**Dispatch timeout.** Delivery claims a row into `DELIVERY_IN_PROGRESS` before
dispatching, and only the success and failure paths write back. A dispatch that
never settles would therefore park the row permanently, with `attemptCount` at
`0` and `deliveryError` empty — the one failure mode a host cannot see from the
table. `notificationDeliveryDispatchTimeoutMs` (default `30000`) bounds the
whole dispatch, host `BPM_NOTIFICATION_DISPATCHER`, member resolution and the
SMTP/webhook call included; exceeding it is recorded as an ordinary failed
attempt with `DELIVERY_TIMEOUT_<ms>MS` and retried on the normal schedule. Set
it to `0` to wait indefinitely.

**Archiving.** `NotificationEntity.archivedAt` separates *cleared from my list*
from *read* and from *deleted* — the row survives for statistics and audit.
`NotificationService` adds `archiveNotifications({ ids, memberId })` /
`unarchiveNotifications({ ids, memberId })` (both scoped to
`recipientMemberId`, so one member cannot archive another's notifications, and
both idempotent — re-archiving an archived row affects 0 rows).
`listNotifications` / `countNotifications` take `includeArchived?: boolean`,
defaulting to `false`, so existing callers are unaffected.
`countUnreadNotifications` **excludes** archived rows: otherwise the bell keeps
its badge after archiving and the action would be pointless. Archived and read
are independent dimensions — the archive filter is `archivedAt IS NULL`, not a
`status` value. GraphQL exposes `archiveNotifications(ids)` /
`unarchiveNotifications(ids)` mutations (member taken from
`@BPMCurrentMemberId()`, never a client argument) and an `includeArchived`
argument on the `notifications` / `notificationCount` queries.

**Paging, change detection and batch read (not yet released).** For hosts that
keep their own copy of a member's notifications (an SSE feed, a notification
centre) and must page and resync it cheaply:

- **Total order.** `listNotifications` orders by `createdAt DESC, id DESC`.
  Rows created in the same instant no longer swap places across offset pages.
- **Keyset paging.** `listNotifications({ beforeId })` returns the rows that
  sort after that notification — pass the last `id` of the previous page.
  The comparison runs in SQL against the cursor row's stored timestamp
  (microseconds; a JavaScript `Date` keeps only milliseconds), so it does not
  skip or repeat rows while new ones arrive. It refuses `page > 1`
  (`BadRequestException`), and a `beforeId` that is not one of the member's
  in-app notifications is a `NotFoundException`. GraphQL: `notifications(beforeId:)`.
- **`NotificationEntity.updatedAt`** — when any column of the row last
  changed: read, archived, unarchived, resolved, superseded, delivered. A
  database trigger stamps it (migration `NotificationUpdatedAt0000000028000`),
  only when a column actually changed, at millisecond precision so a watermark
  taken from it compares cleanly. BPM never writes it, so every update path —
  raw SQL included — advances it.
- **`changedSince`.** `listNotifications({ changedSince })` returns only rows
  whose `updatedAt` is later than the given time, and **ignores**
  `includeRead` / `includeArchived` — a row that was just read or archived is
  exactly the change a syncing host must see; read `status` / `archivedAt` on
  the returned rows. Combine with `beforeId` to page a large change set.
  `updatedAt` is stamped when the writing statement runs, which can precede
  its commit (a long approval transaction), so poll with a watermark a few
  seconds before the latest `updatedAt` already seen and de-duplicate by `id`.
  GraphQL: `notifications(changedSince:)`.
- **`readNotificationSummary(recipientMemberId)`** →
  `NotificationSummaryObject { unreadCount, latestUpdatedAt }`. `unreadCount`
  equals `countUnreadNotifications`; `latestUpdatedAt` is the latest
  `updatedAt` over all of the member's in-app rows, read and archived included,
  or `null` when there are none. One indexed `MAX` plus the badge count: poll
  it and re-read the list only when a value moved. GraphQL:
  `notificationSummary` (signed-in member).
- **`markNotificationsRead({ ids, readerMemberId })`** → the ids that
  actually changed, in the order given. One atomic `UPDATE … RETURNING id`
  scoped to `recipientMemberId = readerMemberId`, `channel = IN_APP` and
  `status <> READ`: ids that are blank, malformed, unknown, another member's,
  not in-app (an email row's status is its delivery state) or already read are
  skipped and absent from the result, so its length is the number of
  notifications this call turned read. More than
  `MARK_NOTIFICATIONS_READ_LIMIT` (500) distinct ids is a
  `BadRequestException`. GraphQL: `markNotificationsRead(ids): [String!]!`
  (member taken from `@BPMCurrentMemberId()`).
- `markNotificationRead` now re-reads the row after saving, so the returned
  entity carries the new `updatedAt`.

**Deploy order.** `NotificationEntity` now selects `updated_at` on every read
and returns it from every insert, so run `NotificationUpdatedAt0000000028000`
**before** deploying this version: without the column, every notification
query fails, and so does any approval transaction that creates a notification.
Deploy the API before a client or `bpm-core-react` build of this version —
their notification query asks for `updatedAt`.

The summary shares `changedSince`'s commit-lag blind spot, and adds one of its
own: archiving an already-read row leaves `unreadCount` unchanged, and a
lagging commit can leave `latestUpdatedAt` unchanged too. Treat the summary as
a cheap trigger, and keep an occasional `changedSince` poll with the overlap
window as the backstop.

## `@rytass/bpm-core-nestjs-module/attachment`

| Category | Names |
|---|---|
| Service | `AttachmentService` |
| Provider | `attachmentStorageProvider` (default: prefers an `attachmentStorage` instance from `BPM_ROOT_OPTIONS`, else `@rytass/storages-adapter-local` under `.storage/attachments`; a host with S3 or another adapter supplies its own through this provider or that runtime value) |
| Token | `ATTACHMENT_STORAGE` |
| DTOs | `UploadAttachmentInput` |
| Options | `AttachmentModuleOptions`, `AttachmentModuleAsyncOptions`, `BPMRootAttachmentOptions`, `BPMResolvedAttachmentOptions`, `DEFAULT_BPM_ATTACHMENT_OPTIONS`, `BPM_ATTACHMENT_OPTIONS`, `resolveBPMAttachmentOptions()` |
| Module | `AttachmentModule` |

> Every attachment option has a default, so a host can boot with none of them.
> An unset `attachmentSignedUrlSecret` makes each process generate a random
> 32-byte secret at boot and warn on stderr (silent under `NODE_ENV=test`);
> no signing secret ships in this package. A URL then only verifies on the
> process that signed it, so a host running more than one API replica sets a
> shared secret. An unset `attachmentPublicBaseUrl` builds each URL from the
> origin of the GraphQL request that asked for it (`X-Forwarded-Proto` /
> `X-Forwarded-Host`, else the request's protocol and `Host`), falling back to a
> root-relative path when there is no request.
>
> **Compatibility change.** Before this, `NODE_ENV=production` without a
> secret refused to boot, outside production the URLs were signed with the
> published value `bpm-core-local-attachment-url-key-v1`, and the base URL
> defaulted to `http://localhost:17603`. `attachmentAllowInsecureSignedUrlSecret`
> is now deprecated and ignored. `BPMResolvedAttachmentOptions.publicBaseUrl`
> is `string | null` (`null` = from the request), and
> `DEFAULT_BPM_ATTACHMENT_OPTIONS` no longer carries a `signedUrlSecret`.
> `AttachmentService.createSignedUrl` takes an optional `requestOrigin`.

## `@rytass/bpm-core-nestjs-module/signature`

| Category | Names |
|---|---|
| Service | `SignatureService` |
| Object | `SignatureVerificationObject` |
| Options | `BPMRootSignatureOptions`, `BPMResolvedSignatureOptions`, `DEFAULT_BPM_SIGNATURE_OPTIONS`, `BPM_SIGNATURE_OPTIONS`, `resolveBPMSignatureOptions()`, `BPMSignatureKeyProvider`, `BPMSignatureTimestampProvider`, `BPMSignatureTimestampInput` |
| Module | `SignatureModule` |

## `@rytass/bpm-core-nestjs-module/database`

| Name | Purpose |
|---|---|
| `buildTypeOrmModuleOptions(config)` | Wire BPM entities + migrations into host TypeORM |
| `BPM_CORE_MIGRATIONS` | Full 28-class migration list |

## `@rytass/bpm-core-nestjs-module/migrations`

29 ordered migrations:

1. `EnablePostgresExtensions0000000000001` — when `uuid-ossp` / `ltree` / `pg_trgm` are
   missing and the migration role has no CREATE privilege on the database, it
   fails with the SQL to run and who must run it, instead of a bare `42501`.
   `down()` is a no-op: the extensions may predate BPM. The `pg_trgm` check is
   not yet released; `WorkflowQueryIndexes0000000013000` still creates `pg_trgm`
   itself for databases migrated before it.
2. `IdentityOrganizationFoundation0000000001000`
3. `FormBuilderFoundation0000000002000`
4. `ApprovalTemplateFoundation0000000003000`
5. `WorkflowEngineFoundation0000000004000`
6. `DelegationRules0000000005000`
7. `NotificationsSla0000000006000`
8. `SignaturesAttachments0000000007000`
9. `ApprovalTemplateCategories0000000008000`
10. `TaskCandidates0000000009000`
11. `NotificationDeliveryState0000000010000`
12. `RemoveAttachmentEncryptionKey0000000011000`
13. `NotificationSlaIdempotency0000000012000`
14. `WorkflowQueryIndexes0000000013000`
15. `NotificationResolution0000000014000`
16. `BackfillStaleNotificationResolution0000000015000`
17. `ArchiveParallelFormDrafts0000000016000`
18. `AdhocDirectives0000000017000`
19. `NotificationArchive0000000018000` (adds `notifications.archived_at` + partial index on unarchived rows per recipient)
20. `ApprovalTemplateActivation0000000019000` (adds `approval_templates.is_active` + index)
21. `FormDataOptionSnapshots0000000020000` (adds `approval_instances.form_data_option_snapshot`, default `{}`)
22. `NotificationSilenced0000000021000` (adds `notifications.silenced`, `NOT NULL DEFAULT false`; existing rows were announced by definition)
23. `OrgUnitCodeActiveUnique0000000022000` — drops the global `UNIQUE` on
    `org_units.code` and replaces it with a partial unique index over
    `deleted_at IS NULL`. `deleteOrgUnit` soft-deletes and
    `assertOrgUnitCodeAvailable` ignores soft-deleted rows, so the old
    constraint disagreed with the service: recreating a closed department under
    its original code was cleared by BPM and then rejected by the driver with a
    raw `duplicate key value violates unique constraint "org_units_code_key"`,
    naming a row no query returns. Safe on an existing database (the dropped
    constraint already guaranteed the live rows do not collide); `down()`
    re-adds the global constraint, which the database rejects if any code has
    since been reused — free the duplicate codes first.
24. `WorkflowWebhookDeliveries0000000023000` (creates `workflow_webhook_deliveries`, the NOTIFY webhook outbox: unique `(token_id, target_id)` so a token cannot queue the same target twice, plus indexes for the pending scan and per-instance listing)
25. `WorkflowWebhookEndpoints0000000024000` (creates `workflow_webhook_endpoints` — database-managed NOTIFY webhook endpoints, unique `(key, version)`, `is_active` index, header values and signing secret only as AES-256-GCM envelopes — and `workflow_webhook_endpoint_audits`, which records who changed which fields and never a value)
26. `TaskCandidateSequence0000000025000` (adds nullable `task_candidates.sequence` — the 0-based signing order inside a `SEQUENTIAL` task — and nullable `tasks.sla_started_at`; existing rows are not backfilled, so in-flight tasks keep the behaviour they were created under. `down()` first turns `WAITING` candidates back into `PENDING` so no task is stranded)
27. `ApprovalInstanceBusinessKey0000000026000` (adds nullable `approval_instances.business_key` and the partial unique index `approval_instances_business_key_key` on `(template_id, business_key) WHERE business_key IS NOT NULL`; existing rows stay `NULL`, and the index ignores `state`. `down()` drops the index, then the column)
28. `ApprovalInstanceSubmittedBy0000000027000` (adds nullable `approval_instances.submitted_by_member_id` plus `IDX_approval_instances_submitted_by_created_desc` on `(submitted_by_member_id, created_at DESC)` so the `SENT` list's `initiator OR submitter` match stays indexed; existing rows stay `NULL`, which the engine reads as "the initiator submitted it". `down()` drops the index, then the column)
29. `NotificationUpdatedAt0000000028000` — not yet released. Adds `notifications.updated_at` (`timestamptz NOT NULL`, default `date_trunc('milliseconds', clock_timestamp())`), backfilled with each row's latest recorded timestamp (`GREATEST` of created / read / resolved / archived / sent / delivered / last-attempt, truncated to milliseconds); the `BEFORE UPDATE` trigger `TRG_notifications_updated_at` (function `bpm_notifications_touch_updated_at`) that advances it only when a column changed; and `IDX_notifications_recipient_updated_at` on `(recipient_member_id, updated_at)`. The backfill rewrites every notification row once. `down()` drops the index, trigger, function, then the column

---

# 📦 `@rytass/bpm-core-react`

React UI library. Four export families: root barrel (foundation + host integration widgets), `next` (Next.js wrapper), `views/*` (pure React page bodies — no layout shell), `pages/*` (Next.js Server Component shims).

**Integration model (0.4.0+)**: BPMCore does not ship a navigation shell or sidebar. Hosts own the `<Layout>` / `<Navigation>` chrome and mount BPM views inside their existing layout. The root barrel exports building blocks the host wires into its own nav (`useBPMMember`, `useBPMLogout`, `<BPMNotificationBellButton />`). See `docs/integration-guide.md` and `apps/client/src/app/_components/host-layout.tsx` for a reference host layout.

## `@rytass/bpm-core-react` (root)

### Providers / Hooks

| Name | Kind | Purpose |
|---|---|---|
| `Providers` | Component | Composes Mezzanine `CalendarConfigProviderMoment` + `AuthProvider` + `NotificationUnreadProvider` + `NotificationDrawerProvider` + mounts `<NotificationDrawer />` overlay |
| `AuthProvider` | Component | Wraps current-member context, handles login/logout |
| `AuthProviderProps` | interface | `publicPaths`, `loginPath`, etc. |
| `useAuth()` | hook | Current member + login/logout methods (internal-leaning surface) |
| `useBPMMember()` | hook | Host-facing alias of `useAuth().member` — current `ApiMember \| null` |
| `isBPMAdminMember(member)` | function | Mirrors the server's `@BPMAdminOnly()` rule (`BPM_ADMIN` role or `bpm:*` / `bpm:admin` / `bpm.admin` / `bpm:admin:*`) for showing administrator-only UI |
| `useBPMLogout()` | hook | Host-facing alias of `useAuth().logout` — `() => Promise<void>`, runs `logoutApi()` + redirect to `loginPath` |
| `RouterAdapter` | interface | Framework-agnostic router contract (pathname / push / replace / back / searchParams) |
| `RouterAdapterProvider` | Component | Inject host's RouterAdapter |
| `RouterAdapterProviderProps` | interface | Provider props |
| `useRouterAdapter()` | hook | Read current adapter |
| `defaultBrowserSearchParams()` | function | Fallback reader from `window.location.search` |
| `BPMRoutes` | interface | Path mapping every BPM view uses (dashboard / inbox / caseDetail / templates / admin / …; P6 adds `adminWebhookEndpoints`) |
| `BPMRoutesProvider` | Component | Override host BPM internal paths |
| `BPMRoutesProviderProps` | interface | `{ value?, children }` |
| `createDefaultBPMRoutes()` | function | Factory returning the default `BPMRoutes` literal map |
| `useBPMRoutes()` | hook | Read the active `BPMRoutes` (falls back to default when no provider) |
| `NotificationDrawerProvider` | Component | Drawer open/close context |
| `useNotificationDrawer()` | hook | Drawer state + open/close handlers (host wires its own trigger here) |
| `NotificationUnreadProvider` | Component | Polls unread notification count |
| `useNotificationUnread()` | hook | Unread count + refresh trigger (host wires its own badge here) |
| `formatDateTime(value)` | function | moment-based `YYYY-MM-DD HH:mm:ss` formatter |

### Reusable Components

| Name | Kind | Purpose |
|---|---|---|
| `BPMNotificationBellButton` | Component | Drop-in bell icon button for host nav — opens BPM `<NotificationDrawer />` + shows unread badge. Visual chrome: Mezzanine `NavigationIconButton` (decoupled from `<Navigation>` container, usable anywhere). |
| `BPMNotificationBellButtonProps` | interface | `{ label? }` — override aria-label / tooltip (defaults to `通知中心`). |
| `NotificationDrawer` | Component | Mezzanine Drawer + NotificationCenter (overlay portal; mounted by `<Providers>`) |
| `ApprovalInstanceListPage` | Component | Shared list page body (inbox / sent / cc / search). Returns content fragment — host wraps in its own layout. |
| `ApprovalInstanceListPageProps` | interface | `{ defaultState, description, emptyMessage, searchPlaceholder, title, view }` |
| `DashboardPage` | Component | Five-metric workflow dashboard (content fragment); takes no props, so it has no props type |
| `BPMFormField` | Component | Mezzanine FormField wrapper (TIGHT / HORIZONTAL defaults) |
| `MemberPicker` / `OrgUnitPicker` / `PositionPicker` | Component | Picker components for admin pages |
| `readMemberOption()` / `readOrgUnitOption()` / `readPositionOption()` | function | record → picker option |
| `MemberOption` / `OrgUnitOption` / `PositionOption` | type | Picker value types |

**Not exported from the root barrel** (deliberately): `PDFPreview`,
`PDFPreviewProps`, `configurePdfWorker()`, `OrgUnitTreeDraftEditor`,
`OrgUnitTreeDraftEditorHandle` and `OrgUnitTreeDraftEditorState` live in
`src/components/` but stay internal. Re-exporting them would pull `react-pdf` /
`pdfjs-dist` into the root entry, which every host loads — including the ones
that never mount a PDF preview and have not installed those optional peers.
They reach hosts through the views that use them (`views/instances/detail`,
`views/admin/orgs`).

## `@rytass/bpm-core-react/next`

| Name | Kind | Purpose |
|---|---|---|
| `BPMNextProviders` | Component | One-line layout wrapper: reads `next/navigation` hooks → builds RouterAdapter → composes Providers inside a Suspense boundary |

## `@rytass/bpm-core-react/next/workflow-chat-route`

Server route handler for the template-designer LLM assistant. The host wires it in one line (`apps/client/src/app/api/chat/route.ts` → `export const POST = createWorkflowChatPOST()`). Holds the OpenAI key, runs `streamText`, declares `WORKFLOW_TOOLSET` as tools with **no `execute`** (forwarded to the browser). Talks to OpenAI directly via `@ai-sdk/openai` (no AI Gateway); reads `OPENAI_API_KEY` (server-only) and `BPM_LLM_MODEL` (optional OpenAI model id, default `gpt-5.4-mini`).

| Name | Kind | Purpose |
|---|---|---|
| `createWorkflowChatPOST` | function | Build the Next.js `POST(request)` handler; opts `{ model?, system? }` |
| `buildWorkflowAiSdkTools` | function | Convert `WORKFLOW_TOOLSET` (JSON Schema) → AI SDK `ToolSet` (no execute) |
| `WORKFLOW_CHAT_SYSTEM_PROMPT` | const | Strict design-only guardrail prompt (zh-TW) |
| `WorkflowChatRouteOptions` | interface | `{ model?, system? }` |

> The chat UI itself (`WorkflowChatDrawer`, `useWorkflowChat`, `useWorkflowDesignerController`) is internal to the isolated `views/templates/designer` entry and not separately exported.

## Views (pure React, require a RouterAdapter)

### Group barrels (preferred for most consumers)

| Subpath | Includes |
|---|---|
| `views/workflow` | `InboxView`, `SentView`, `CcView`, `SearchView` |
| `views/instances` | `InstanceNewView` (detail stays isolated due to weight) |
| `views/templates` | `TemplatesView`, `TemplateCategoriesView`, `TemplateVersionsView` (designer isolated) |
| `views/settings` | `SettingsNotificationsView` |
| `views/admin` | `AdminUsersView`, `AdminOrgsView`, `AdminDelegationsView`, `AdminWebhookEndpointsView` |

### Leaf subpaths (one view each)

| Subpath | View |
|---|---|
| `views/login` | `LoginView`, `LoginViewProps` |
| `views/dashboard` | `DashboardView` |
| `views/inbox` | `InboxView` |
| `views/sent` | `SentView` |
| `views/cc` | `CcView` |
| `views/search` | `SearchView` |
| `views/delegations` | `DelegationsView` |
| `views/admin/users` | `AdminUsersView` |
| `views/admin/orgs` | `AdminOrgsView` (carries `OrgUnitTreeDraftEditor`) |
| `views/admin/delegations` | `AdminDelegationsView` |
| `views/admin/webhook-endpoints` | `AdminWebhookEndpointsView` |
| `views/settings/notifications` | `SettingsNotificationsView` |
| ~~`views/root`~~ | `RootView` exists in the source but has **no `exports` entry and no Vite entry** — it is not importable and not published. It is a null placeholder; the root path is served by `pages/root`, which redirects to `/dashboard` on the server. |

### Heavy views (must stay isolated, fat dependencies)

The packages below are declared as **optional** `peerDependencies` in
`libs/bpm-core-react/package.json` (`peerDependenciesMeta`). A host only has to
install the ones matching the heavy views it actually mounts; hosts that mount
none are not warned about missing peers. The version ranges pin what the
monorepo builds against, so upgrading `@rytass/bpm-core-react` now signals when
a peer needs bumping too.

Optional peers: `@xyflow/react`, `dagre`, `@codemirror/lang-json`,
`@codemirror/view`, `@uiw/react-codemirror`, `@hello-pangea/dnd`, `pdfjs-dist`,
`react-pdf`, `next`, `ai`, `@ai-sdk/react`, `@ai-sdk/openai`.

**"Optional" is a peer declaration, not a bundler behaviour.** The views import
these statically, so a host that mounts the subpath and has not installed its
peers fails the build with `Module not found` — the table below is the install
list, not a suggestion. The non-optional peers (`@mezzanine-ui/react`,
`@mezzanine-ui/core`, `@mezzanine-ui/icons`, `react`, `react-dom`,
`@rytass/bpm-core-client`, `@rytass/bpm-core-shared`) are needed by every host,
and `@mezzanine-ui/core` also carries the styles — see
`docs/11-consumer-quickstart.md` §B.1a for the SCSS entry.

| Subpath | View | Heavy peerDeps |
|---|---|---|
| `views/instances/detail` | `InstanceDetailView`, `InstanceDetailViewProps` (now toggles each section via `showForm` / `showAttachments` / `showTasks` / `showSignatures` / `showHistory` / `showWebhookDeliveries`; the webhook section is only ever shown to administrators, and only when the instance queued deliveries), plus the standalone section components `InstanceFormSection`, `InstanceAttachmentsSection`, `InstanceTasksSection` (+ `InstanceTasksSectionHandle`, `AdhocActionMode`; handle adds `canAddSignerCurrentTask` / `openAdhocModal(mode)`, props add `adhocDirectives`), `InstanceSignaturesSection`, `InstanceHistorySection`, `InstanceWebhookDeliveriesSection` (status, attempts, last error and a confirmed retry for attempted `FAILED` rows) and their `*Props` | `@xyflow/react`, `dagre`, `react-pdf`, `pdfjs-dist` (attachment preview) |
| `views/instances/new` | `InstanceNewView` | medium |
| `views/templates/compose` | `TemplateComposeWizardView`, `TemplateComposeWizardViewProps` (opt-in `showAiAssistant` / `aiAssistantAvailable` surface the Step 1 embedded-designer AI assistant), `useTemplateComposeWizard`, `TemplateComposeWizard`, `ComposeWizardStep`, `ComposePublishPhase` | embeds designer + builder (`@xyflow/react`, `@codemirror/*`, `dagre`, `@hello-pangea/dnd`, `ai`, `@ai-sdk/react`) |
| `views/templates/designer` | `TemplateDesignerView`, `TemplateDesignerViewProps` (now supports `embedded` / `formSchemaOverride` / `initialWorkflowDefinition` / `initialInitiatorPolicyCel` / `onWorkflowChange` / `onInitiatorPolicyChange` for wizard reuse) | `@xyflow/react`, `@codemirror/*`, `dagre`, `@hello-pangea/dnd`, `ai`, `@ai-sdk/react` (the AI assistant is hidden by default but `WorkflowChatDrawer` is a static import, so both are needed to build) |
| `views/templates/categories` | `TemplateCategoriesView` | normal |
| `views/templates/versions` | `TemplateVersionsView` | normal |
| `views/forms/builder` | `FormBuilderView` — controlled panel (`value` / `onChange` only; no standalone page mode). Embedded by the template designer and compose wizard; its option-field editor loads the host catalog, filters by capability, edits field/constant bindings, preserves references on field rename, and requires confirmation for source/mode/dependent-field impact before applying changes | `pdfjs-dist`, `@codemirror/*`, `@hello-pangea/dnd` |
| `views/forms/renderer` | `FormRenderer`, `FormRendererView`, `FormRendererProps`, `FormRendererDataSourceContext`, `FormDataSourceFieldState` (now carries `canRetry`, false when there is no query to re-issue), `UseFormDataSourceFieldInput` (adds the table-cell inputs `fieldPath`, `snapshotKey` and `row`), `UseFormDataSourceFieldRow`, `useFormDataSourceField()`, `readFormDataSourceFieldStatusMessage()`, `isFormDataSourceFieldSubmissionBlocked()`, `readFormDataSourceSubmissionBlockMessage()` (picks wait-vs-fix copy for a refused submission) | normal |
| `views/admin/users` / `orgs` / `delegations` | `AdminUsersView` / `AdminOrgsView` / `AdminDelegationsView` | orgs carries `OrgUnitTreeDraftEditor` |
| `views/admin/webhook-endpoints` | `AdminWebhookEndpointsView` (database-managed notify webhook endpoints: create / edit / new version / disable / rotate secret / test send / change history; values write-only) | — |
| `views/settings/notifications` | `SettingsNotificationsView` | normal |

## Pages (Next.js Server Component shims)

20 subpaths. Each exports `{ default, metadata }`. Consumer's `app/<route>/page.tsx`:

```ts
export { default, metadata } from '@rytass/bpm-core-react/pages/<feature>';
```

| Subpath | Route | Async | Async reason |
|---|---|---|---|
| `pages/root` | `/` | No | server-side `redirect('/dashboard')` |
| `pages/login` | `/login` | Yes | reads `?next=` |
| `pages/dashboard` | `/dashboard` | No | — |
| `pages/inbox` | `/inbox` | No | — |
| `pages/sent` | `/sent` | No | — |
| `pages/cc` | `/cc` | No | — |
| `pages/search` | `/search` | No | — |
| `pages/delegations` | `/delegations` | No | — |
| `pages/instances/detail` | `/instances/[id]` | Yes | `params.id` → `instanceId` |
| `pages/instances/new` | `/instances/new` | Yes | reads `?templateId=` |
| `pages/templates` | `/templates` | No | — |
| `pages/templates/categories` | `/templates/categories` | No | — |
| `pages/templates/compose` | `/templates/compose` | Yes | `await connection()` (forces dynamic rendering), reads `BPM_AI_ASSISTANT_ENABLED` / `OPENAI_API_KEY` → Step 1 designer AI assistant |
| `pages/templates/designer` | `/templates/[id]/designer` | Yes | `params.id` → `templateId` |
| `pages/templates/versions` | `/templates/[id]/versions` | Yes | `params.id` → `templateId` |
| `pages/settings/notifications` | `/settings/notifications` | No | — |
| `pages/admin/users` | `/admin/users` | No | — |
| `pages/admin/orgs` | `/admin/orgs` | No | — |
| `pages/admin/delegations` | `/admin/delegations` | No | — |
| `pages/admin/webhook-endpoints` | `/admin/webhook-endpoints` | No | — |

---

## Appendix: remaining exports (names only)

Each name below is exported by the entry point named in its heading but has no row in a table above. The definition file is the source of truth for its signature. Names are grouped by entry point so the inventory stays complete.

### `@rytass/bpm-core-shared`

`WorkflowDirectory`, `WorkflowDirectoryItem`

### `@rytass/bpm-core-shared/workflow-toolset`

`WorkflowDirectory`, `WorkflowDirectoryItem`

### `@rytass/bpm-core-nestjs-module`

`AttachmentStorage`, `BPMDatabaseConnectionOptions`, `CelEvaluationContext`, `DelegationResolution`, `DelegationResolutionContext`, `SignTaskDecisionInput`, `SignatureModuleAsyncOptions`, `buildBPMDataSourceOptions`, `buildDataSourceOptionsFromVaultEnv`, `calculateTaskSlaDueAt`, `createLocalAttachmentStorage`, `resolveAttachmentControllerPath`

### `@rytass/bpm-core-nestjs-module/attachment`

`AttachmentStorage`, `createLocalAttachmentStorage`, `resolveAttachmentControllerPath`

### `@rytass/bpm-core-nestjs-module/database`

`BPMDatabaseConnectionOptions`, `buildBPMDataSourceOptions`, `buildDataSourceOptionsFromVaultEnv`

### `@rytass/bpm-core-nestjs-module/condition`

`CelEvaluationContext`

### `@rytass/bpm-core-nestjs-module/delegation`

`DelegationResolution`, `DelegationResolutionContext`

### `@rytass/bpm-core-nestjs-module/notification`

`calculateTaskSlaDueAt`

### `@rytass/bpm-core-nestjs-module/signature`

`SignTaskDecisionInput`, `SignatureModuleAsyncOptions`

### `@rytass/bpm-core-client/form`

`isFormRendererFieldReadonly`, `isFormRendererFieldRequired`, `readConditionOperatorOption`, `readDefaultConditionValue`

### `@rytass/bpm-core-client/workflow`

`ApprovalInstancesPageResult`, `readAttachmentPreviewUrl`

### `@rytass/bpm-core-react/next`

`BPMNextProvidersProps`

### `@rytass/bpm-core-react/views/instances`

`InstanceNewViewProps`

### `@rytass/bpm-core-react/views/instances/detail`

`InstanceAttachmentsSectionProps`, `InstanceFormSectionProps`, `InstanceHistorySectionProps`, `InstanceSignaturesSectionProps`, `InstanceTasksSectionProps`, `InstanceWebhookDeliveriesSectionProps`

### `@rytass/bpm-core-react/views/instances/new`

`InstanceNewViewProps`

### `@rytass/bpm-core-react/views/templates`

`TemplateCategoryOption`, `TemplateVersionsViewProps`

### `@rytass/bpm-core-react/views/templates/compose`

`EMPTY_COMPOSE_FORM_SCHEMA`, `EMPTY_COMPOSE_FORM_UI_SCHEMA`

### `@rytass/bpm-core-react/views/templates/versions`

`TemplateVersionsViewProps`

### `@rytass/bpm-core-react/views/forms/builder`

`FormBuilderViewProps`

---

## Quick statistics

Counts come from the TypeScript export scan of each package's entry points at the version above. "Distinct exported names" counts distinct names across all of a package's entry points, so a name re-exported by several entry points is counted once per package.

| Package | Subpaths (excluding root) | Distinct exported names |
|---|---|---|
| `@rytass/bpm-core-shared` | 7 | 225 |
| `@rytass/bpm-core-nestjs-module` | 16 | 431 |
| `@rytass/bpm-core-client` | 4 | 281 |
| `@rytass/bpm-core-react` | 47 | 105 |
