# BPMCore Public API Reference

Canonical inventory of every export from every published BPMCore package. **This file is the contract.** Any change to a `libs/*/src/**` export — adding, removing, renaming, or changing the visibility of a symbol — must update this file in the same commit.

Last verified against (2026-08-16, issues #7–#11): `libs/shared@0.7.0`, `libs/bpm-core-client@0.7.0`, `libs/bpm-core@0.7.0` (`@rytass/bpm-core-nestjs-module`), `libs/bpm-core-react@0.8.0`. This change set adds form option source contracts, `autocomplete` schema support, source normalization, structural DataSource publish lint, the host registry contract, guarded GraphQL option queries, typed client catalog/preview/runtime wrappers, immutable client option-state and builder binding helpers, Mezzanine async renderer controls, runtime context wiring, server-side submit/resubmit resolution, persisted option snapshots, the reversible snapshot migration, the visual builder's catalog/binding/confirmation flow, explicit API-base URL normalization for the client GraphQL endpoint, legacy workflow edge-data normalization in the designer, a distinct unresolvable-value error code with client-side message mapping, and registry-less publish/submit guards for DataSource-backed fields.

The 2026-08-16 DataSource audit round adds, on top of that: read-only `resolveFormFieldOptions` / `previewResolveFormFieldOptions` queries returning `BPMFormDataSourceResolveResult` (partial resolution reported through `unresolvedValues` instead of throwing, while submit/resubmit stays all-or-nothing), `waitingForFieldKeys` on both the options and resolve results as the authoritative dependency-wait signal, an optional `revalidationPolicy` on `FormDataSourceValueSnapshot`, `readFormDataSourceSelectedValues()`, a `canRetry` flag on `FormDataSourceFieldState`, per-request `AbortSignal` support on `requestGraphQl()` and every DataSource client query, and `@MaxLength` bounds on every DataSource GraphQL input field.

Versions are bumped by `nx release` at publish time — the numbers above are the last published ones, not the pending release.

PR #12 (2026-08-17, decision-policy designer) additionally adds `DEFAULT_QUORUM_THRESHOLD`, `composeQuorumThreshold`, `readDesignTimeApproverCount` and `isDecisionPolicyUnsatisfiable` to `@rytass/bpm-core-shared/workflow-graph`, and extends the `WorkflowCommand` union and the `WORKFLOW_TOOLSET` catalog with the user-task decision policy.

Argus integration follow-ups (2026-08-18, against `@0.9.1`) additionally add:
`BPM_TEMPLATE_OBSERVER` / `BPMTemplateObserver` / `BPMTemplateChangedEvent` /
`BPMTemplateChangeActionEnum` to `@rytass/bpm-core-nestjs-module/template`; the
`notification-schedule` helpers and `NotificationEntity.silenced` to
`@rytass/bpm-core-nestjs-module/notification`; the optional `dispatchDigest`
method on `BPMNotificationDispatcher`; the
`notificationQuietHoursTimeZone` / `notificationEmailDigestHour` root options;
migration `NotificationSilenced0000000021000`; a trailing
`rolledBackByMemberId` on `TemplateService.rollbackApprovalTemplateVersion`;
and `silenced` on the client's `NotificationRecord`. Behavioural changes in the
same set: in-app notifications are recorded even when silenced, quiet hours and
`emailDigestMode` are enforced, and publish / rollback refuse a deactivated
template.

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

```bash
# Determines each group's bump from Conventional Commits since its last tag,
# writes CHANGELOGs, commits and tags. Add --dry-run first to review.
npx nx release --skip-publish
```

All four packages form **one fixed version set**: a shared version number, a
`v{version}` tag, one workspace `CHANGELOG.md`, one GitHub release, and a
per-package `CHANGELOG.md` each. `prepublish-check` (typecheck + lint + test +
build + publint) runs for all four before versioning.

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

### Publishing — one command for all four

```bash
npx nx release publish        # add --dry-run first
```

Each project declares its own `nx-release-publish.packageRoot`, so this publishes
every package from the correct directory. The two builders still emit to
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

Re-exports the 6 child modules: `condition`, `form`, `identity`, `organization`, `status`, `workflow`.

## `@rytass/bpm-core-shared/condition`

Audit-condition evaluation context structures.

| Name | Kind | Purpose |
|---|---|---|
| `ConditionContextType` | type | Union of all evaluation context kinds |
| `SubjectContext` | interface | Applicant's own attributes |
| `OrgContext` | interface | Applicant's organization |
| `PositionContext` | interface | Applicant's position |
| `EnvContext` | interface | Environment vars (amount, date, etc.) |
| `InstanceContext` | interface | Current approval instance |
| `LastDecisionContext` | interface | Previous decision (used for return logic) |

## `@rytass/bpm-core-shared/form`

Form-schema definitions.

| Name | Kind | Purpose |
|---|---|---|
| `FormDefinitionSchema` | interface | Full form definition (fields + uiSchema) |
| `FormFieldDefinition` | type | Union of all field-definition variants |
| `FormFieldValue` | type | Union of all field-value variants |
| `TextFieldDefinition` | type | text / email / textarea |
| `NumberFieldDefinition` | type | number (min/max/precision) |
| `DateFieldDefinition` | type | date / datetime |
| `FormSelectionMode` | type | `single` or `multiple` option selection |
| `FormDataSourceReference` | interface | Registered source key, version, and bindings |
| `FormDataSourceBinding` | type | Direct field or primitive constant binding |
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
| `FormUiSchema` | interface | Layout description for renderer |
| `FormLayoutItem` | interface | One cell in the layout grid |
| `isFormOptionFieldDefinition()` | function | Option-control type guard |
| `isFormDataSourceFieldDefinition()` | function | DataSource-backed option type guard |
| `isFormStaticOptionFieldDefinition()` | function | Static-option type guard |
| `readFormFieldSelectionMode()` | function | Normalized control selection mode |
| `normalizeFormDefinitionSchema()` | function | Additive legacy-schema normalization |

## `@rytass/bpm-core-shared/identity`

| Name | Kind | Purpose |
|---|---|---|
| `MemberMetadata` | interface | Display-time member metadata |
| `MemberMetadataCacheEntry` | interface | Cached metadata + TTL |

## `@rytass/bpm-core-shared/organization`

| Name | Kind | Purpose |
|---|---|---|
| `OrgUnitType` | type | `'company' \| 'division' \| 'department' \| 'team'` |
| `ManagerResolutionScopeType` | type | `'MEMBER' \| 'ORG_UNIT' \| 'POSITION'` |
| `OrgUnit` | interface | Org-unit node |
| `Position` | interface | Position |
| `Membership` | interface | member × orgUnit × position relation |
| `ManagerResolution` | interface | "Who is whose manager" rule |

## `@rytass/bpm-core-shared/status`

| Name | Kind | Values |
|---|---|---|
| `VersionStatus` | type | `'DRAFT' \| 'PUBLISHED' \| 'ARCHIVED'` |
| `ApprovalInstanceState` | type | DRAFT / RUNNING / APPROVED / REJECTED / RETURNED / CANCELLED / EXPIRED |
| `WorkflowTokenStatus` | type | `'ACTIVE' \| 'WAITING' \| 'CONSUMED'` |
| `TaskStatus` | type | PENDING / COMPLETED / CANCELLED / etc. |
| `TaskDecisionAction` | type | APPROVE / REJECT / RETURN |
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
| `ApproverResolver` | type | DIRECT / POSITION / ORG_MANAGER / CANDIDATE_GROUP |
| `ApproverResolverFallback` | type | Fallback when primary resolver fails |
| `DecisionPolicy` | type | SINGLE / SEQUENTIAL / PARALLEL_ALL / PARALLEL_ANY / QUORUM |
| `ReturnBehavior` | interface | Return-handling settings (incl. `requireComment`) |
| `ReturnResubmitStrategy` | type | `'FROM_RETURN_POINT' \| 'RESTART'` |
| `SlaConfig` | interface | SLA timer config (incl. `calendar`) |
| `SlaCalendarMode` | type | `'CALENDAR' \| 'BUSINESS_DAY'` |
| `FieldPermission` | interface | Per-node read/write permission |
| `NotificationOverride` | interface | Node-level notification overrides |
| `NotificationChannel` | type | `'IN_APP' \| 'EMAIL' \| 'WEBHOOK'` |
| `ServiceAction` | type | Action runnable by a serviceTask |
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
| `createWorkflowNode` / `readNextWorkflowNodeIndex` | function | Node factory + id indexing |
| `createWorkflowEdge` / `readInsertedOutgoingEdgeData` | function | Edge factory + inserted-edge data |
| `insertWorkflowNodeIntoDefinition` / `insertWorkflowNodeAtEdge` / `insertWorkflowNodeAfterNode` | function | Node insertion strategies |
| `renameWorkflowNode` / `applyWorkflowNodeTriggerMode` | function | Node data transforms |
| `normalizeDesignerWorkflowDefinition` / `removeAsyncNotifyOutgoingEdges` / `normalizeSingleIncomingTriggerModes` | function | Definition normalizers |
| `readFallbackWorkflowDefinition` / `isEmptyDesignerWorkflowDefinition` | function | Empty/default definition |
| `isWorkflowConnectionValid` / `isWorkflowNodeRemovable` / `isWorkflowNodeInputConnectable` / `isWorkflowNodeOutputConnectable` / `isAsyncNotifyServiceTask` | function | Connection rules |
| `isExclusiveGatewaySourceEdge` / `isParallelGatewaySourceEdge` / `toggleSelectedEdgeId` | function | Gateway/edge helpers |
| `readWorkflowDefinitionIssue` / `readApproverResolverIssue` / `hasConfiguredConditionEdges` / `readServiceTaskMemberIds` | function | Validation |
| `readConditionField` / `readConditionOperator` / `readConditionOperatorIds` / `readConditionValueOptions` / `readNextConditionOperator` / `readNextConditionValue` / `shouldConditionOperatorUseValue` / `readConditionLabel` / `readConditionOperatorLabel` / `readConditionValueLabel` / `readFormFieldOption` / `readConditionExpression` / `readFormFieldReference` / `readConditionExpressionOperator` / `readConditionExpressionValue` | function | Condition compilation (UI state → CEL) |

## `@rytass/bpm-core-shared/workflow-command`

The serialisable command layer + pure reducer that both the designer UI and the LLM assistant drive the workflow through (single dispatch path).

| Name | Kind | Purpose |
|---|---|---|
| `WorkflowDesignerState` | interface | Single source of truth (definition + formSchema + selection + policy) |
| `WorkflowNodeAnchor` | interface | Where a new node wires in (`edgeId` / `afterNodeId`) |
| `WorkflowCommand` | type | Fine-grained primitive command union (add/rename/delete/connect/setEdgeCondition/setUserTaskReturnRequireComment/setUserTaskSla/setUserTaskDecisionPolicy/…) |
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
| `WORKFLOW_TOOLSET` | const | The full tool catalog (mutations, macros, queries), incl. `set_user_task_return_require_comment`, `set_user_task_sla` and `set_user_task_decision_policy`. One mutation tool per designer-reachable command — the assistant's contract is parity with the property form |
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
| `searchMembers(query)` | async function | Fuzzy search across name/email/phone |
| `listMemberDirectoryPage({ page, pageSize, searchText })` | async function | Full directory pagination |

## `@rytass/bpm-core-client/organization`

| Category | Names |
|---|---|
| Types | `OrgUnitType`, `ManagerResolutionScopeType` |
| Records | `OrgUnitRecord`, `PositionRecord`, `MembershipRecord`, `ManagerResolutionRecord`, `OrganizationSummaryRecord`, `ResolvedManagerRecord` |
| Queries | `readOrganizationDashboard()`, `listMemberships()`, `listManagerResolutions()`, `readResolvedManager()` |
| OrgUnit Mutations | `createOrgUnit()`, `updateOrgUnit()`, `deleteOrgUnit()`, `commitOrgUnitTreeDraft()` |
| Position Mutations | `createPosition()`, `updatePosition()` |
| Membership Mutations | `createMembership()`, `updateMembership()`, `deleteMembership()` |
| ManagerResolution Mutations | `createManagerResolution()`, `updateManagerResolution()`, `deleteManagerResolution()` |

## `@rytass/bpm-core-client/form`

| Category | Names |
|---|---|
| Records | `FormDefinitionRecord`, `FormDefinitionVersionRecord`, `FormBuilderRecord`, `FormSchemaLintResult` |
| Type | `FormDefinitionListStatus` |
| Queries | `listFormDefinitions()`, `listFormDefinitionsPage()`, `readFormBuilder()`, `lintFormSchema()`, `listFormDataSources()`, `previewFormFieldOptions()`, `readFormFieldOptions()`, `previewResolveFormFieldOptions()`, `resolveFormFieldOptions()` |
| Mutations | `createFormDefinition(name)`, `updateFormDefinition()`, `updateFormDefinitionDraft()`, `publishFormDefinitionVersion()`, `publishFormDefinitionContent()` |
| Factory | `createFieldDefinition()` |

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
| `readMissingFormDataSourceDependencies()` | function | Find FIELD bindings that are not yet present — advisory only; runtime callers must take `waitingForFieldKeys` from the server result |
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
| `FormDataSourceBindingValueKind` | type | Constant or field binding discriminator |
| `isFormDataSourceDescriptorCompatible()` | function | Enforce descriptor capability requirements for a control |
| `readCompatibleFormDataSourceDescriptors()` | function | Filter catalog descriptors for a control |
| `readFormDataSourceParameterType()` | function | Map a form field to a DataSource parameter type |
| `readCompatibleFormDataSourceBindingFields()` | function | List type-compatible dependency fields, excluding the target |
| `readFormDataSourceBinding()` | function | Read one parameter binding from a dynamic field |
| `upsertFormDataSourceFieldBinding()` | function | Immutably add, replace, or remove one parameter binding |
| `renameFormDataSourceFieldBindings()` | function | Keep FIELD bindings valid when a form field key changes |
| `readFormDataSourceFieldDependencyKeys()` | function | List fields referenced by dynamic bindings |
| `readFormDataSourceBindingValue()` | function | Read a constant binding value |
| `readFormDataSourceBindingValueKind()` | function | Read the binding source discriminator |

### Form Rendering Helpers (pure functions, no GraphQL)

| Name | Kind | Purpose |
|---|---|---|
| `FormRendererValues` | type | Key → value map during render |
| `FormRendererValidationResult` | interface | Validation outcome |
| `ConditionOperator` | type | Operator union |
| `ParsedConditionRule` | type | Parsed condition AST |
| `buildFormRendererValues()` | function | Build initial values from schema |
| `readVisibleFormRendererFields()` | function | Filter visible fields by condition |
| `validateFormRendererValues()` | function | Whole-form validation |
| `focusFormRendererField(key)` | function | DOM focus on a field |
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

## `@rytass/bpm-core-client/workflow`

### Types / Records

| Group | Names |
|---|---|
| Instance | `ApprovalInstanceState`, `ApprovalInstanceRecord` (incl. `formDataOptionSnapshot` / `formDataOptionSnapshotJson`), `ApprovalInstanceView`, `ApprovalInstancesPageInput / Result`, `ApprovalInstancePageInfoRecord`, `LaunchContext`, `LaunchableTemplateRecord` |
| Task | `TaskStatus`, `TaskAssignmentType`, `TaskDecisionAction`, `TaskRecord` (incl. `isAdhoc` / `adhocType` / `adhocOriginTaskId` / `adhocDirectiveId`), `TaskCandidateRecord`, `TaskDecisionRecord`, `WorkflowTokenRecord` |
| Ad-hoc | `AdhocDirectiveType`, `AdhocDirectiveStatus`, `AdhocTargetKind`, `AdhocPreApprovalRejectBehavior`, `AdhocTargetOptions`, `AdhocDirectiveRecord` |
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
| `listApprovalHistoryTasks(memberId)` | My historical decisions |
| `readWorkflowDashboardSummary({ currentMemberId, from, to })` | Five dashboard metrics |
| `listTaskDecisions(taskId)` | All decisions on one task |
| `listAttachments(instanceId)` | Attachment list |
| `readAttachmentDownloadUrl / PreviewUrl({ ... })` | Signed download/preview URLs |
| `readInstanceSignatures(id)` | Signature/verification records |
| `listAdhocDirectives(instanceId)` | Ad-hoc directives recorded on one instance |

### Mutations

| Name | Purpose |
|---|---|
| `submitApprovalInstance({ ... })` | Launch a new instance |
| `decideTask({ ... })` | Decide a task (APPROVE / REJECT / RETURN) |
| `cancelApprovalInstance({ ... })` | Cancel an instance |
| `resubmitApprovalInstance({ ... })` | Re-submit after return |
| `uploadAttachment({ ... })` | Multipart upload |
| `requestAdhocCountersign({ taskId, target, comment? })` | Ad-hoc countersign — parallel task joins the next user task |
| `requestAdhocPreApproval({ taskId, target, onReject, comment? })` | Ad-hoc pre-approval — blocks the current stage until approved |
| `configureAdhocStageNotification({ taskId, target, channels? })` | Notify targets when the current stage ends (any outcome) |
| `configureAdhocCompletionNotification({ taskId, target, channels? })` | Notify targets when the instance reaches a terminal state |
| `cancelAdhocDirective(directiveId)` | Withdraw a still-pending ad-hoc directive |

### Member helpers (in workflow subpath)

`resolveMemberProfiles(ids)`, `searchMembers(query)`, `listMemberDirectoryPage({ ... })`.

### Delegation

`listDelegationRules({ ... })`, `listDelegationRulesPage({ ... })`, `createDelegationRule({ ... })`, `revokeDelegationRule({ ... })`.

### Notification

`listNotifications({ ... })` (accepts `includeArchived`), `readUnreadNotificationCount(memberId)`, `markNotificationRead({ ... })`, `markAllNotificationsRead({ ... })`, `archiveNotifications({ ids })`, `unarchiveNotifications({ ids })`, `readNotificationPreference(memberId)`, `updateNotificationPreference({ ... })`.

### Pure helpers

| Name | Purpose |
|---|---|
| `readApprovalInstanceCaseTitle(instance)` | Display title from an instance |
| `readFormDataCaseTitle({ ... })` | Display title from form data before submission |

---

# 📦 `@rytass/bpm-core-nestjs-module`

NestJS module, entities, services, migrations. Embedded via `BPMRootModule`.

## Module entry

| Name | Kind | Purpose |
|---|---|---|
| `BPMRootModule` | NestJS Module | Embed everything in one import |
| `BPMRootModuleOptions` / `BPMRootModuleAsyncOptions` | interface | Host wiring: `memberResolverProvider`, `authContextFactory`, `attachmentStorageProvider`, `workflowServiceTaskDispatcherProvider`, `businessCalendarProvider`, `formDataSourceRegistryProvider`, plus flattened notification/attachment/signature/identity options |
| `buildTypeOrmModuleOptions(config)` | function | Build TypeORM options including migrations |
| `BPM_CORE_MIGRATIONS` | const | 21-class migration array |
| `AllExceptionsFilter` | ExceptionFilter | Unified GraphQL/REST exception filter |

## `@rytass/bpm-core-nestjs-module/bpm-auth`

Auth contract layer — lib does not own auth; host plugs in.

| Name | Kind | Purpose |
|---|---|---|
| `BPMAuthContext` | interface | Current-user context provided by host |
| `BPMAuthGuard` | Guard | Route protection |
| `BPMAuthModule` | Module | Auth contract module |
| `BPMAuthOptions` | interface | Module options (e.g., `authContextFactory`) |
| `@CurrentMember()`, `@CurrentMemberId()` | decorators | Inject current member in resolvers |
| `BPMAuthAuthorization` | service | Permission service |

## `@rytass/bpm-core-nestjs-module/identity`

| Name | Kind | Purpose |
|---|---|---|
| `BPM_MEMBER_RESOLVER`, `MEMBER_RESOLVER` (deprecated alias) | injection token | Host MUST provide a resolver |
| `BPMMemberResolver`, `MemberResolver` (deprecated alias) | interface | Resolver contract — `resolve`/`resolveMany`/`search?`/`searchPaged?` |
| `BPMMemberSearchPage`, `BPMMemberSearchPageOptions` | interface | Paged-search result (`items` + `total`) and 1-based page request for `searchPaged?` |
| `IdentityOptions` | interface | Identity module options |
| `BPMMemberBaseDirectory`, `BPMMemberBaseSearchPage` | interface | Host directory contract (incl. optional `searchMembersPaged`) and its host-shaped page |
| `BPMMemberBaseAdapterOptions`, `BPMMemberBaseResolverProviderOptions` | interface | Field readers + provider options for the member-base adapter |
| `BPMMemberBaseResolverAdapter` | class | Adapts a `BPMMemberBaseDirectory` into a `BPMMemberResolver` (exposes `searchPaged` only when the directory implements `searchMembersPaged`) |
| `createBPMMemberBaseResolverProvider`, `createBPMAuthContextFromMemberBaseMember`, `readMemberMetadataFromMemberBaseMember` | function | Provider factory, auth-context projector, and metadata reader |

## `@rytass/bpm-core-nestjs-module/organization`

| Category | Names |
|---|---|
| Entities | `OrgUnitEntity`, `PositionEntity`, `MembershipEntity`, `ManagerResolutionEntity` |
| ObjectTypes | `OrgUnitTreeCommitResult`, `OrganizationSummary`, `ResolvedManager` |
| Enums | `OrganizationEnums` |
| Service | `OrganizationService` |
| Module | `OrganizationModule` |
| GraphQL | `OrganizationQueries`, `OrganizationMutations` |

## `@rytass/bpm-core-nestjs-module/form`

| Category | Names |
|---|---|
| Entities | `FormDefinitionEntity`, `FormDefinitionVersionEntity` |
| DTOs | `FormDefinitionInput` |
| Objects | `FormSchemaLintResult` |
| Validators | `FormSchemaValidator` |
| Enums | `FormEnums` |
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
| Requests | `BPMFormDataSourceSearchRequest`, `BPMFormDataSourceResolveRequest`, `BPMFormDataSourceSearchResult`, `BPMFormDataSourceResolveFieldInput`, `BPMFormDataSourceSnapshotResolutionInput` |
| Registry | `BPMFormDataSourceRegistry`, `BPM_FORM_DATA_SOURCE_REGISTRY`, `EmptyBPMFormDataSourceRegistry`, `StaticBPMFormDataSourceRegistry` |
| Snapshot resolver | `BPMFormDataSourceValueResolver`, `BPM_FORM_DATA_SOURCE_VALUE_RESOLVER` |
| Module | `FormDataSourceModule`, `FormDataSourceModuleOptions` |
| Service | `FormDataSourceService`, `BPMFormDataSourceOptionResult`, `BPMFormDataSourceResolveResult` |
| Service inputs | `BPMFormDataSourcePreviewInput`, `BPMFormDataSourceRuntimeInput`, `BPMFormDataSourcePreviewResolveInput`, `BPMFormDataSourceRuntimeResolveInput` |
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
| DTOs | `ApprovalTemplateInput`, `ComposeApprovalTemplateWithFormInput` |
| Objects | `ComposeApprovalTemplateWithFormObject` (`ComposeApprovalTemplateWithFormResult`) |
| Validators | `WorkflowDefinitionValidator` |
| Enums | `TemplateEnums` |
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
| Entities | `ApprovalInstanceEntity` (incl. `formDataOptionSnapshot` / `formDataOptionSnapshotJson`), `TaskEntity` (incl. `isAdhoc` / `adhocType` / `adhocOriginTaskId` / `adhocDirectiveId`), `TaskDecisionEntity`, `TaskCandidateEntity`, `WorkflowTokenEntity`, `ActivityLogEntity`, `AdhocDirectiveEntity` |
| DTOs | `SubmitApprovalInstanceInput`, `DecideTaskInput`, `CancelApprovalInstanceInput`, `ResubmitApprovalInstanceInput`, `DryRunApprovalWorkflowInput`, `AdhocTargetInput`, `AdhocNotificationInput` |
| Objects | `ApprovalInstancePageInfo`, `WorkflowDryRunResult`, `WorkflowDashboardSummary` |
| Engine | `WorkflowEngineService` (incl. `requestAdhocCountersign` / `requestAdhocPreApproval` / `configureAdhocNotification` / `cancelAdhocDirective` / `listAdhocDirectives`), `WorkflowConditionEvaluator` |
| Decision options | `DecideTaskOptions` (engine-internal knobs kept out of the GraphQL schema), `MANUAL_TRANSFER_DELEGATION_REASON` |
| Tokens | `WorkflowEngineTokens`, `WORKFLOW_SERVICE_TASK_DISPATCHER` |
| Enums | `WorkflowEngineEnums`, `AdhocDirectiveTypeEnum`, `AdhocDirectiveStatusEnum`, `AdhocTargetKindEnum`, `AdhocPreApprovalRejectBehaviorEnum` |
| Module | `WorkflowEngineModule` |

GraphQL surface added by the ad-hoc feature: mutations `requestAdhocCountersign`, `requestAdhocPreApproval`, `configureAdhocStageNotification`, `configureAdhocCompletionNotification`, `cancelAdhocDirective`; query `adhocDirectives(instanceId)`. Countersign / pre-approval are gated by the node's `allowAddSigner` flag and only affect the single instance (never the template).

## `@rytass/bpm-core-nestjs-module/condition`

| Name | Purpose |
|---|---|
| `ConditionService` | Condition-expression evaluation engine |
| `ConditionModule` | Module wrapper |

## `@rytass/bpm-core-nestjs-module/delegation`

| Category | Names |
|---|---|
| Entity | `DelegationRuleEntity` |
| DTOs | `DelegationRuleInput` |
| Enums | `DelegationEnums` |
| Service | `DelegationService` |
| Module | `DelegationModule` |

## `@rytass/bpm-core-nestjs-module/calendar`

Business-day SLA scheduling. BPMCore ships **no** national holiday data — hosts that need real working-day semantics register their own calendar.

| Category | Names |
|---|---|
| Service | `BPMSlaScheduleService` (`resolveTaskSlaDueAt({ node, now })`) |
| Contract | `BPMBusinessCalendar` (`timeZone` + `isBusinessDay(localDate)`) |
| Token | `BPM_BUSINESS_CALENDAR` (host injects the calendar source) |
| Default | `BPMWeekdayBusinessCalendar`, `defaultBusinessCalendarProvider` (Mon–Fri, no holidays) |
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
| Token | `NOTIFICATION_DISPATCHER` (host injects email/webhook adapter; optional `dispatchDigest(notifications, options)` for combined daily-digest sends) |
| Token | `BPM_NOTIFICATION_OBSERVER` + `BPMNotificationObserver` / `BPMNotificationsCreatedEvent` (host observes rows as they are created, every channel) |
| Options | `NotificationOptions`, `NotificationOptionsModule` |
| Enums | `NotificationEnums` |
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

## `@rytass/bpm-core-nestjs-module/attachment`

| Category | Names |
|---|---|
| Service | `AttachmentService` |
| Provider | `AttachmentStorageProvider` (host injects S3 / local-FS adapter) |
| Token | `ATTACHMENT_STORAGE` |
| Options | `AttachmentOptions` |
| Module | `AttachmentModule` |

## `@rytass/bpm-core-nestjs-module/signature`

| Category | Names |
|---|---|
| Service | `SignatureService` |
| Object | `SignatureVerification` |
| Options | `SignatureOptions` |
| Module | `SignatureModule` |

## `@rytass/bpm-core-nestjs-module/database`

| Name | Purpose |
|---|---|
| `buildTypeOrmModuleOptions(config)` | Wire BPM entities + migrations into host TypeORM |
| `BPM_CORE_MIGRATIONS` | Full 21-class migration list |

## `@rytass/bpm-core-nestjs-module/migrations`

21 ordered migrations:

1. `EnablePostgresExtensions0000000000001`
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
| `useBPMLogout()` | hook | Host-facing alias of `useAuth().logout` — `() => Promise<void>`, runs `logoutApi()` + redirect to `loginPath` |
| `RouterAdapter` | interface | Framework-agnostic router contract (pathname / push / replace / back / searchParams) |
| `RouterAdapterProvider` | Component | Inject host's RouterAdapter |
| `RouterAdapterProviderProps` | interface | Provider props |
| `useRouterAdapter()` | hook | Read current adapter |
| `defaultBrowserSearchParams()` | function | Fallback reader from `window.location.search` |
| `BPMRoutes` | interface | Path mapping every BPM view uses (dashboard / inbox / caseDetail / templates / admin / …) |
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
| `DashboardPage` | Component | Five-metric workflow dashboard (content fragment) |
| `DashboardPageProps` | interface | `{}` (no props) |
| `BPMFormField` | Component | Mezzanine FormField wrapper (TIGHT / HORIZONTAL defaults) |
| `MemberPicker` / `OrgUnitPicker` / `PositionPicker` | Component | Picker components for admin pages |
| `readMemberOption()` / `readOrgUnitOption()` / `readPositionOption()` | function | record → picker option |
| `MemberOption` / `OrgUnitOption` / `PositionOption` | type | Picker value types |
| `PDFPreview` | Component | react-pdf preview component |
| `PDFPreviewProps` | interface | url / height / controls |
| `configurePdfWorker(url)` | function | Set `pdfjs.GlobalWorkerOptions.workerSrc` (must call before first mount) |
| `OrgUnitTreeDraftEditor` | Component (forwardRef) | Org-tree draft editor |
| `OrgUnitTreeDraftEditorHandle` | type | Imperative handle ref |
| `OrgUnitTreeDraftEditorState` | type | Editor state shape |

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
| `views/admin` | `AdminUsersView`, `AdminOrgsView`, `AdminDelegationsView` |

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
| `views/root` | `RootView` (placeholder, returns null) |

### Heavy views (must stay isolated, fat dependencies)

The packages below are declared as **optional** `peerDependencies` in
`libs/bpm-core-react/package.json` (`peerDependenciesMeta`). A host only has to
install the ones matching the heavy views it actually mounts; hosts that mount
none are not warned about missing peers. The version ranges pin what the
monorepo builds against, so upgrading `@rytass/bpm-core-react` now signals when
a peer needs bumping too.

Optional peers: `@xyflow/react`, `dagre`, `@codemirror/lang-json`,
`@codemirror/view`, `@uiw/react-codemirror`, `@hello-pangea/dnd`, `pdfjs-dist`,
`react-pdf`, `next`.

| Subpath | View | Heavy peerDeps |
|---|---|---|
| `views/instances/detail` | `InstanceDetailView`, `InstanceDetailViewProps` (now toggles each section via `showForm` / `showAttachments` / `showTasks` / `showSignatures` / `showHistory`), plus the standalone section components `InstanceFormSection`, `InstanceAttachmentsSection`, `InstanceTasksSection` (+ `InstanceTasksSectionHandle`, `AdhocActionMode`; handle adds `canAddSignerCurrentTask` / `openAdhocModal(mode)`, props add `adhocDirectives`), `InstanceSignaturesSection`, `InstanceHistorySection` and their `*Props` | `@xyflow/react`, `dagre` |
| `views/instances/new` | `InstanceNewView` | medium |
| `views/templates/compose` | `TemplateComposeWizardView`, `TemplateComposeWizardViewProps` (opt-in `showAiAssistant` / `aiAssistantAvailable` surface the Step 1 embedded-designer AI assistant), `useTemplateComposeWizard`, `TemplateComposeWizard`, `ComposeWizardStep`, `ComposePublishPhase` | embeds designer + builder (`@xyflow/react`, `@codemirror/*`, `dagre`, `@hello-pangea/dnd`) |
| `views/templates/designer` | `TemplateDesignerView`, `TemplateDesignerViewProps` (now supports `embedded` / `formSchemaOverride` / `initialWorkflowDefinition` / `initialInitiatorPolicyCel` / `onWorkflowChange` / `onInitiatorPolicyChange` for wizard reuse) | `@xyflow/react`, `@codemirror/*`, `dagre`, `@hello-pangea/dnd` |
| `views/templates/categories` | `TemplateCategoriesView` | normal |
| `views/templates/versions` | `TemplateVersionsView` | normal |
| `views/forms/builder` | `FormBuilderView` — controlled panel (`value` / `onChange` only; no standalone page mode). Embedded by the template designer and compose wizard; its option-field editor loads the host catalog, filters by capability, edits field/constant bindings, preserves references on field rename, and requires confirmation for source/mode/dependent-field impact before applying changes | `pdfjs-dist`, `@codemirror/*`, `@hello-pangea/dnd` |
| `views/forms/renderer` | `FormRenderer`, `FormRendererView`, `FormRendererProps`, `FormRendererDataSourceContext`, `FormDataSourceFieldState` (now carries `canRetry`, false when there is no query to re-issue), `UseFormDataSourceFieldInput`, `useFormDataSourceField()`, `readFormDataSourceFieldStatusMessage()`, `isFormDataSourceFieldSubmissionBlocked()`, `readFormDataSourceSubmissionBlockMessage()` (picks wait-vs-fix copy for a refused submission) | normal |
| `views/admin/users` / `orgs` / `delegations` | `AdminUsersView` / `AdminOrgsView` / `AdminDelegationsView` | orgs carries `OrgUnitTreeDraftEditor` |
| `views/settings/notifications` | `SettingsNotificationsView` | normal |

## Pages (Next.js Server Component shims)

19 subpaths. Each exports `{ default, metadata }`. Consumer's `app/<route>/page.tsx`:

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
| `pages/templates/compose` | `/templates/compose` | No | reads `BPM_AI_ASSISTANT_ENABLED` / `OPENAI_API_KEY` → Step 1 designer AI assistant |
| `pages/templates/designer` | `/templates/[id]/designer` | Yes | `params.id` → `templateId` |
| `pages/templates/versions` | `/templates/[id]/versions` | Yes | `params.id` → `templateId` |
| `pages/settings/notifications` | `/settings/notifications` | No | — |
| `pages/admin/users` | `/admin/users` | No | — |
| `pages/admin/orgs` | `/admin/orgs` | No | — |
| `pages/admin/delegations` | `/admin/delegations` | No | — |

---

## Quick statistics

| Package | Subpaths | Approx exports |
|---|---|---|
| `@rytass/bpm-core-shared` | 7 | ~70 types/interfaces |
| `@rytass/bpm-core-client` | 5 | ~120 (types + functions) |
| `@rytass/bpm-core-nestjs-module` | 12 | ~80 (entities + services + modules + DTOs) |
| `@rytass/bpm-core-react` | 41 | ~70 (hooks + components + views + pages) |
