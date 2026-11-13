# BPMCore Public API Reference

Canonical inventory of every export from every published BPMCore package. **This file is the contract.** Any change to a `libs/*/src/**` export — adding, removing, renaming, or changing the visibility of a symbol — must update this file in the same commit.

Last verified against (2026-11-13): `libs/shared@0.22.0`, `libs/bpm-core-client@0.22.0`, `libs/bpm-core@0.22.0` (`@rytass/bpm-core-nestjs-module`), `libs/bpm-core-react@0.22.0`. All four packages are one fixed version set, so these numbers move together.

Versions are set by `nx release` at publish time. The numbers above are the last published ones, not the pending release.

### Release status

The "First released in" column is the earliest `v*` tag that contains the change (`git tag --contains <commit>`). A "Not yet released" row is on `main` after the latest tag and ships with the next `nx release`.

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
| Notification sync for hosts (host request): `id` tie-breaker and `beforeId` keyset paging on `listNotifications`, `NotificationEntity.updatedAt` + `changedSince`, `readNotificationSummary` / `notificationSummary`, `markNotificationsRead`, migration `NotificationUpdatedAt0000000028000` | `v0.17.2` |
| Publish-lint errors in the designer name nodes and switch language (PR #94, #96): `readWorkflowLintMessage(message, definition, language?)`, `WORKFLOW_LINT_MESSAGES`, `BPMLanguage` / `BPMLanguageProvider` / `useBPMLanguage()`, `language` on `Providers` / `BPMNextProviders`; approval comments set at the h3 size | `v0.17.3` |
| Multiple-selection conditions (PR #97): checkbox and multiple-mode select / autocomplete fields compile `EQUALS` / `NOT_EQUALS` to list membership and name them 包含 / 不包含 (`readConditionOperatorOptionsForField`, `isMultipleSelectionConditionField`, `readConditionOperatorLabel(operator, field?)`); dry-run sample data gives them arrays | `v0.17.4` |
| Review follow-ups to PR #96 / #97: `readFormDataSourceErrorMessage` / `readFormSchemaLintMessage` take an optional `language`; the engine routes a multiple-selection condition saved with single-value CEL by its structured fields | `v0.17.4` |
| Activity log write order: `ActivityLogEntity.seq`, activity logs read in write order (`listActivityLogs` / GraphQL `activityLogs` and two engine lookups), migration `ActivityLogSeq0000000029000` | `v0.17.5` |
| Organization reads open to designers: the three reads the template designer and compose wizard load (`orgUnits`, `positions`, `memberships`) move to the new `@BPMDesignerOnly()` resolver `OrganizationDirectoryQueries`, and the designer loads them through the new `readOrganizationDirectory()` instead of `readOrganizationDashboard()`; `OrganizationQueries` stays `@BPMAdminOnly()` as a whole class, so manager rules, the counts and the summary stay administrator-only, as does every organization write. Visible to a host: `resolverMetadataFactory` now receives `resolverName: 'OrganizationDirectoryQueries'` and `access: 'designer'` (was `'OrganizationQueries'` / `'admin'`) for those three handlers, so a host that maps levels as in the README example gets `bpm:design` instead of `bpm:admin` on them | `v0.17.5` |
| Node-level field access, step 1 (shared contract): `FieldAccessEntry` (`{ fieldKey, display: 'SHOW' \| 'HIDE', fill: 'NONE' \| 'OPTIONAL' \| 'REQUIRED' }`) and `UserTaskNodeData.fieldAccess`, `ResolvedFieldAccess` and the `readNodeFieldAccess` / `readNodeFillableFieldKeys` / `resolveFieldAccess` / `overlayStoredFormDataKeys` helper family, root export only. The published `FieldPermission` / `UserTaskNodeData.fieldPermissions` are now `@deprecated` (they were never read and still are not). A node without `fieldAccess` behaves as before | `v0.17.7` |
| Node-level field access, write path: `fieldAccess` `fill` is now enforced when a non-ad-hoc task at the node is approved. `DecideTaskInput.formDataJson` / `expectedFormDataFingerprint` (GraphQL requires the fingerprint whenever `formDataJson` is sent), `ApprovalInstance.formDataFingerprint`, and `changedFieldKeys` on the `TASK_DECIDED` payload. `decideTask` now re-reads the task after taking the instance lock, for every node (a decision that lost the race now answers `Task … is not pending`). A node without `fieldAccess` otherwise behaves as before; a published version or case snapshot that carries the old `fieldPermissions` key is unaffected, since nothing reads it | `v0.17.7` |
| Node-level field access, notification flag: the `TASK_ASSIGNED` / `TASK_TRANSFERRED` payload carries `hasFillableFields: boolean`, `true` when the task is not ad-hoc and its node lets the approver fill in at least one field (`fill` other than `NONE`). A host pushing the notification can tell the recipient to open the form instead of offering a quick approve. No entity column; a node without `fieldAccess` always reads `false` | `v0.17.7` |
| Node-level field access, publish lint: `lintWorkflowDefinition` refuses, from the definition alone: a node that still carries the deprecated `fieldPermissions` key, whatever its value (`legacyFieldPermissions`; remove it and use `fieldAccess`); a malformed `fieldAccess` (not an array, or an entry that is not an object, has an empty `fieldKey`, or a `display` / `fill` outside its enum); a `fieldKey` listed twice; `fill` other than `NONE` with `display: 'HIDE'`; fillable fields on a `PARALLEL_ALL` / `QUORUM` node, and on a node with `sla.onTimeout: AUTO_APPROVE` or `excludeInitiator.whenEmpty: SKIP_NODE`; two nodes that fill the same field in when both can run in one case — one reaches the other, or a parallel split sends each down its own branch (`approverFilledMultipleFillNodesOnPath`; fill nodes on mutually exclusive branches stay allowed); and a `SET_FORM_FIELD` serviceTask that writes a field some user task lets its approver fill in. New `WORKFLOW_LINT_MESSAGES` lines with zh-TW / en copy in `readWorkflowLintMessage`, and the root-exported helper `readTopLevelFieldKey`. A node without `fieldAccess` or `fieldPermissions` lints as before | `v0.17.7` |
| Node-level field access, publish lint against the bound form: publishing a template version also refuses `fieldAccess` that clashes with the form it is bound to. A `fieldKey` that is not a top-level field of the form (a nested path such as `items.price` is reported here as unknown); an approver-filled field that the form gives `required`, `requiredWhen`, `visibleWhen`, `readonlyWhen`, `hidden` or `defaultValue` (set means `required` / `hidden` is `true` and the others are not `undefined`; `hidden` and `visibleWhen` would leave the approver nothing to fill in while the engine still blocks approval on the empty field), reported once per field and rule however many nodes fill it in; an approver-filled data-source or `file_upload` field, or a table with a data-source column; `fill: 'REQUIRED'` on a boolean field; and an applicant's field whose `requiredWhen` / `visibleWhen` / `readonlyWhen` reads an approver-filled field, which is still empty when the applicant submits (`applicantRuleReadsApproverFilled`, one line per field, rule and approver-filled field). `WORKFLOW_LINT_MESSAGES` lines (`fieldAccessUnknownField`, `approverFilledFieldFormRule`, `approverFilledFieldDataSource`, `approverFilledFieldFileUpload`, `approverFilledTableDataSourceColumn`, `approverFilledRequiredBoolean`, `applicantRuleReadsApproverFilled`) with zh-TW / en copy in `readWorkflowLintMessage`, and the `APPROVER_FILLED_FORM_RULES` / `ApproverFilledFormRule` and `APPLICANT_FIELD_CONDITION_RULES` / `ApplicantFieldConditionRule` constants. A template whose form carries none of these combinations publishes as before | `v0.17.7` |
| Node-level field access, publish lint for early reads: publishing a template version also refuses a condition that reads an approver-filled field before any approver can have filled it in, since the field is then absent and the case gets stuck or routes on nothing. Checked from the graph alone, per field: the nodes that fill it in and have no `entryCondition` are the guards (one that has an `entryCondition` can be skipped, so it guards nothing); an edge `condition` or `conditionFieldKey` is refused when its source node can be reached from the start without passing a guard, and a node expression (`entryCondition`, an `EXPRESSION` approver resolver, a `WEBHOOK` payload, a `SET_FORM_FIELD` value, a `NOTIFY` `EXPRESSION` recipient list) when its node can, or is the filling node itself. An edge that trips both its `condition` and its `conditionFieldKey` reports once. `initiatorPolicyCel` is not read. Deliberately conservative: a read after a parallel join is refused when only some branches pass through a guard, and `has(form.x)` is not treated as a guard; move the read after the filling node. One new `WORKFLOW_LINT_MESSAGES` line (`approverFilledFieldReadEarly`) with zh-TW / en copy in `readWorkflowLintMessage`; its labels come from the new `WORKFLOW_EXPRESSION_LABELS`, which the backend lint and the client translation both use. A template that reads approver-filled fields only after they are filled in publishes as before | `v0.17.7` |
| Node-level field access, client and launch/resubmit forms: the client `decideTask` takes an optional `fill: { formData, expectedFormDataFingerprint } \| null`; `ApprovalInstanceRecord.formDataFingerprint` is read with `readApprovalInstance`; `LaunchContext.templateVersion.workflowDefinition` carries the current version's workflow definition. BPM's own launch page and the resubmit edit state no longer render, validate or send approver-filled fields (the server drops them anyway; a `minRows` on one used to block the applicant). Known PR1 limit: an applicant in the resubmit edit state does not see already-revealed approver-filled values; the read-only view is unchanged | `v0.17.7` |
| Node-level field access, approver fill UI (PR2): `TaskEntity.hasFillableFields` / `TaskRecord.hasFillableFields` (non-ad-hoc task whose node lets the approver fill in fields, read in the same batch query as `nodeLabel`). On the instance page the fill node's approver edits the node's fields in place (`FormRendererProps.fieldLabelMarkers`; `InstanceFormSectionProps` adds `fieldAccess`, `fieldLabelMarkers`, `fill`, `onReloadAfterConflict`; `InstanceTasksSectionProps` adds `fill`, `onFillApproveError`; `InstanceHistorySectionProps` adds `formSchema`); approving checks the fill first, lists it in the confirm dialog and sends it with `decideTask`; a fingerprint conflict keeps the draft and offers a reload; server field errors land on the fields. The tasks table and the inbox show 需補填, the history names the filled fields (`changedFieldKeys`), and the notification drawer offers 開啟案件 instead of 同意 for a task that fills in fields. A node without `fieldAccess` renders as before | `v0.17.7` |
| Node-level field access, shared lint rules (designer step 1): the field access publish rules move into `@rytass/bpm-core-shared` as structured issues (`FieldAccessIssue`, `readNodeFieldAccessIssues`, `readDefinitionFieldAccessIssues`, `readFormFieldAccessIssues`, `readFormFieldFillIssues`, `readUserTaskFillConflicts`, `readReachableWorkflowNodeIds`, `createWorkflowCoRunReader`, `readWorkflowParallelBranchSets`, `isOnOwnParallelBranch`, `referencesFormField`). The backend lint now reads them; its output is unchanged | `v0.17.7` |
| Node-level field access, designer (PR3): `readFieldAccessMatrix` and its types, the `setFieldAccessMatrix` / `removeLegacyFieldPermissions` commands (`FieldAccessMatrixEntry`) and the `set_field_access_matrix` / `remove_legacy_field_permissions` tools. The template designer gets the 欄位與關卡總覽 drawer, a 欄位顯示與補填 section on the user task panel and a 補填 / 隱藏 tag on the node card; field access issues block publishing, not saving. `WORKFLOW_CHAT_SYSTEM_PROMPT` gains a rule on field access | `v0.17.7` |
| Node-level field access — engine, publish lint, launch/resubmit forms (PR1); the seven field-access rows above are its parts. Nodes without `fieldAccess` behave as before; the one change that reaches every node is that `decideTask` re-reads the task after taking the instance lock. The refusals a host can meet are listed under [Decide-task errors](#decide-task-errors-approver-filled-fields) | `v0.17.7` |
| Resubmission comment (PR #124): optional `ResubmitApprovalInstanceInput.comment` (at most 2000 UTF-16 code units, stored in the `INSTANCE_RESUBMITTED` payload), the client `resubmitApprovalInstance({ comment })`, and `InstanceFormSectionProps.resubmitComment` / `onResubmitCommentChange`. A blank comment is not sent, so an older server is unaffected | `v0.17.9` |
| Returned cases on the inbox (PR #125): `InboxView` lists the member's own `RETURNED` cases (被退回待重送) above the pending tasks on the 待簽核 tab, from the first page of 100 of `listApprovalInstancesPage` (`view: 'SENT'`), and points to 我發起的 when more may exist; a failure there hides only that list. No export changes | `v0.17.9` |
| Deactivated members with open tasks (PR #126): `inactiveMembersWithOpenTasks` (admin-only), `WorkflowEngineService.listInactiveMembersWithOpenTasks`, `InactiveMemberOpenTasksRecord` / `InactiveMemberWithOpenTasksObject`, the optional `BPMMemberResolver.resolveInactive` and `BPMMemberBaseDirectory.resolveInactiveMembers`, the client `listInactiveMembersWithOpenTasks` / `InactiveMemberWithOpenTasksRecord`, and the 已停用、仍有待簽的會員 section on the member screen (`AdminUsersView`). A host without `resolveInactive` sees an empty list | `v0.17.9` |
| Delegation skips deactivated agents (PR #127): `DelegationService.resolveAssignees` (one host `resolveInactive` call per node for the first hop of every candidate's chain, asking only about the agents of rules whose scope applies to the case; the engine's dispatch uses it), and a rule whose agent the host reports as deactivated is skipped — the next rule applies, else the principal keeps the task. **Behaviour change for hosts that implement `resolveInactive`:** dispatch now depends on it — when it throws or has not answered within 5 seconds, the launch, advance or next-candidate step fails with a `ServiceUnavailableException` (503) naming the member directory lookup (agent ids and the host's error are logged on the server, not returned), and rolls back. Hosts without it see no change | `v0.18.0` |
| Each signer's own decision (PR #129): on a task several members signed (a `SEQUENTIAL` node or a countersign policy), `InstanceHistorySection` fills a `TASK_DECIDED` row's missing action, comment, transfer target or signature only from the row's own decision (the payload's `decisionId`, or for a row without one, the same member's decision made closest to the row), so a signer who wrote nothing no longer shows the last signer's comment. New optional `InstanceHistorySectionProps.taskDecisions` (every decision on the instance; `InstanceDetailView` passes it) finds that decision for every signer; without it only `taskDecisionsByTaskId` is searched, which holds the newest decision per task, so a row that is not the newest on its task borrows nothing. `InboxView`'s 已處理未結束 and 歷史簽核記錄 tabs show the viewer's newest own decision instead of the task's newest; with none of their own the row shows 未記錄, and 簽核時間 shows `-` unless the task has no decisions at all, when it keeps `completedAt`. The timeline's signer and time line moves from `caption` to `body` text | `v0.18.1` |
| Return targets in the designer: the user task panel gets 可退回到 (`ReturnBehavior.allowedTargets`: 退回申請人 / 退回上一個節點 / 由簽核者選擇), written by the new `setUserTaskReturnAllowedTargets` command. **Behaviour change:** with `allowedTargets: 'ANY'` the engine now accepts only the applicant (start event) or a user task before the returning node — one with a path to it that the start event also reaches without passing through it (`readSelectableReturnTargetNodeIds`) — and refuses any other node with a `409 Conflict`. Before, it accepted any node in the definition, so a return to the end event approved the case and a return to a downstream node skipped the steps in between. The instance page's return dialog offers the same list | `v0.18.0` |
| Text length and format enforced: `TextFieldDefinition.pattern` / `patternErrorMessage`, `readTextFieldValueIssue` (optional `testPattern`), `compileTextFieldPattern`, `hasRepeatedTextFieldPatternGroup`, `TextFieldValueIssue`, `TextFieldPatternTest`, `TEXT_FIELD_PATTERN_MAX_LENGTH`, `TEXT_FIELD_PATTERN_ERROR_MESSAGE_MAX_LENGTH`. **Behaviour change:** `minLength` / `maxLength` were a hint only and are now enforced, together with `pattern`, by the engine on submit, resubmit and approver fill (`400` with `formData.<key> must be at least N characters` / `must be at most N characters` / `does not match the required format`) and by `validateFormRendererValues` before the request is sent. Table text columns are included. A value that is not a string, sent for a text field or column that sets any of these rules, is refused with `formData.<key> must be text`. On submit and resubmit a field an approver fills in later is only checked for its type; its rules apply when the approver fills it. The schema linter refuses a pattern that does not compile, is blank, is over 500 characters, or repeats a group (`(…)` followed by `*`, `+`, `{n,}` or a count over 1; `hasRepeatedTextFieldPatternGroup`), which is the only shape whose backtracking grows exponentially with the value (without one it is polynomial in the value, but the degree grows with the pattern, so a long pattern of unbounded repeats can still be slow on short values); an error message without a pattern or over 200 characters; and `pattern` / `patternErrorMessage` on a field or table column that is not text. The engine runs every pattern of one submit, resubmit or fill under a shared 50 ms budget of matching time (`vm` timeout; the fixed cost of starting each run, about 45 µs, is not charged, so a full table of valid values passes; a table with more rows than its `maxRows` is refused with `must include at most N row(s)` before any cell is checked, so the schema, not the submitter, bounds how many values a pass checks); a value it could not check in time is refused with `formData.<key> could not be checked against the required format in time`, never reported as a format mismatch. The case pages (`InstanceNewView`, approver fill and resubmit on `InstanceDetailView`) run the patterns through `validateFormRendererValuesInWorker`: in a Web Worker started from a `blob:` URL, under the same 50 ms matching budget (`TEXT_FIELD_PATTERN_TIME_BUDGET_MS`, now in shared), with the worker terminated after 1 s more; a value not checked in time shows `…的格式檢查逾時…`, not a format error. A page whose Content Security Policy lacks `worker-src blob:`, or a runtime without `Worker`, falls back to checking on the main thread with no time limit. A text field with rules that nobody can fill in at that moment — hidden (store-only), or one whose `visibleWhen` is false — is checked for its type only, and its length and pattern are not applied until it is shown. A `SET_FORM_FIELD` service task writing a top-level text field is held to the same rules, under its own 50 ms budget: a value that breaks them throws `400` (`系統節點「<label>」要寫入欄位「<label>」的值不符合該欄位的規則（…）…`), which rolls back the submit or decision that reached the node; an instance runs on its template snapshot, so correcting the template does not change a case already running. A form already saved with lengths that its stored data breaks will refuse those values on the next submit | `v0.18.0` |
| Form-field and prior-node approver sources (PR #132): four `ApproverResolver` types — `FORM_MEMBER_MANAGER` (the manager of the person picked on the form, `levelsUp`), `FORM_ORG_UNIT_MANAGER` (the manager of the unit picked in the new 組織選擇 `org_unit` form field), `NODE_ACTOR` / `NODE_ACTOR_MANAGER` (the members who actually approved the most recent round reached among the listed earlier nodes, or their managers) — with `readUnsupportedApproverResolverType`, `isNotifyRecipientResolverType`, `isFallbackCapableApproverResolverType`, `readNodeActorSourceIssues`, `readNodeActorSourceSkipReasons`, `OrgUnitFieldDefinition` / `isOrgUnitFieldDefinition` / `isFormOrgUnitValue`, the picker queries `searchOrgUnitOptions` / `orgUnitOptionsByIds` (`OrganizationPickerQueries`, any signed-in member; client `searchOrgUnitOptions` / `resolveOrgUnitOptions`) and the designer source editor. A source node for `NODE_ACTOR` / `NODE_ACTOR_MANAGER` may not have an `entryCondition`, `excludeInitiator.whenEmpty: 'SKIP_NODE'` or `sla.onTimeout: 'AUTO_APPROVE'`, since an SLA approval counts as nobody's signature; the `TASK_DECIDED` payload of an SLA auto-approval now carries `automatic: 'SLA_AUTO_APPROVE'`. **Behaviour change:** an approver resolver `type` the engine does not know is now refused (`409`, and the publish lint rejects it) instead of quietly resolving as the initiator's manager; a template using a new source must not be published until every API on the schema runs this version | `v0.18.1` |
| Resubmit releases removed form attachments (PR #133): `resubmitApprovalInstance` releases (back to `instanceId` null) the form-field attachments the resubmitted form data no longer refers to — a file the applicant removed from a `file_upload` field — through the new `AttachmentService.releaseUnreferencedFormAttachments(manager, { formData, instanceId, schema })`; only a `file_upload` field whose key the submission carries releases its files (a cleared field arrives as `[]`; a key left out keeps them), and task attachments, files attached to the case outside a form field and other instances' files are untouched, so the case's attachment list matches the form it was resubmitted with. `bindFormDataAttachmentsToInstance` now takes the form `schema` too and reads attachment ids from `file_upload` fields only — before, any UUID anywhere in the form data counted, so an org unit or option id could be taken for a file. It binds a free attachment (`instanceId` null) only when the instance's initiator or `submittedByMemberId` uploaded it — an attachment id is visible to every reader of a form, and a released one is free again, so binding any id let a member who had seen one move it into a case of their own and read it. A `file_upload` value naming an attachment the case may not take — uploaded by someone else, bound to another case, or with no attachment behind it (a deleted file, a value that is no id) — is refused with a `BadRequestException` whose message leads with the new shared constant `ATTACHMENT_NOT_BINDABLE_ERROR_CODE` (`@rytass/bpm-core-shared/form`), rather than saving the case without it; the client's `readErrorMessage` shows its own copy for that code. A host that uploads form attachments as some other member must upload them as the filer | `v0.19.0` |
| `file_upload` field keeps and lists its attachments (PR #133): the field value (attachment ids) is what the field lists — a file picked there, or any other id by the name and size in the new `FormRendererProps.attachments` (`FormRendererAttachment`: `id`, `filename`, `sizeBytes`, a subset of `AttachmentRecord`) — so an attachment carried over on resubmit can be removed and counts towards `maxFiles`, and a value the host replaces is what the field shows; new `FormRendererProps.onFileUploadStateChange(fieldKey, FileUploadFieldState)` (`pendingCount`, `failedCount`) and `readFileUploadSubmissionBlockMessage()`, which the launch and resubmit flows use to refuse a submit while an upload is running or has failed; new `FormRendererProps.onDownloadAttachment(attachmentId)`; a failed upload is listed with its reason and can be retried; without `onUploadAttachment` a `file_upload` field is disabled (此處無法上傳附件) instead of listing a made-up id as uploaded. `InstanceFormSectionProps` adds `attachments`, `onDownloadAttachment`, `onFileUploadStateChange` (a fill node still never uploads: an approver cannot fill in a `file_upload` field, ADR 20) | `v0.19.0` |
| Designer conditions on an unfilled form field no longer fail the submission (guard, `readConditionExpression`): an optional field that was never touched has no key in `formData`, and `cel-js` 0.8.2 throws `Identifier "x" not found` for it. The condition the designer compiles for a field with an identifier key (`form.x`) is now `has()`-guarded and right-nested (`has(form.x) && (form.x != null && ...)`, because `cel-js` short-circuits `&&` reliably only when nested and never short-circuits `||`), so an absent or `null` value reads as unfilled: filled / equals / ordering are `false`, is-empty / not-equals are `true`. **Behaviour change:** an ordering comparison (greater / less, with or without equals) now also treats a cleared `""` as unfilled, so a date `"" < "2026-01-01"` that used to be `true` is now `false`, and a number `"" > 5` that used to throw is now `false`. This applies to conditions compiled from now on; a definition already published keeps its stored CEL, so its in-flight cases keep the old `true` until the template is saved and republished (see the next row). Multiple-selection fields (checkbox, multiple select / autocomplete) with an identifier key also read a `""` value as unfilled for is-filled / is-empty, as member fields already did. A key that is not an identifier (`form["a-b"]`) cannot be wrapped in `has()` and keeps its unguarded output. A hand-written CEL is unchanged and still fails on a missing key (docs/05 §5.1.1). No export changes | `v0.20.1` |
| Edges saved before the guard fall back to their structured fields when their CEL fails: `WorkflowEngineService` (actual runs and the designer dry run) evaluates an edge's stored CEL as before, and only when that throws `EXPRESSION_MISSING_KEY` or `EXPRESSION_TYPE_ERROR` (`Identifier "agent" not found` for an untouched optional field, `null > 5`, `"" > 5`) **and** the edge's own field is unfilled does an edge that carries `conditionFieldKey` and `conditionOperator` answer from those fields — for a missing key only when the key named is that field (a CEL that also reads another key fails as written when that key is missing), and for a type error, which names no key, with a `warn` log (`code=EDGE_STRUCTURED_FALLBACK edge=… field=… reason=EXPRESSION_TYPE_ERROR`, no values) instead of failing the submit or decision; a list value still goes straight to them, as before. A stored CEL that evaluates keeps its result, so no route that worked changes (a date `"" < "2026-01-01"` stays `true`). A missing key or type error while the edge's field is filled (a CEL edited by hand while the structured fields stayed, `form.amount > "abc"`) is rethrown, a budget overrun or a function failure is never absorbed, and an edge with no structured fields (hand-written CEL) still fails as written. `evaluateWorkflowEdgeCondition` reads an unfilled value (absent, `null`, `""`, whitespace only or an empty list) as not matching: equals and the four ordering comparisons are `false`, not-equals and is-empty are `true`, is-filled is `false`; it reads only the form data's own keys, so a field key named like an inherited member (`constructor`) is unfilled, not a function. The own-key read and the unfilled test live in `workflow-engine/workflow-form-value.ts`, which `index.ts` does not re-export. No export changes | `v0.20.1` |
| Missing-key names stay out of messages after a computed index: `ExpressionRuntimeError.keyName` is now `null` whenever the expression indexes with an identifier (`form.rates[form.currency]`, `form.m[k]`). The engine may report the value read through the index as the missing key, and that value can equal a name the author wrote (`rates`), which the previous "written in the expression" check let through. An index holding only literals (`form["a-b"]`, `["a", "b"]`, `[0]`) still keeps the name. No export changes | `v0.20.1` |
| Approval-instance field filters and sort (ADR 25): `fieldFilters` and `sort` on `approvalInstances` / `approvalInstancePageInfo` / `approvalInstanceCount`, the `filterableFieldIssues` query, `filterable` on field definitions, write-time type checks on submit / resubmit / decide-fill / `SET_FORM_FIELD`, publish and rollback checks (409), migration `ApprovalInstanceFormDataGin0000000031000`, and the client and designer wiring | `v0.21.0` |
| `SET_FORM_FIELD` member and organization-unit shapes: a service task writing a top-level `member` or `org_unit` field is held to the same shape the submit check applies (a non-empty member id, or a list of them on a `multiple` field; a non-empty unit id), so an array written to a single-member field can no longer reach a `DYNAMIC_FORM` resolver or a manager chain that starts from the field and refuse inside a later decision. A refused value throws `400` with `formDataErrors` (`reason: 'TYPE'`, `path` the field key), as the text-rule refusal of the same node now also does. No export changes | `v0.21.1` |
| Approval comment requirement: optional `UserTaskNodeData.requireApprovalComment`, validated by `lintWorkflowDefinition` (`workflow.nodes.<id>.requireApprovalComment must be a boolean`), the `setUserTaskRequireApprovalComment` command and the `set_user_task_require_approval_comment` tool, a 核准時意見必填 switch on the designer's user task panel, the approve dialog on the instance page asking for the comment before it sends, and the `TASK_ASSIGNED` / `TASK_TRANSFERRED` payload key `requireApprovalComment: true` (only when on) that turns the notification drawer's 同意 into 開啟案件. When `true`, a person's `APPROVED` decision without a non-blank comment is refused with `BadRequestException` 「此節點要求同意時填寫意見，請輸入意見後再同意。」. Read from the instance's workflow snapshot, so a template that opts in later does not block a running case; the SLA `AUTO_APPROVE` timeout is never held to it. Omitted (or `false`) keeps the previous behaviour | `v0.21.1` |
| Initiator `customFields` resolver (PR #145): `BPM_INITIATOR_CUSTOM_FIELDS_RESOLVER` / the `initiatorCustomFieldsResolver` runtime option / the `initiatorCustomFieldsResolverProvider` wiring option fill `customFields` of the initiator snapshot the engine builds (`BPMInitiatorCustomFieldsResolver`, `BPMInitiatorCustomFieldsInput`, `BPMInitiatorCustomFieldsPurpose`). A submission waits for it 10 s at most and fails with a fixed Chinese 500 on a timeout, an error that is not an `HttpException` or a bad value, logging the cause; no case is created. `launchableApprovalTemplates` calls it once per request and judges initiator policies against its answer, falling back to `customFields: {}` (fail closed per template) when it fails. `listLaunchableApprovalTemplates` takes an optional `authContext` | `v0.21.1` |
| Designer reads "today" in the host's organization zone (F43): `organizationTimeZone?: string` on `Providers` / `BPMNextProviders`, `BPMOrganizationTimeZoneProvider` / `useBPMOrganizationTimeZone()`, and `DEFAULT_BPM_ORGANIZATION_TIME_ZONE` moved to `@rytass/bpm-core-shared` (bpm-core re-exports it). The template designer's position pickers, the org-unit position inactive warning and the dry-run initiator snapshot now judge effective dates in that zone instead of a hard-coded `Asia/Taipei` | `v0.21.1` |
| Form options for templates only the host submits: the launch-context check of `formFieldOptions` / `resolveFormFieldOptions` (`templateId`) no longer reads the launchable list. It calls the new `WorkflowEngineService.readFormOptionsTemplateVersion(templateId, memberId, authContext?)`, which judges that one template's initiator policy with the same checks as the list but asks the initiator `customFields` resolver with `purpose: 'FORM_OPTIONS'` and the template and version ids. A host can thereby open a template's options to members who may not submit it (a policy such as `has(initiator.customFields.hostSubmitted)`) while the launchable list and the GraphQL submission still refuse them. A resolver that ignores `purpose` behaves as before. `BPMInitiatorCustomFieldsPurpose` gains `'FORM_OPTIONS'` — a host that switches over it exhaustively must add the case | `v0.22.0` |
| Manager chain starts from someone else: `ORG_MANAGER_CHAIN` takes two optional keys. `startFrom` (`OrgManagerChainStart`) starts the climb from the person picked in a form field or the person who actually approved an earlier stage instead of the initiator; `startPositionLevel` walks past managers below that position level. Left out they change nothing: behaviour and error wording stay as before, and the engine reads the instance's workflow snapshot. Publish checks the field and the stage like `FORM_MEMBER_MANAGER` / `NODE_ACTOR`; a notify node's chain may only start at the initiator. **Compatibility:** an engine from before this change ignores both keys and climbs from the initiator, so do not publish a template that uses them to hosts still on an older engine. The dry-run placeholder gains a suffix when either key is used (`formatOrgManagerChainPlaceholder`). A `NODE_ACTOR` start is also refused at publish when a stage it names can have several signers (`PARALLEL_ALL`, `SEQUENTIAL`, a `COUNT` quorum above 1 or any `PERCENTAGE` quorum, unless it lists a single `DIRECT` member and does not hand over to the initiator's manager through `excludeInitiator.whenEmpty` or `excludeNodeActors.whenEmpty = INITIATOR_MANAGER`), because the engine cannot pick one person and would throw inside the last signer's approval, which could then never commit; `NODE_ACTOR` / `NODE_ACTOR_MANAGER` keep their behaviour. In the AI toolset, `set_user_task_approver` keeps the node's `startFrom` and `startPositionLevel` when the call leaves those keys out (as it does `fallback`); send `startFrom: { type: 'INITIATOR' }` or `null`, or `startPositionLevel: null`, to reset them. The toolset stores a `startFrom` of a type it does not know (or that is not an object) and any `startPositionLevel` other than an absent or `null` one (a `2.5` or a `'20'`) as written, so validation reports them instead of the chain quietly starting at the initiator. The same holds for a `minPositionLevel` that is missing, fractional or not a number: the toolset keeps the chain as written, `startFrom` included, and validation reports the level (before, it fell back to the initiator's direct manager and dropped the start). A stage list (`NODE_ACTOR`, `NODE_ACTOR_MANAGER`, or a chain's `startFrom`) keeps an entry that is not a non-empty string as written instead of dropping it, so the publish lint names that entry. A notify node's chain with a missing or non-integer `minPositionLevel` is now refused by `readOrgManagerChainIssue` (readiness and publish, reported as `知會節點需要指定有效的職等門檻。`); before, the climb never stopped and collected every manager up to the top. A signer's chain gets the same check from the shared function, with the same wording. | `v0.21.1` |
| Paged inbox and approval history: `inboxTasks` and `approvalHistoryTasks` take optional `page` / `pageSize` (absent means the old behaviour: every open task, and the latest 50 history tasks) and `approvalHistoryTasks` an optional `instanceState`; new `inboxTaskCount` and `approvalHistoryTaskCount(instanceState)`. `WorkflowEngineService.listInboxTasks(memberId, options?)` / `countInboxTasks` / `listApprovalHistoryTasks(memberId, options?)` / `countApprovalHistoryTasks` with `TaskListPageOptions` and `ApprovalHistoryTaskListOptions`. History is now one query ordered by when the member acted (their candidate row's `decided_at`, else the task's `completed_at`, else `created_at`, then id) instead of two capped branches merged. Client `listInboxTasksPage` / `listApprovalHistoryTasksPage` (`MemberTaskPage`); `InboxView` pages all three tabs on the server, reads history only once its tab is opened, moves to the last page when the chosen one has emptied, and its badges count every page; `inboxTasks` and `inboxTaskCount` asked in one request share a single read of the open tasks. **Breaking:** the admin-only `cachedMembers` query is removed (it had no caller), and with it the GraphQL type `MemberMetadataCache`; `IdentityService.listCachedMembers` stays | `v0.22.0` |
| Host integration round (ADR 27), in progress: migration `HostIntegrationRound0000000032000` (`approval_templates.key` / `host_managed`, `form_definitions.host_managed`, `approval_template_versions.launch_mode`, the `approval_instance_events` outbox table); entity fields `ApprovalTemplateEntity.key` / `hostManaged`, `FormDefinitionEntity.hostManaged`, `ApprovalTemplateVersionEntity.launchMode` with `ApprovalTemplateLaunchModeEnum`; `templateIds` / `templateKey` on `inboxTasks` / `inboxTaskCount` / `approvalHistoryTasks` / `approvalHistoryTaskCount`, `TaskTemplateFilter` / `InboxTaskListOptions`, and the client `MemberTaskTemplateFilter`; the service-only `initiatorCustomFields` on `submitApprovalInstance`; `HOST_ONLY` launch mode (launchable list, GraphQL submit and resubmit 403, `launchMode` on `UpdateApprovalTemplateDraftInput` / `ComposeApprovalTemplateWithFormInput`); the `expressionMissingFormFieldsAsNull` runtime option and the optional `formSchemaJson` on `DryRunApprovalWorkflowInput`; `templateKey` on `approvalInstances` / `approvalInstanceCount` / `approvalInstancePageInfo` (`ListApprovalInstancesOptions.templateKey`); an approver-filled boolean may be `fill: 'REQUIRED'` (ADR 27 §4.1) — **breaking:** the `approverFilledRequiredBoolean` member is removed from `FieldAccessIssueCode` and `WORKFLOW_LINT_MESSAGES`, and the approver fill form now sends an untouched required boolean as the `false` it shows; a data-source field may carry a `defaultValue` when none of its bindings is `FIELD` / `ROW_FIELD` / `EXPRESSION` (ADR 27 §8: the renderer resolves an untouched default, submit still refuses one the source no longer offers, and the designer warns after a publish whose default does not resolve) | Not yet released |

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

Type contracts plus pure runtime helpers (no I/O, no framework). The root and the subpath modules export runtime values as well as types: the field-permission helpers, the `WORKFLOW_LINT_MESSAGES` builders and the graph, command and toolset functions listed below.

## `@rytass/bpm-core-shared` (root)

Re-exports the seven subpath modules listed below, plus the identity and organization contract types and the field-access helpers in the tables that follow. There are no `identity`, `organization` or `field-access` subpaths: none appears in the `exports` map, so `@rytass/bpm-core-shared/identity`, `@rytass/bpm-core-shared/organization` and `@rytass/bpm-core-shared/field-access` do not resolve.

| Name | Kind | Purpose |
|---|---|---|
| `MemberMetadata` | interface | Display-time member metadata |
| `MemberMetadataCacheEntry` | interface | Cached metadata + TTL |
| `OrgUnitType` | type | `'COMPANY' \| 'DIVISION' \| 'DEPARTMENT' \| 'TEAM'` (uppercase, the GraphQL wire format) |
| `ManagerResolutionScopeType` | type | `'MEMBER' \| 'ORG_UNIT' \| 'POSITION'` |
| `DEFAULT_BPM_ORGANIZATION_TIME_ZONE` | const | `'Asia/Taipei'` — the zone BPM reads "today" in against organization effective dates when the host sets no `organizationTimeZone`; shared by the engine and the React designer. Released in v0.21.1 |
| `OrgUnit` | interface | Org-unit node |
| `Position` | interface | Position |
| `Membership` | interface | member × orgUnit × position relation |
| `ManagerResolution` | interface | "Who is whose manager" rule |

### Field access (root only)

Helpers over `UserTaskNodeData.fieldAccess`. They live in `libs/shared/src/lib/field-access.ts` and are exported from the package root only. Only top-level `fieldKey`s are addressed; a table field is set as a whole. None of them reads the deprecated `fieldPermissions`.

| Name | Kind | Purpose |
|---|---|---|
| `ResolvedFieldAccess` | interface | `{ editable, visible }` — what a viewer may do with one field |
| `readNodeFieldAccess(node)` | function | The node's `fieldAccess`, tolerant of a bad draft: a non-array reads as `[]`, entries that are not objects or lack a non-empty `fieldKey` string are skipped, the first entry per `fieldKey` wins, an unknown `fill` reads as `NONE` and an unknown `display` as `SHOW` |
| `readTopLevelFieldKey(fieldPath)` | function | The top-level form field a path addresses: `items.price` and `items[0]` both read `items` |
| `readFormFieldPathTopLevelKey(fieldPath)` | function | The top-level form field a `SET_FORM_FIELD` `fieldPath` writes, read the way the engine writes it: an optional leading `form.` / `formData.` segment is dropped and segments are trimmed, so `form.amount` reads `amount`. The publish lint uses it to refuse a system node writing an approver-filled field |
| `readNodeFillableFieldKeys(node)` | function | `fieldKey`s the node's approver may fill in (`fill !== 'NONE'`) |
| `readNodeRequiredFieldKeys(node)` | function | `fieldKey`s with `fill === 'REQUIRED'` |
| `readApproverFilledFieldKeys(definition)` | function | Union of the fillable keys of every user task — the fields filled in by approvers rather than the applicant |
| `readRevealedFieldKeys(definition, nodeIdsWithNonAdhocTask)` | function | Union of the fillable keys of the user tasks among the given node ids (nodes that already produced a non-ad-hoc task); ids that are missing or not a user task are skipped |
| `resolveFieldAccess({ definition, fieldKeys, isAdhocTask, nodeId, revealedFieldKeys })` | function | `Record<fieldKey, ResolvedFieldAccess>` for `fieldKeys`. First match wins: (1) the non-ad-hoc task's node lists the field → `visible` is `display === 'SHOW'`, `editable` is `fill !== 'NONE'`; (2) an ad-hoc task's node lists it → configured visibility, never editable; (3) an approver-filled field → read-only, visible once revealed and hidden before; (4) anything else → visible, read-only |
| `omitFormDataKeys(formData, keys)` | function | Copy of `formData` without `keys` |
| `overlayStoredFormDataKeys(submitted, stored, keys)` | function | `submitted` with each of `keys` replaced by the stored value when `stored` has it as an own property, and left out when it does not |
| `isFormDataValueEmpty(value)` | function | `true` for `undefined`, `null`, a blank string and an empty array; `false` for `false`, `0`, `NaN` and objects |

### Field access lint (root only)

The field access publish rules as structured issues, in `libs/shared/src/lib/field-access-lint.ts`, exported from the package root only. The backend publish lint maps each issue to its `message` (a `WORKFLOW_LINT_MESSAGES` line, so the lint output is unchanged), and the designer reads the same issues to place them on fields and nodes. The early-read rule (`approverFilledFieldReadEarly`) is not here: it needs every node's expression sources and stays in `TemplateService`.

| Name | Kind | Purpose |
|---|---|---|
| `FieldAccessIssue` / `FieldAccessIssueCode` | interface / type | `{ code, fieldKeys, message, nodeIds }`. `code` names the `WORKFLOW_LINT_MESSAGES` key the message comes from; `fieldKeys` lists the offending field first (`applicantRuleReadsApproverFilled` lists the applicant's field, then the approver-filled one); `nodeIds` is in definition order where there are two |
| `UserTaskFillConflict` | type | `'autoApprove' \| 'groupPolicy' \| 'skipNode'` |
| `readUserTaskFillConflicts(node)` | function | Why the node cannot let its approver fill fields in: `PARALLEL_ALL` / `QUORUM`, `sla.onTimeout: AUTO_APPROVE`, `excludeInitiator.whenEmpty: SKIP_NODE`. Read whether or not the node fills anything in |
| `readNodeFieldAccessIssues(node)` | function | One user task's issues in lint order: the deprecated `fieldPermissions` key, an invalid `fieldAccess` (which stops there), duplicates, fill with `display: 'HIDE'`, then the fill conflicts when the node fills a field in |
| `readDefinitionFieldAccessIssues(definition)` | function | A `SET_FORM_FIELD` serviceTask writing an approver-filled field, then two fill nodes of one field that can both run in one case |
| `readFormFieldAccessIssues(definition, schema)` | function | The issues against the bound form: unknown `fieldKey`, a field the form will not let an approver fill in, `REQUIRED` on a boolean, an applicant's rule reading an approver-filled field. `schema: null` reads every `fieldKey` as unknown |
| `readFormFieldFillIssues(field)` | function | Why one form field cannot be filled in by an approver (form rule, data source, file upload, table with a data-source column); empty when it can |
| `readReachableWorkflowNodeIds(edges, startNodeIds, blockedNodeIds?)` | function | Nodes reachable from the start nodes without entering a blocked one, the start nodes included unless blocked; cycle-safe |
| `createWorkflowCoRunReader(definition)` | function | `(nodeId, otherNodeId) => boolean`: whether both nodes can run in one case (one reaches the other, or a parallel split sends each down its own branch) |
| `readWorkflowParallelBranchSets(definition, readReachable?)` | function | For every `parallelGateway` with at least two outgoing edges, one reachable-node set per outgoing edge (edge order). The branch half of `createWorkflowCoRunReader`, extracted unchanged; `readReachable` lets a caller pass a cached reader |
| `isOnOwnParallelBranch(branches, nodeId, otherNodeId)` | function | Whether one parallel split (one entry of `readWorkflowParallelBranchSets`) sends the two nodes down branches of their own: each is reachable only from a different outgoing edge. Two nodes in a row, on one branch, or both after the join are not |
| `isFieldAccessEntryValid(entry)` | function | Whether a stored entry is one the publish lint accepts: a non-blank `fieldKey` and a known `display` / `fill`. Stricter than `readNodeFieldAccess` (the engine's reader), which lets a whitespace `fieldKey` through; `setFieldAccessMatrix` checks entries with this one |
| `FIELD_ACCESS_DISPLAYS` / `FIELD_ACCESS_FILLS` | const | The accepted `display` / `fill` values, shared by the lint, the command and the assistant tool schema |
| `referencesFormField(expression, fieldKey)` | function | Whether a CEL expression reads the top-level field (`form.x`, `formData.x`, `form["x"]`, deeper steps and `has(...)` included; `myform.x` and `form.xy` do not count). Moved from the backend, which now imports it |

### Field access matrix (root only)

The designer's 欄位與關卡總覽, in `libs/shared/src/lib/field-access-matrix.ts`, exported from the package root only. It reads the same `field-access-lint` rules as the publish lint, so the two cannot disagree (pinned by `field-access-matrix.parity.spec.ts` in bpm-core).

| Name | Kind | Purpose |
|---|---|---|
| `readFieldAccessMatrix(definition, schema)` | function | `{ columns, rows, issues }`: one column per user task in flow order (topological; a loop is entered at the node the flow leads into first), one row per top-level form field (none without a form), and every publish-blocking field access issue apart from the early-read rule, in lint order |
| `FieldAccessMatrix` / `FieldAccessMatrixColumn` / `FieldAccessMatrixRow` / `FieldAccessMatrixCell` | interface | A column carries `stage` (1-based), `label`, `branchLabel` (the label of an edge from an exclusive gateway straight into the node), `fillConflicts` and its node-level `issues`. A row carries the `applicant` value, one cell per column, `fillNodeIds`, `fillBlockers`, its `issues` and `notices`. A cell carries `explicit` (the node's entry or `null`), `choice`, `effective`, `reason` and `disabledChoices` |
| `FieldAccessEffective` | type | `'FILL' \| 'READ_ONLY' \| 'NOT_SHOWN' \| 'HIDDEN' \| 'FILL_OPTIONAL' \| 'FILL_REQUIRED'`. Without an entry, an approver-filled field reads `READ_ONLY` at a node that a fill node earlier in the column order reaches, `NOT_SHOWN` otherwise; an ordinary field reads `READ_ONLY` |
| `FieldAccessCellReason` | type | `'EXPLICIT' \| 'APPLICANT_FIELD' \| 'FILLED_EARLIER' \| 'NOT_YET_FILLED'` |
| `FieldAccessNotice` | interface | A non-blocking hint: `shownBeforeFilled` (a node explicitly shows an approver-filled field before anybody filled it in) |
| `FieldAccessChoice` / `FIELD_ACCESS_CHOICES` | type / const | What a cell offers: `DEFAULT` (no entry), `SHOW`, `HIDE`, `FILL_OPTIONAL`, `FILL_REQUIRED` |
| `readFieldAccessChoice(entry)` | function | The choice an entry (or `null`) stands for; a hidden fill reads as the fill it asks for |
| `readFieldAccessEntryForChoice(fieldKey, choice)` | function | The entry a choice writes, `null` for `DEFAULT`; a fill is always `display: 'SHOW'` |

Expression function contract (ADR 22 §3.5), root export only — released in v0.20.0:

| Name | Kind | Purpose |
|---|---|---|
| `BPMExpressionValueType` | type | `'bool' \| 'double' \| 'dyn' \| 'int' \| 'list' \| 'map' \| 'null' \| 'string'`: the CEL type a function parameter or result declares |
| `BPMExpressionValue` | type | A JSON value as a function receives and returns it |
| `BPMExpressionFunctionParameter` | interface | `name`, `type`, optional `description` |
| `BPMExpressionFunctionDescriptor` | interface | A function without its handler — what the designer, catalog and publish lint see: `name`, `label`, `description`, `parameters`, `returnType`, `builtIn` |
| `BPM_BUILT_IN_EXPRESSION_FUNCTION_NAMES` / `BPMBuiltInExpressionFunctionName` | const / type | The nine reserved built-ins: `abs`, `ceil`, `floor`, `lower`, `max`, `min`, `round`, `trim`, `upper` |
| `BPM_EXPRESSION_FUNCTION_NAME_PATTERN` | const | `^[a-z][A-Za-z0-9]*(_[A-Za-z0-9]+)*_v[0-9]+$`: host function names carry their version. Matching it is necessary, not sufficient: the registry also refuses a built-in name and a name starting with `true`, `false` or `null` (see `validateExpressionFunctions`) |

Expression use points and lint codes (ADR 22, docs/24 §2.2–§2.3, Phase 23 P2), in `libs/shared/src/lib/expression-usage-point.ts`, root export only — released in v0.20.0:

| Name | Kind | Purpose |
|---|---|---|
| `EXPRESSION_USAGE_POINTS` / `ExpressionUsagePoint` | const / type | The nine use points: `INITIATOR_POLICY`, `ENTRY_CONDITION`, `FLOW_CONDITION`, `APPROVER_RESOLVER`, `SERVICE_FORM_FIELD_VALUE`, `WEBHOOK_PAYLOAD`, `DELEGATION_CONDITION`, `DATA_SOURCE_BINDING`, `NOTIFY_WEBHOOK_BINDING` |
| `EXPRESSION_ROOT_IDENTIFIERS_BY_USAGE_POINT` | const | The root identifiers each use point evaluates with (`FLOW_CONDITION` adds `lastDecision`, `DELEGATION_CONDITION` adds `principal`, `INITIATOR_POLICY` is `env` / `initiator` / `subject`, the two bindings read `form` (and `row`)) |
| `EXPRESSION_USAGE_POINTS_WITHOUT_HOST_FUNCTIONS` / `allowsHostExpressionFunctions(usagePoint)` | const / function | The bindings, which may call only the built-ins |
| `isExpressionUsagePoint(value)` | function | Type guard |
| `EXPRESSION_LINT_ERROR_CODES` / `ExpressionLintErrorCode` | const / type | The twelve codes that refuse a publish (`EXPR_PARSE_FAILED` … `EXPR_FUNCTION_NOT_ALLOWED`) |
| `EXPRESSION_LINT_WARNING_CODES` / `ExpressionLintWarningCode` | const / type | The warnings: `EXPR_OPTIONAL_FIELD_WITHOUT_HAS`, `EXPR_OR_ABSORBS_ERROR`, `EXPR_HAS_NESTED_PARENT`, `EXPR_APPROVER_READS_FORM`, `EXPR_HIDDEN_FIELD_COPIED`, `EXPR_DIVISOR_IS_FIELD`, and (Phase 23 P4) `EXPR_LAST_DECISION_UNAVAILABLE` — an edge condition reads `lastDecision` but leaves a node that records no decision (anything but a `userTask`), so it is always `null` there; reported by the designer preview and analysis, not by `ConditionService` |
| `ExpressionLintCode` / `ExpressionLintSeverity` / `ExpressionLintIssue` | type / type / interface | One finding: `code`, `label`, `severity` (`'ERROR' \| 'WARNING'`), optional `subject` (an identifier only) |
| `isExpressionLintCode(value)` / `readExpressionLintSeverity(code)` | function | Type guard / the severity a code has |
| `formatExpressionLintIssue(issue)` / `parseExpressionLintLine(line)` / `ParsedExpressionLintLine` / `EXPRESSION_LINT_SUBJECT_PATTERN` | function / function / interface / const | The publish-lint line `<label>: <code>[ <subject>]` and its parser; a subject that is not an identifier is dropped, so a line never carries `'; '` |
| `UNKNOWN_EXPRESSION_DIALECT_LINT_MESSAGE` | const | `workflow.expressionDialect must be cel-legacy or cel-v2`, the line publish refuses an unknown dialect with |

### Form field filters (root only, ADR 25)

Approval-instance list filtering and sorting by form field, in `libs/shared/src/lib/form-filter.ts`, exported from the package root only (released in v0.21.0). The same functions decide every check: the write-time type check, the enable-time scan of old instances, the list query compiler and the designer's warnings.

| Name | Kind | Purpose |
|---|---|---|
| `FILTERABLE_FIELD_TYPES` / `FilterableFieldType` | const / type | Top-level types a designer may mark `filterable`: `autocomplete`, `boolean`, `checkbox`, `date`, `datetime`, `member`, `money`, `number`, `org_unit`, `radio`, `select`, `text`, `textarea`. `file_upload` and `table` are not allowed |
| `FILTERABLE_TABLE_COLUMN_TYPES` | const | Table column types allowed to be `filterable`: every `TABLE_COLUMN_FIELD_TYPES` entry |
| `isFilterableFieldType(type, placement?)` | function | Whether a type may be `filterable`; `placement` is `'top-level'` (default) or `'column'` |
| `APPROVAL_INSTANCE_SORT_TIME_FIELDS` / `ApprovalInstanceSortTimeField` / `isApprovalInstanceSortTimeField()` | const / type / function | The sort keys that are not form fields: `submittedAt`, `updatedAt`, `completedAt`. A filterable fieldKey must not reuse one of them |
| `APPROVAL_INSTANCE_FIELD_FILTER_OPERATORS` / `ApprovalInstanceFieldFilterOperator` | const / type | `EQUALS`, `NOT_EQUALS`, `IN`, `RANGE`, `CONTAINS` |
| `readFilterOperatorsForFieldType(type)` | function | The operators a field type accepts (`textarea`: `CONTAINS` only; `boolean`: `EQUALS` only; date and datetime: no `IN`, no `CONTAINS`) |
| `ApprovalInstanceFieldFilter` | interface | One condition: `fieldKey` (a top-level key, or `<tableKey>.<columnKey>`), `operator`, optional `values`, `from`, `to`. Values are strings |
| `ApprovalInstanceSortDirection` / `ApprovalInstanceSort` | type / interface | `'ASC' \| 'DESC'`; a sort key with `field` and an optional `direction` |
| `FilterableValueKind` / `readFilterableValueKind(type)` | type / function | How a stored value compares: `text`, `number` (also `money`), `date`, `datetime`, `boolean`, `option`, `member`, `org_unit`; `null` for a type that cannot be filtered |
| `FilterableFieldPath` | interface | A filterable field or column as the list sees it: `path`, `tableKey`, `key`, `field`, `kind`, `label`, `staticOptions`, `usesOptionSnapshot` |
| `readFilterableFieldPaths(schema)` | function | Every filterable field and column of a schema whose type allows it; a field marked with a disallowed type is skipped here (the lint reports it) |
| `findFilterableFieldPath(schema, path)` | function | The `FilterableFieldPath` for one path, or `null` |
| `isFilterableFieldSortable(path)` | function | Top-level and not `textarea`; table columns are never sortable |
| `readFormFieldTypesByPath(schema)` | function | Type of every field and column by path, filterable or not; used for the history-type check |
| `FilterableValueCheck` / `checkFilterableFieldValue(field, value)` | type / function | `empty`, `valid` or `invalid` (with `expected`, a Chinese phrase such as `數字`, `日期（YYYY-MM-DD）` or `表格列的清單` that completes 「必須是…」) for one stored value. Missing and `null` are empty; `""` is empty for number, money, date, datetime and boolean; option and member fields accept a string or a string array |
| `isCanonicalDate(value)` / `isCanonicalDateTime(value)` | function | `YYYY-MM-DD` (a real calendar date) / `YYYY-MM-DDTHH:mm:ss.sssZ` (the `Date#toISOString()` shape) |
| `FilterableValueProblem` / `readFilterableValueProblems(paths, formData)` | interface / function | Every value in `formData` that does not fit a path, with the table row index when it is in a table; `path` is the top-level key, `<tableKey>.<columnKey>` for a bad cell, or the bare table key when the table or one of its rows is malformed; `expected` is the Chinese phrase described above |
| `FilterableFieldIssue` | type | A reason a field cannot be enabled: `{ kind: 'TYPE_CHANGED', conflicts }` (an older version with instances stored another type) or `{ kind: 'INVALID_VALUES', invalidInstanceCount, samples }` |
| `FILTERABLE_FIELD_ISSUE_SAMPLE_LIMIT` | const | 5: samples kept per issue (instance id, row index and expected type; never the stored value) |
| `readFilterableFieldIssues({ schema, history, instances })` | function | The enable check as a pure function: the issues for the schema about to take effect, given older versions and the template's instances |
| `describeFilterableFieldIssue(issue)` | function | The Chinese sentence for an issue, shared by the designer and the publish error. Stored values are never quoted in it, only instance ids and row numbers |

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
| `BaseFormFieldDefinition.filterable` | property | `filterable?: boolean` (default off) on every field and table column definition, set by the form designer. A filterable field can be used in the approval-instance list's field filters, and a top-level one can be sorted on. Its key and type are locked once marked; values are type-checked on every write (ADR 25). Allowed types are in `FILTERABLE_FIELD_TYPES` and `FILTERABLE_TABLE_COLUMN_TYPES` (root). Released in v0.21.0 |
| `FormFieldValue` | type | Union of all field-value variants (cell value or table rows) |
| `FormTableCellValue` | type | Primitive value contract for a flat field or a table cell |
| `FormTableRowValue` | type | One table row: column key to cell value |
| `TextFieldDefinition` | type | `text` / `textarea`, optional `minLength` / `maxLength` (counted in code points) and `pattern` (a regular expression the whole value must match, `u` flag) with an optional `patternErrorMessage`, all enforced by the engine and the renderer; `displayAs?: 'link'` renders a safe path or http(s) URL as a link in read-only views. Every field also takes `hidden?: boolean` (store only, never rendered; not a permission boundary) — see docs/08 §7 |
| `NumberFieldDefinition` | type | `number` / `money`, optional `minimum` / `maximum` |
| `DateFieldDefinition` | type | date / datetime |
| `FormSelectionMode` | type | `single` or `multiple` option selection |
| `FormDataSourceReference` | interface | Registered source key, version, and bindings |
| `FormDataSourceBinding` | interface | One parameter bound to a source |
| `FormDataSourceBindingSource` | type | Top-level field (`FIELD`), primitive constant (`CONSTANT`), same-row column (`ROW_FIELD`), or a cel-v2 expression (`EXPRESSION`, `{ expression }`; roots `form` and, in a table column, `row`; built-in functions only; evaluated by the backend from the stored schema, never by the browser — ADR 22 §3.7, Phase 23 P5) |
| `FORM_DATA_SOURCE_BINDING_KINDS` / `FormDataSourceBindingKind` / `isFormDataSourceBindingKind()` | const / type / function | Every binding source kind this version knows (`CONSTANT`, `EXPRESSION`, `FIELD`, `ROW_FIELD`), for exhaustive handling: a kind outside the list is refused (backend) or shown as unsupported (builder), never read as another kind (Phase 23 P5) |
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
| `ATTACHMENT_NOT_BINDABLE_ERROR_CODE` | const | Leads the server message refusing a `file_upload` value that names an attachment the case may not take |
| `MemberFieldDefinition` | type | 人員選擇 field — stores a member id, or an array of ids when `multiple` is true |
| `OrgUnitFieldDefinition` | type | 組織選擇 field — stores a single organization unit id string; `multiple` is not supported and it is not a table column type |
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
| `isOrgUnitFieldDefinition()` | function | Org unit field type guard |
| `isFormOrgUnitValue()` | function | Whether a value is a well-formed org unit value (a non-blank string) |
| `isFormMemberValue()` | function | Whether a value is a well-formed member value (non-empty string, or array of non-empty strings when `multiple`) |
| `readFormMemberIds()` | function | Member ids held by a member field value, whichever shape it has |
| `isTableFieldDefinition()` | function | Table field type guard |
| `isTableColumnFieldType()` | function | Whether a field type may be used as a column |
| `readTextFieldValueIssue()` | function | The first length or format rule a text value breaks (`TextFieldValueIssue`: `minLength` / `maxLength` with `limit`, `pattern` with the designer's `message`, or `type` for a value that is not a string on a field that sets any rule), `null` for an empty value or one that passes; an uncompilable pattern counts as a mismatch. Shared by the engine and the renderer |
| `hasRepeatedTextFieldPatternGroup()` | function | Whether a pattern repeats a group: `(…)` followed by `*`, `+`, `{n,}`, `{n,m}` with m > 1 or `{n}` with n > 1. A repeated group is the only way a pattern's backtracking grows exponentially with the value (`(a+)*`, `(\\w\|\\d)+`, `(a?a?)+`); without one the cost is at most polynomial in the value, with a degree that grows with the pattern (a dozen `\\w*` is slow on a few dozen characters), which the engine bounds with its time budget and the browser does not. Conservative: safe repeated groups such as `(-[a-z]+)*` or `(ab){2}` are refused too. Used by the schema linter and the form builder |
| `TEXT_FIELD_PATTERN_TIME_BUDGET_MS` | const | 50: the matching time the text field patterns of one validation pass share, in the engine (`vm` timeout) and in the form renderer's worker. Moved here from the engine, which still re-exports it |
| `TEXT_FIELD_PATTERN_MAX_LENGTH` / `TEXT_FIELD_PATTERN_ERROR_MESSAGE_MAX_LENGTH` | const | 500 / 200: the longest pattern and the longest error message the schema linter accepts |
| `TextFieldPatternTest` | type | `(pattern: RegExp, value: string) => boolean`, passed to `readTextFieldValueIssue` as `testPattern` to run the compiled pattern. Defaults to `RegExp#test`; the engine passes one that charges each run's matching time to a shared budget and throws when the budget is spent |
| `compileTextFieldPattern()` | function | Compiles a `pattern` anchored to the whole value with the `u` flag, `null` when it does not compile |
| `TextFieldValueIssue` | type | Result of `readTextFieldValueIssue` |
| `isFormTableCellValue()` | function | Primitive cell-value guard |
| `isFormTableRowValue()` | function | Single table row guard |
| `isFormTableRowValues()` | function | Table row array guard |
| `readFormTableCellValue()` | function | Narrow a field value to a cell value, `undefined` for table rows |
| `isFormIdentifierKey()` | function | Whether a key is a plain identifier (required for table and column keys) |
| `readFormFieldSelectionMode()` | function | Normalized control selection mode |
| `normalizeFormDefinitionSchema()` | function | Additive legacy-schema normalization, recursing into table columns |
| `FORM_DATA_ISSUE_REASONS` | const | Reasons a submitted form value is refused, for exhaustive handling: `REQUIRED`, `TYPE`, `MIN_LENGTH`, `MAX_LENGTH`, `PATTERN`, `PATTERN_TIMEOUT`, `MIN_ROWS`, `MAX_ROWS`, `UNKNOWN_COLUMN` (released in v0.21.0); `MAX_FILES` (a `file_upload` value holding more files than its `maxFiles`, counting each distinct id once, as the attachment binding attaches it; submit and resubmit check every `file_upload` field, shown or not; released in v0.21.1) |
| `FormDataIssueReason` | type | `(typeof FORM_DATA_ISSUE_REASONS)[number]`. Released in v0.21.0 |
| `FormDataIssue` | interface | `{ path, reason, message, limit? }` for one refused value. `path` addresses it: a top-level `fieldKey`, a table row `table[i]` (0-based), or a cell `table[i].col`. `message` is the sentence the host shows. `limit` is set for `MIN_LENGTH`, `MAX_LENGTH`, `MIN_ROWS` and `MAX_ROWS`. Released in v0.21.0 |
| `isFormDataIssue(value)` | function | Type guard for a `FormDataIssue`, for values read from a response. Released in v0.21.0 |

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
| `WorkflowDefinition` | interface | Full definition (nodes + edges + meta). Optional `expressionDialect` (ADR 22 §3.3): the engine every expression in the definition is evaluated with; absent means `cel-legacy`, so earlier definitions and case snapshots keep their behaviour. `lintWorkflowDefinition` refuses any other value |
| `WorkflowExpressionDialect` | type | `'cel-legacy' \| 'cel-v2'` — `cel-js` 0.8.2 and `@marcbachmann/cel-js` 8. Names only; the shared package loads no engine |
| `WorkflowDefinitionMeta` | interface | Version, author, etc. |
| `WorkflowNode` | type | Union of all node variants |
| `NodePosition` | interface | xyflow canvas coords |
| `BaseNodeData` | interface | Fields every node shares |
| `BaseWorkflowNode` | generic interface | Generic node base type |
| `WorkflowNodeTriggerMode` | type | `'AND' \| 'OR'` |
| `StartEventNode` / `EndEventNode` / `UserTaskNode` / `ServiceTaskNode` / `ExclusiveGatewayNode` / `ParallelGatewayNode` | type | Concrete node variants |
| `UserTaskNodeData` | interface | userTask-specific data. `requireApprovalComment?: boolean` — `true` makes the engine refuse a person's approval at this node that carries no non-blank comment (「此節點要求同意時填寫意見，請輸入意見後再同意。」, `BadRequestException`); an ad-hoc task at the node (countersign, pre-approval) is held to it too, the SLA `AUTO_APPROVE` timeout is not. Read from the instance's workflow snapshot; omitted or `false` accepts an approval without a comment |
| `ApproverResolver` | type | DIRECT / POSITION / ORG_UNIT_MEMBER / ORG_UNIT_POSITION / ORG_MANAGER / ORG_UNIT_MANAGER / DYNAMIC_FORM / EXPRESSION / FORM_MEMBER_MANAGER (`{ type, formPath, levelsUp, preferClosestOrgUnit?, fallback? }` — the manager of the member picked in a form field) / FORM_ORG_UNIT_MANAGER (`{ type, formPath, preferClosestOrgUnit?, fallback? }` — the manager of the org unit picked in a form field) / NODE_ACTOR (`{ type, nodeIds }` — whoever actually approved the most recent round among the listed earlier nodes: with several nodes listed, only the newest batch of tasks the case reached counts, not every listed node's signers; SLA auto-approvals, ad-hoc tasks and cancelled tasks do not count) / NODE_ACTOR_MANAGER (`{ type, nodeIds, levelsUp, preferClosestOrgUnit?, fallback? }` — the manager of those signers) / ORG_MANAGER_CHAIN (`{ type, minPositionLevel, startFrom?, startPositionLevel?, fallback? }` — every manager up a chain, ending at the first whose position level reaches `minPositionLevel`; the chain starts at the initiator unless `startFrom` (`OrgManagerChainStart`: `INITIATOR`, `{ type: 'FORM_MEMBER', formPath }` — the one person picked in a single-person member field, or `{ type: 'NODE_ACTOR', nodeIds }` — the one person who actually approved the listed earlier nodes) names someone else, and the start person is never on the chain; managers below `startPositionLevel` are walked past without signing, and the first one at or above it starts the chain; both keys are optional and an older engine ignores them, climbing from the initiator; a notify node's chain may only start at the initiator; on such a node a delegate or a manual transfer target must hold at least the position level of the member they replace — a delegation that falls short is not applied and is recorded in the `skippedDelegations` payload field of `TASK_CREATED` / `TASK_CANDIDATE_ACTIVATED`, a transfer is rejected with `ForbiddenException`; SLA escalation is exempt) |
| `ApproverResolverFallback` | type | Fallback when a manager resolver (`ORG_MANAGER` / `ORG_UNIT_MANAGER` / `ORG_MANAGER_CHAIN` / `FORM_MEMBER_MANAGER` / `FORM_ORG_UNIT_MANAGER` / `NODE_ACTOR_MANAGER`) finds no manager: `NONE`, `DIRECT` (`memberId`, optional `allowInitiatorSelfApproval`), or `POSITION` (`positionId`, optional `allowInitiatorSelfApproval`; every current holder becomes an approver, the initiator is dropped unless self approval is allowed). `POSITION` was released in `v0.17.0`. Needs engine ≥ the version that introduced `POSITION`; older engines refuse a template carrying it at run time |
| `readUnsupportedApproverFallbackType(fallback)` | function | The fallback's `type` when this build does not know it (a definition saved by a newer version), otherwise `null`. The single list of known fallback types, read by both the engine (refuses at run time) and the designer (keeps it read-only); adding a member to `ApproverResolverFallback` does not compile until it is listed |
| `readUnsupportedApproverResolverType(resolver)` | function | The resolver's `type` when this build does not know it (a definition saved by a newer version), otherwise `null`. The single list of known resolver types; the engine refuses an unknown one at run time instead of resolving it as `ORG_MANAGER`; adding a member to `ApproverResolver` does not compile until it is listed |
| `OrgManagerChainStart` / `readUnsupportedOrgManagerChainStartType(start)` | type/function | Whose manager an `ORG_MANAGER_CHAIN` starts climbing from: `INITIATOR`, `FORM_MEMBER` (`formPath`) or `NODE_ACTOR` (`nodeIds`). `readUnsupportedOrgManagerChainStartType` returns the start's `type` when this build does not know it (a definition saved by a newer version), otherwise `null`; the engine refuses an unknown start by name instead of climbing from the initiator |
| `isOrgManagerChainStartedFromInitiator(resolver)` / `readOrgManagerChainStartPositionLevel(resolver)` | function | Whether the chain starts at the initiator (`startFrom` absent, `null` or `INITIATOR`), and its `startPositionLevel` as a finite number or `null` when it has none |
| `formatOrgManagerChainPlaceholder(resolver)` / `parseOrgManagerChainPlaceholder(text)` / `OrgManagerChainPlaceholder` | function/type | The dry-run placeholder of a manager chain and its reader. `orgManagerChain:<min>` when neither setting is used; `orgManagerChain:<min>:<startLevel>` with only a start level; `orgManagerChain:<min>:<startLevel>:<formMember\|nodeActor>:<key>` with a start (`<startLevel>` empty when there is none, `<key>` the form path or the node ids joined by `,`, always last because it may hold a colon; a node id must not contain a comma, since the key is split on commas when read back, and a fractional start level is written and read back as is) |
| `isNotifyRecipientResolverType(type)` | function | Whether a notify node may use this resolver type for recipients: the nine original types, not `FORM_MEMBER_MANAGER` / `FORM_ORG_UNIT_MANAGER` / `NODE_ACTOR` / `NODE_ACTOR_MANAGER` |
| `isFallbackCapableApproverResolverType(type)` | function | Whether a resolver of this type may carry a `fallback`: `ORG_MANAGER`, `ORG_UNIT_MANAGER`, `ORG_MANAGER_CHAIN`, `FORM_MEMBER_MANAGER`, `FORM_ORG_UNIT_MANAGER`, `NODE_ACTOR_MANAGER` |
| `DecisionPolicy` | type | SINGLE / SEQUENTIAL / PARALLEL_ALL / PARALLEL_ANY / QUORUM |
| `ReturnBehavior` | interface | Return-handling settings (incl. `requireComment`, which is about returning; the comment required when approving is `UserTaskNodeData.requireApprovalComment`). `allowedTargets`: `INITIATOR` returns to the applicant, `PREVIOUS` to the source of the node's first incoming edge, `ANY` to a node the approver picks among `readSelectableReturnTargetNodeIds` |
| `ReturnResubmitStrategy` | type | `'FROM_RETURN_POINT' \| 'RESTART'` |
| `SlaConfig` | interface | SLA timer config (incl. `calendar`) |
| `ExcludeInitiatorConfig` | interface | `UserTaskNodeData.excludeInitiator` — separation of duties: when present the instance's initiator is never one of the node's approvers (a delegate acting for them counts as them), and neither is the member who submitted on their behalf (`submittedByMemberId`, same rule; an `ORG_MANAGER_CHAIN` walk climbs past him instead of stopping at him). `{ whenEmpty }`; absent keeps the previous behaviour |
| `ExcludeNodeActorsConfig` | interface | `UserTaskNodeData.excludeNodeActors` — separation of duties between stages: `{ nodeIds, whenEmpty }`. When present, nobody who actually approved one of the listed earlier user tasks is one of the node's approvers (a delegate acting for them counts as them, in either direction). "Who approved" is the `NODE_ACTOR` reading (most recent round, real approvals only, no ad-hoc and no SLA auto-approval, the actual approving delegate, the transfer receiver), applied to each listed node on its own and combined; a delegate's approval also excludes the member who delegated to them (the rule-delegation principals on the candidate row, a transferor is not one). A manual transfer or administrator reassignment to a member with a delegation link to an excluded member is refused, as task creation drops such a candidate. Released in v0.21.1. Every listed node must be a stage that always runs and always has a person sign (publish lint, each listed node checked on its own: no entry condition, no `SKIP_NODE`, no SLA auto-approval, on every path to the node, upstream of it); a conditional stage is not supported, put both stages on the same route with a gateway. The engine reads the newest round of each listed node, so a return back to a stage below the listed one keeps that stage's earlier approver excluded. May be combined with `excludeInitiator` (the two lists are united; the initiator rule runs first and decides `whenEmpty` when it alone leaves nobody). Absent keeps today's behaviour. Runtime rules: `docs/07` §4.5 |
| `ExcludeInitiatorWhenEmpty` | type | What happens when no approver is left after the initiator is removed: `FAIL` / `INITIATOR_MANAGER` / `SKIP_NODE` |
| `SlaCalendarMode` | type | `'CALENDAR' \| 'BUSINESS_DAY'` |
| `FieldAccessEntry` / `FieldAccessDisplay` / `FieldAccessFill` | interface / type | Per-node field access: `{ fieldKey, display: 'SHOW' \| 'HIDE', fill: 'NONE' \| 'OPTIONAL' \| 'REQUIRED' }`, the shape of `UserTaskNodeData.fieldAccess`. `fill` other than `NONE` is enforced by the server: only the approver of a non-ad-hoc task at that node can fill the field in, when approving (`DecideTaskInput.formDataJson`); `REQUIRED` means it must have a value before that approval. `display: 'HIDE'` only hides the field on screen, it is not a permission boundary |
| `FieldPermission` | interface | **Deprecated.** `{ editable, fieldPath, visible }`, the shape of the deprecated `UserTaskNodeData.fieldPermissions`. Never read by the engine or any screen; a draft that carries the key cannot be published (`legacyFieldPermissions`). Use `FieldAccessEntry` |
| `NotificationOverride` | interface | Node-level notification overrides |
| `NotificationChannel` | type | `'IN_APP' \| 'EMAIL' \| 'WEBHOOK'` |
| `ServiceAction` | type | Action runnable by a serviceTask; `NOTIFY` may carry optional `webhooks` (ADR 18) |
| `NotifyWebhookTarget` / `NotifyWebhookEndpointReference` | interface | One host-registered webhook endpoint (`key` + exact `version`) a NOTIFY node calls, with a stable node-local `id` |
| `NotifyWebhookBinding` / `NotifyWebhookBindingSource` | interface/type | Parameter binding from a form field (`FIELD`), a constant (`CONSTANT`), case context (`CONTEXT`) or — Phase 23 P4／P5 integration, released in v0.20.0 — a cel-v2 expression (`EXPRESSION`, see below). Adding `EXPRESSION` to the union is a type-level breaking change: a host that switches exhaustively on `from.kind` (ending in `never`) no longer typechecks until it handles the new kind |
| `NotifyWebhookContextPath` | type | Case/node values a `CONTEXT` binding may read |
| `NotifyWebhookExpressionBindingSource` | interface | `{ expression, kind: 'EXPRESSION' }`: a NOTIFY webhook parameter computed by a cel-v2 expression over `form` only, evaluated in the engine transaction with its own budget; a failure records the delivery `FAILED` (`WEBHOOK_PARAMETER_INVALID`) without rolling back the approval. Part of the `NotifyWebhookBindingSource` union since the Phase 23 P4／P5 integration (released in v0.20.0): the shared structural lint checks only that `expression` is a non-blank string (`BINDING_EXPRESSION_REQUIRED`) and that no other key is set, the catalog lint leaves its type to the backend publish lint, and `PARAMETER_REQUIRED` / `PARAMETER_UNKNOWN` apply as to any binding |
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
| `WORKFLOW_LINT_MESSAGES` | const | Builders for the structural publish-lint lines (`approverFilledFieldDataSource`, `approverFilledFieldFileUpload`, `approverFilledFieldFormRule`, `approverFilledFieldReadEarly`, `approverFilledMultipleFillNodesOnPath`, `applicantRuleReadsApproverFilled`, `approverFilledTableDataSourceColumn`, `blankNodeLabel`, `cycle`, `endEventMissing`, `exclusiveSplitDefaultEdge`, `exclusiveSplitOutgoingEdges`, `fieldAccessAutoApprove`, `fieldAccessDuplicate`, `fieldAccessFillHidden`, `fieldAccessGroupPolicy`, `fieldAccessInvalid`, `fieldAccessSkipNode`, `fieldAccessUnknownField`, `legacyFieldPermissions`, `noPathToEnd`, `notifyOutgoingEdge`, `parallelJoinIncomingEdges`, `setFormFieldApproverFilled`, `startEventCount`, `unreachableNode`). The backend lint writes these lines with them and `readWorkflowLintMessage` matches them, so the two cannot drift; the English wording of the pre-existing lines is unchanged. |
| `APPROVER_FILLED_FORM_RULES` / `ApproverFilledFormRule` | const / type | The form-level rules an approver-filled field cannot carry (`required`, `requiredWhen`, `visibleWhen`, `readonlyWhen`, `hidden`, `defaultValue`); the `rule` argument of `WORKFLOW_LINT_MESSAGES.approverFilledFieldFormRule` and the list `readWorkflowLintMessage` translates over |
| `APPLICANT_FIELD_CONDITION_RULES` / `ApplicantFieldConditionRule` | const / type | The rules of an applicant's field evaluated against the submitted form (`requiredWhen`, `visibleWhen`, `readonlyWhen`); the `rule` argument of `WORKFLOW_LINT_MESSAGES.applicantRuleReadsApproverFilled` |
| `WORKFLOW_EXPRESSION_LABELS` | const | Builders for where an expression sits, as the publish lint names it (`edgeCondition`, `edgeConditionFieldKey`, `nodeActionPayload`, `nodeActionRecipientsExpression`, `nodeActionValue`, `nodeApproverResolverExpression`, `nodeEntryCondition`, e.g. `workflow.nodes.<id>.data.entryCondition`). The backend lint labels its CEL and early-read lines with them and `readWorkflowLintMessage` rebuilds the same labels, so the two cannot drift; the strings are unchanged from before |
| `WORKFLOW_DECISION_NODE_TYPES` / `hasWorkflowLastDecision(nodeType)` | const / function | Phase 23 P4, released in v0.20.0: the node types whose outgoing edges see a `lastDecision` (`userTask` only); what `EXPR_LAST_DECISION_UNAVAILABLE` is checked against |
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
| `readSelectableReturnTargetNodeIds(definition, nodeId)` | function | The nodes an `allowedTargets: 'ANY'` return from `nodeId` may go to: the start event and every user task before `nodeId` — with a path to it, and reached from the start event without passing through it — in definition order, never `nodeId` itself. A later stage that loops back to `nodeId` is left out; the stages on every branch before a join are listed. Used by the engine and the return dialog |
| `readWorkflowDefinitionIssue` / `readApproverResolverIssue` / `hasConfiguredConditionEdges` / `readServiceTaskMemberIds` | function | Validation. `readApproverResolverIssue` also reports a resolver type this build does not know, an empty `formPath` / `nodeIds`, a `levelsUp` below 1 on `FORM_MEMBER_MANAGER` / `NODE_ACTOR_MANAGER`, and a blank `DIRECT` / `POSITION` fallback on any fallback-capable resolver |
| `isOrgManagerChainDecisionPolicyInvalid` | function | `true` when an `ORG_MANAGER_CHAIN` approver is paired with a decision policy other than `SEQUENTIAL` / `PARALLEL_ALL` (or none); shared by `readWorkflowDefinitionIssue`, `lintWorkflowDefinition`, the designer and the `setUserTaskApprover` command, which swaps such a policy for `SEQUENTIAL` (the chain then signs nearest manager first) |
| `readOrgManagerChainIssue(resolver, subject)` | function | The Chinese issue line for the optional `startFrom` / `startPositionLevel` of an `ORG_MANAGER_CHAIN` (`null` when sound): an unknown or incomplete start, a start level that is not a whole number or is above `minPositionLevel`, and, for a notify node (`subject: '知會節點'`), any start other than the initiator. Called by `readApproverResolverIssue` and `readNotifyRecipientsIssue`, and by the publish lint, so the designer and the backend agree |
| `NOTIFY_WEBHOOK_TARGET_LIMIT` / `NOTIFY_WEBHOOK_CONTEXT_PATHS` / `NOTIFY_WEBHOOK_ENDPOINT_VERSION_MAX` | const | Per-node webhook cap (10), the allowed `CONTEXT` binding paths, and the endpoint version ceiling (int32) |
| `NotifyWebhookTargetIdFactory` / `NotifyWebhookStructureIssue` / `NotifyWebhookStructureIssueCode` | type/interface | Injectable target-id generator; registry-independent webhook shape issue as a code (formatted separately by the designer and the backend lint), located by `targetIndex` / `bindingIndex` / `parameter`, plus `property` for `UNKNOWN_PROPERTY` (a key outside the contract, relative to the target or binding). Phase 23 P4／P5 integration, released in v0.20.0: `BINDING_EXPRESSION_REQUIRED` (an `EXPRESSION` source without a non-blank `expression`) |
| `defaultNotifyWebhookTargetId` / `createNotifyWebhookTarget` / `readNotifyWebhookTargets` | function | NOTIFY webhook target factory and reader |
| `isNotifyRecipientsEmpty` / `readNotifyRecipientsIssue` | function | Empty `DIRECT` recipients (allowed only with webhooks) vs a misconfigured recipient resolver. `readNotifyRecipientsIssue` also refuses the four form / prior-node sources (`isNotifyRecipientResolverType`) even when complete, and an `ORG_UNIT_MANAGER` with no organization; the backend publish lint refuses the same |
| `readNodeActorSourceSkipReasons(node)` / `NodeActorSourceSkipReason` | function/type | Why a user task may finish with nobody having approved it, which rules it out as a `NODE_ACTOR` / `NODE_ACTOR_MANAGER` source and as an `excludeNodeActors` stage: `'entryCondition'` (a non-blank `entryCondition`), `'skipNode'` (`excludeInitiator.whenEmpty: 'SKIP_NODE'`), `'skipNodeByNodeActors'` (`excludeNodeActors.whenEmpty: 'SKIP_NODE'`), `'autoApprove'` (`sla.onTimeout: 'AUTO_APPROVE'`; the engine does not count an SLA approval as a signature). `[]` = always has a real signer. The designer's 關卡 picker and `readNodeActorSourceIssues` both read it |
| `canUserTaskHaveMultipleApprovers(node)` / `readSingleApproverSourceIssues(definition, sourceNodeIds)` | function | Whether more than one person can end up approving a user task, from its definition alone: `PARALLEL_ALL` and `SEQUENTIAL` yes, `SINGLE` and `PARALLEL_ANY` no, `QUORUM` yes for a `COUNT` threshold above 1 or any `PERCENTAGE`; a `DIRECT` resolver with one member never, unless the stage's `excludeInitiator` or `excludeNodeActors` has `whenEmpty: 'INITIATOR_MANAGER'` (the one member may be the initiator, or may have approved a listed earlier stage, and the stage then goes to the initiator's managers, who can be several people), in which case the policy decides. `readSingleApproverSourceIssues` turns it into Chinese issue lines for the stages a manager chain's `NODE_ACTOR` start names (`[]` = every stage has one signer); the publish lint calls it, and the designer's stage picker for that start should filter with the same predicate. Not part of `readNodeActorSourceIssues`, so `NODE_ACTOR` and `NODE_ACTOR_MANAGER` are unaffected |
| `readNodeActorSourceIssues(definition, nodeId, sourceNodeIds)` | function | Graph checks behind a `NODE_ACTOR` / `NODE_ACTOR_MANAGER` node, as Chinese issue lines (`[]` = sound): the list is non-empty, free of repeats and of the node itself; every id is an existing `userTask`; no source can finish without a real signer (`readNodeActorSourceSkipReasons` is non-empty: an `entryCondition`, `excludeInitiator.whenEmpty: 'SKIP_NODE'` or `sla.onTimeout: 'AUTO_APPROVE'`); every path from the start reaches `nodeId` through a source (walking the graph as if every gateway were exclusive); no two sources sit on different branches of one `parallelGateway`; every source is upstream of `nodeId` (a path leads from it to the node) |
| `readNotifyServiceTaskIssue` | function | zh-TW issue for one NOTIFY node (recipients + webhooks); used by `readWorkflowDefinitionIssue` and the template designer's pre-save check |
| `EXCLUDE_INITIATOR_WHEN_EMPTY_VALUES` | const | The accepted `ExcludeInitiatorWhenEmpty` values |
| `readExcludeNodeActorsShapeIssue(config)` | function | zh-TW shape issue of a node's `excludeNodeActors` (no stage, blank or repeated ids, unknown `whenEmpty`), or `null`; needs no graph, used by `readWorkflowDefinitionIssue` and the designer's pre-save check |
| `readExcludeNodeActorsIssues(definition, nodeId, config)` | function | Graph checks behind `excludeNodeActors`, as Chinese issue lines (`[]` = sound): the shape issue first, then the node is not listed itself, every id exists and is a `userTask`, then each listed node on its own passes the `NODE_ACTOR` source rules (not skippable / not without a signer per `readNodeActorSourceSkipReasons`, every path from the start to `nodeId` goes through it, upstream of `nodeId`; the wording talks about the exclusion), and `SKIP_NODE` is not used on a node whose approver fills fields in. The rule "two sources on different branches of one parallel split" is not applied a second time. A stage on a parallel branch is still refused by the every-path coverage rule, like a `NODE_ACTOR` source (coverage reads a parallel gateway like an exclusive one); chain such stages one after another instead. The publish lint prefixes each line with `workflow.nodes.<id>.excludeNodeActors:` |
| `readExcludeInitiatorIssue` | function | zh-TW issue when a userTask's `excludeInitiator` is set without a valid `whenEmpty`; used by `readWorkflowDefinitionIssue` and the template designer's pre-save check |
| `readNotifyWebhookStructureIssues` / `isNotifyWebhookContextPath` | function | Structural webhook checks shared by the designer and `lintWorkflowDefinition`, including rejection of unknown keys (no URL/header/secret may be stored) |
| `isFormFieldCompatibleWithWebhookParameter` / `isNotifyWebhookValueCompatibleWithParameter` | function | Whether a form field or a concrete value can feed a webhook parameter type |
| `NotifyWebhookEndpointContract` (optional `deprecated` / `disabled`) / `NotifyWebhookCatalogIssue` / `NotifyWebhookCatalogIssueCode` | type/interface | The descriptor subset the catalog lint reads, and a catalog/form publish problem as a code (`ENDPOINT_MISSING`, `ENDPOINT_DEPRECATED`, `ENDPOINT_DISABLED`, `PARAMETER_REQUIRED`, `PARAMETER_UNKNOWN`, `FIELD_MISSING`, `FIELD_INCOMPATIBLE`, `CONSTANT_REQUIRED_NULL`, `CONSTANT_INCOMPATIBLE`, `CONTEXT_INCOMPATIBLE`) |
| `readNotifyWebhookTargetCatalogIssues` / `readNotifyWebhookCatalogIssueMessage` | function | Checks one well-formed target against its endpoint and the form — the rules behind the backend publish lint and the template designer's publish check — and the designer's zh-TW wording of an issue |
| `readConditionField` / `readConditionOperator` / `readConditionOperatorIds` / `readConditionValueOptions` / `readNextConditionOperator` / `readNextConditionValue` / `shouldConditionOperatorUseValue` / `readConditionLabel` / `readConditionOperatorLabel` / `readConditionValueLabel` / `readFormFieldOption` / `readConditionExpression` / `readFormFieldReference` / `readConditionExpressionOperator` / `readConditionExpressionValue` | function | Condition compilation (UI state → CEL). A `member` or `org_unit` field is offered, and compiled for, "filled" / "empty" only |
| `readConditionOperatorOptionsForField` / `isMultipleSelectionConditionField` | function | Operators offered for a field, named for its value shape (a multiple-selection field — checkbox, or select / autocomplete in `multiple` mode — names `EQUALS` / `NOT_EQUALS` 包含 / 不包含 and compiles them to list membership); `readConditionOperatorLabel(operator, field?)` takes the field for the same naming |

## `@rytass/bpm-core-shared/workflow-command`

The serialisable command layer + pure reducer that both the designer UI and the LLM assistant drive the workflow through (single dispatch path).

| Name | Kind | Purpose |
|---|---|---|
| `WorkflowDesignerState` | interface | Single source of truth (definition + formSchema + selection + policy) |
| `WorkflowNodeAnchor` | interface | Where a new node wires in (`edgeId` / `afterNodeId`) |
| `WorkflowCommand` | type | Fine-grained primitive command union (add/rename/delete/connect/setEdgeCondition/setUserTaskReturnRequireComment/setUserTaskRequireApprovalComment (`false` drops the key)/setUserTaskReturnAllowedTargets/setUserTaskSla/setUserTaskDecisionPolicy/setUserTaskExcludeInitiator/setUserTaskExcludeNodeActors/setFieldAccessMatrix/removeLegacyFieldPermissions/…). `setFieldAccessMatrix { entries, nodeIds? }` writes every user task at once — a user task with no entry listed loses its `fieldAccess` key — or, with `nodeIds`, only those user tasks, leaving the rest as they are; it rejects an entry on a node that is not a user task or outside `nodeIds`, a `nodeIds` entry that is not a user task, a malformed entry, or one field listed twice for a node. `removeLegacyFieldPermissions { nodeId }` drops the deprecated `fieldPermissions` key without converting it |
| `FieldAccessMatrixEntry` | interface | `FieldAccessEntry` plus its `nodeId`, the shape of `setFieldAccessMatrix` entries |
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
| `WORKFLOW_TOOLSET` | const | The full tool catalog (mutations, macros, queries), incl. `set_user_task_return_require_comment`, `set_user_task_require_approval_comment`, `set_user_task_sla`, `set_user_task_exclude_initiator`, `set_user_task_exclude_node_actors`, `set_user_task_decision_policy`, `set_field_access_matrix` (requires `nodeIds` and rewrites only those nodes, so a partial edit cannot clear the others; the user-task snapshot summary lists the node's 欄位設定 so the assistant can keep them) and `remove_legacy_field_permissions`. One mutation tool per designer-reachable command — the assistant's contract is parity with the property form |
| `WORKFLOW_TOOL_BY_NAME` | const | `ReadonlyMap<string, WorkflowTool>` lookup |
| `WorkflowNodeSnapshot` / `WorkflowEdgeSnapshot` / `WorkflowSnapshot` | interface | LLM-readable view of state |
| `readWorkflowSnapshot` | function | State → snapshot |
| `WorkflowToolResult` | type | Discriminated `{ ok, kind, … }` result |
| `ExecuteWorkflowToolOptions` | interface | Execution options (`createEdgeId?`, `resolveFormSchema?`, `directory?`, and — Phase 23 P4, released in v0.20.0 — `expressions?: WorkflowExpressionTools`) |
| `WorkflowExpressionTools` / `WorkflowExpressionRequest` / `WorkflowExpressionFinding` | interface | Phase 23 P4, released in v0.20.0: the host-injected backend lint / trial run / catalog behind the `get_expression_catalog` and `preview_expression` query tools. Every tool call that writes a free-text expression (`set_initiator_policy_cel`, an `EXPRESSION` approver or `NOTIFY` recipient list, a `SET_FORM_FIELD` value, a `WEBHOOK` payload, through primitives or macros) is linted through `lint` in the draft's dialect first and refused on an `ERROR` finding, on a lint that throws, and when no tools are injected; `set_edge_condition` builds its CEL and is not linted |
| `executeWorkflowTool` | function | Run one tool call (parse input → command → reducer); expression writes are linted first (see `WorkflowExpressionTools`) |

---

# 📦 `@rytass/bpm-core-client`

Cross-platform typed GraphQL/REST client. All functions ultimately use `fetch`.

## `@rytass/bpm-core-client` (root)

### Transport / Endpoint

| Name | Kind | Purpose |
|---|---|---|
| `requestGraphQl<T>(query, variables?, options?)` | async function | Generic GraphQL POST, returns typed data |
| `GraphQlRequestOptions` | interface | Per-request transport options; currently `signal?: AbortSignal` |
| `BPMGraphQLRequestError` | class | The `Error` `requestGraphQl` throws when the host answers with GraphQL errors. `message` joins the host messages with `; ` as before. `formDataIssues` (`readonly FormDataIssue[]`, `[]` when none) lists the refused form values, read from `extensions.originalError.formDataErrors` of each error. Released in v0.21.0 |
| `readFormDataIssues(error)` | function | The `formDataIssues` of an error from `requestGraphQl`, or `[]`. Duck-typed, so it also reads an error from another copy of this package. All or nothing: when any entry has a reason this client does not know, it answers `[]`, so the caller falls back to the message rather than placing only some errors. Released in v0.21.0 |
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
| Records | `OrgUnitRecord`, `OrgUnitOptionRecord`, `OrgUnitRetirementImpactRecord`, `PositionRecord`, `MembershipRecord`, `ManagerResolutionRecord`, `OrganizationSummaryRecord`, `OrganizationDirectoryRecord`, `ResolvedManagerRecord` |
| Queries | `readOrganizationDashboard()` (admin pages), `readOrganizationDirectory()` (every unit, position and membership; the designer's read, open to designers), `listMemberships()`, `listManagerResolutions()`, `readResolvedManager()`, `readOrgUnitRetirementImpact(id)` |
| Picker queries (any signed-in member) | `searchOrgUnitOptions(searchText)` (live units; the server returns 20 by default and at most 50), `resolveOrgUnitOptions(ids)` (retired units included with `deleted: true`; duplicate ids are dropped and a long list is sent in requests of at most 100 ids, the server's limit; result order is not guaranteed, match by `id`; no request for an empty list) — both return `OrgUnitOptionRecord[]` |
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
| `readMissingFormDataSourceDependencies()` | function | Find FIELD (and, with row values, ROW_FIELD) bindings that are not yet present — advisory only; runtime callers must take `waitingForFieldKeys` from the server result. `EXPRESSION` and unknown kinds report nothing: only the backend knows what an expression reads |
| `readFormDataSourceValueSignature()` | function | Stable value signature for change detection |

### Form DataSource error helpers

| Name | Kind | Purpose |
|---|---|---|
| `FORM_DATA_SOURCE_ERROR_CODES` | const | Stable DataSource error codes returned by the GraphQL surface |
| `FormDataSourceErrorCode` | type | Union of the stable DataSource error codes |
| `readFormDataSourceErrorCode()` | function | Extract the DataSource code from a rejected request, else `null` |
| `readFormDataSourceErrorMessage(error, language?)` | function | Map a rejected request to display copy in `language` (`'zh-TW'` default, or `'en'`; a `WorkflowLintLanguage`), else `null` |
| `readFormSchemaLintMessage(error, language?)` | function | Replace the code inside a publish-lint line with copy in `language` (`'zh-TW'` default, or `'en'`), keeping the field path |

### Form DataSource builder helpers

| Name | Kind | Purpose |
|---|---|---|
| `FormDataSourceBindingFieldOption` | interface | Type-compatible form-field choice for a parameter binding |
| `FormDataSourceBindingValueKind` | type | `'CONSTANT' \| 'EXPRESSION' \| 'FIELD' \| 'ROW_FIELD'` binding discriminator |
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
| `readFormDataSourceBindingValueKind()` | function | Read the binding source discriminator (`CONSTANT` / `EXPRESSION` / `FIELD` / `ROW_FIELD`); `null` for no binding or a kind this version does not know |
| `readFormDataSourceBindingExpression()` | function | The expression text of an `EXPRESSION` binding, as written (never parsed or evaluated in the browser) |
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
| `validateFormRendererValues()` | function | Whole-form validation, recursing into table rows; cell errors keyed by instance path. Synchronous; optional `testPattern` runs each format pattern (default `RegExp#test`, no time limit) |
| `validateFormRendererValuesInWorker()` | async function | The same validation with the format patterns run in a Web Worker under `TEXT_FIELD_PATTERN_TIME_BUDGET_MS` of matching time; a pattern not answered in time is reported as `…的格式檢查逾時…`. Falls back to `validateFormRendererValues` when no worker can start (no `Worker`, CSP without `worker-src blob:`) or the worker fails. Options: `createWorker`, `deadlineMs` |
| `createFormPatternWorker()` | function | The default worker (`blob:` URL), or `null` where `Worker` is unavailable |
| `FormPatternWorker` / `FormPatternCheckRequest` / `FormPatternCheckResponse` | type | The worker contract, for a host or test that supplies its own `createWorker` |
| `FormRendererPatternTimeoutError` | class | Thrown by a `testPattern` that could not answer in time; the value is reported as not checked |
| `FORM_PATTERN_WORKER_START_ALLOWANCE_MS` | const | 1000: how long past the budget the main thread waits before terminating the worker |
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
| Expression tools (Phase 23 P4, released in v0.20.0; all designer-only, 403 otherwise) | `previewExpression(input, options?)` (`LINT` or `EVALUATE`; the sample is sent only for `EVALUATE`), `readExpressionCatalog({ usagePoint, formDefinitionVersionId? }, options?)`, `analyzeWorkflowExpressions(draft, options?)`, `previewWorkflowDialectUpgrade(draft, options?)` (the cel-legacy → cel-v2 differences of a draft, `complete: false` when the check ran out of time), `readExpressionFieldReferences(analysis)` (field key → labels of the expressions reading it); records `ExpressionIssueRecord`, `ExpressionEvaluationRecord`, `ExpressionPreviewRecord`, `ExpressionPreviewMode`, `PreviewExpressionInput`, `ExpressionCatalogRecord`, `ExpressionCatalogFieldRecord`, `ExpressionCatalogFunctionRecord`, `WorkflowExpressionAnalysisRecord`, `WorkflowExpressionsRecord`, `WorkflowDialectDifferenceRecord`, `WorkflowDialectUpgradePreviewRecord`, `WorkflowExpressionsDraft`. Copy: `readExpressionIssueMessage(issue, definition?, language?)` (one finding as a designer sentence, prefixed with where it sits when `definition` holds the label) and `readExpressionLabelLocation(label, definition, language?)`; `readWorkflowLintMessage` also translates `EXPR_LAST_DECISION_UNAVAILABLE` |
| Publish lint copy | `readWorkflowLintMessage(message, definition, language?)` — rewrites the structural publish-lint lines (blank node label, exclusive-split edge count and default edge, parallel-join incoming edges, reachability, path to end, cycles, start/end count, NOTIFY outgoing edges, field permission and approver-filled-field lines, plus — released in v0.20.0 — the Phase 23 P2 expression lint lines `<label>: EXPR_*[ <subject>]`, including those of NOTIFY webhook `EXPRESSION` bindings (`workflow.nodes.<nodeId>.action.webhooks[<t>].bindings[<b>].from.expression`, named by node label, webhook position and parameter), and the unknown `expressionDialect` line) into `language` (`'zh-TW'` by default, or `'en'`), naming the node by its label from `definition` instead of its id or array index; unknown lines, ids outside `definition`, and nodes or edges it cannot read pass through unchanged, and an unsupported `language` falls back to `'zh-TW'`. `WorkflowLintLanguage` (`'en' \| 'zh-TW'`), `WORKFLOW_LINT_LANGUAGES`, `DEFAULT_WORKFLOW_LINT_LANGUAGE`. |
| Form binding expression lint copy (Phase 23 P4／P5 integration, released in v0.20.0) | `parseFormBindingExpressionLintLine(line)` → `FormBindingExpressionLintLine` (`{ fieldIndex, columnIndex, bindingIndex, code, subject }`, `columnIndex` `null` for a top-level field) or `null` — reads a form publish-lint line `schema.fields[<f>](.columns[<c>])?.dataSource.bindings[<b>].from.expression: EXPR_*[ <subject>]`; `readFormBindingExpressionLintMessage({ code, columnLabel, fieldLabel, parameterLabel, subject? }, language?)` — the same line as one designer sentence naming field, column and parameter by label. Every `EXPR_*` code has its own zh-TW / en sentence and none contains `'; '`. The form builder uses these instead of copy of its own |
| Webhook catalog | `listWorkflowWebhookEndpoints({ includeDeprecated? })` (designer-only; no URL, header or secret), `WorkflowWebhookEndpointRecord` (P6 adds `disabled`), `WorkflowWebhookParameterRecord`, `WorkflowWebhookEndpointSource` |
| Webhook endpoint administration (P6) | `readWorkflowWebhookEndpointManagement()`, `listWorkflowWebhookManagedEndpoints()`, `listWorkflowWebhookEndpointAudits(endpointId)`, `createWorkflowWebhookEndpoint(input)`, `updateWorkflowWebhookEndpoint(input)`, `setWorkflowWebhookEndpointActive(id, active)`, `rotateWorkflowWebhookEndpointSecret(id, signingSecret)`, `testWorkflowWebhookEndpoint(id)`; records `WorkflowWebhookEndpointManagementRecord`, `WorkflowWebhookManagedEndpointRecord` (header names and `hasSigningSecret` only), `WorkflowWebhookEndpointAuditRecord`, `WorkflowWebhookEndpointAuditAction`, `WorkflowWebhookEndpointTestResultRecord`; inputs `CreateWorkflowWebhookEndpointInput`, `UpdateWorkflowWebhookEndpointInput`, `WorkflowWebhookEndpointHeaderInput`, `WorkflowWebhookEndpointParameterInput` (administrator-only) |

## `@rytass/bpm-core-client/workflow`

### Types / Records

| Group | Names |
|---|---|
| Instance | `ApprovalInstanceState`, `ApprovalInstanceRecord` (incl. `formDataOptionSnapshot` / `formDataOptionSnapshotJson`, the optional `formDataFingerprint` — selected only by `readApprovalInstance` — and the optional `submittedByMemberId` — the member who filed it when that is not the initiator; `null`, absent or equal to `initiatorMemberId` means the initiator did), `ApprovalInstanceView`, `ApprovalInstancesPageInput / Result`, `ApprovalInstancePageInfoRecord`, `LaunchContext` (`templateVersion` also carries the current version's parsed `workflowDefinition`, so the launch page can tell which fields approvers fill in), `LaunchableTemplateRecord` |
| Field filter (ADR 25) | `ApprovalInstanceFieldFilter`, `ApprovalInstanceFieldFilterOperator`, `ApprovalInstanceSort`, `ApprovalInstanceSortDirection` (type re-exports of `@rytass/bpm-core-shared`), `FilterableFieldIssueKind` (`'INVALID_VALUES' \| 'TYPE_CHANGED'`), `FilterableFieldIssueResult` |
| Task | `TaskStatus`, `TaskAssignmentType`, `TaskDecisionAction`, `TaskRecord` (incl. `isAdhoc` / `adhocType` / `adhocOriginTaskId` / `adhocDirectiveId` / `candidateMemberIds` / `openCandidateMemberIds` / `nodeLabel` / `hasFillableFields` — a non-ad-hoc task whose node lets its approver fill in fields; read a missing value as `false`), `TaskCandidateRecord` (incl. `sequence`), `TaskDecisionRecord`, `WorkflowTokenRecord`, `MemberOpenTaskRecord`, `InactiveMemberWithOpenTasksRecord` (`memberId`, `name`, `email`, `openTaskCount`; the rows of `listInactiveMembersWithOpenTasks`), `MemberTaskRole`, `TaskReassignmentOutcome`, `TaskReassignmentErrorCode`, `TaskReassignmentResultRecord` |
| Ad-hoc | `AdhocDirectiveType`, `AdhocDirectiveStatus`, `AdhocTargetKind`, `AdhocPreApprovalRejectBehavior`, `AdhocTargetOptions`, `AdhocDirectiveRecord` |
| Webhook delivery | `WorkflowWebhookDeliveryStatus`, `WorkflowWebhookDeliveryRecord` (no URL, header or payload; `endpointLabel` is `null` once the endpoint is unregistered) |
| Form snapshot | `FormDefinitionSnapshot`, `WorkflowFormData` |
| Activity | `ActivityLogRecord` |
| Member | `MemberProfileRecord`, `MemberDirectoryPage`, `MemberTaskPage` (`tasks`, `totalCount`; one page of `listInboxTasksPage` / `listApprovalHistoryTasksPage`), `MemberTaskTemplateFilter` (`templateIds?`, `templateKey?`; the template filter both take) |
| Delegation | `DelegationScopeType`, `DelegationRuleStatus`, `DelegationRuleRecord` (Phase 23 P4, released in v0.20.0: `scopeConditionDialect`, selected by every delegation query; `createDelegationRule` takes an optional `scopeConditionDialect`) |
| Notification | `NotificationChannel`, `NotificationDigestMode`, `NotificationStatus`, `NotificationType`, `NotificationResolution`, `NotificationRecord` (incl. `silenced` — recorded but not announced), `NotificationPreferenceRecord` |
| Attachment / Signature | `AttachmentRecord`, `SignatureRecord`, `SignatureVerificationRecord` |
| Template embed | `ApprovalTemplateRecord`, `ApprovalTemplateVersionRecord` |
| Dashboard | `WorkflowDashboardSummaryRecord` |

### Queries

| Name | Purpose |
|---|---|
| `listApprovalInstances()` | All instances (unpaginated) |
| `listApprovalInstancesPage({ view, state, searchText, page, pageSize, templateId, fieldFilters, sort })` | Paginated list (shared by inbox / sent / cc / search). `templateId` is sent as given (`null` for none). `fieldFilters` and `sort` (ADR 25) are sent as GraphQL variables only when they are non-empty, so an older server is unaffected by calls that do not use them. Field conditions and form-field sort keys need `templateId`; the server refuses them without one. Without `sort`, the server orders by `created_at DESC`, tie-broken by `id` |
| `listFilterableFieldIssues({ templateId?, formDefinitionId?, schemaJson })` | Designer check (ADR 25): wraps the `filterableFieldIssues` query and returns `FilterableFieldIssueResult[]` (`kind`, `path`, `label`, `fieldType`, `templateId`, `templateName`, `message` (the server's Chinese sentence), `conflictVersionNumbers`, `invalidInstanceCount`, `sampleInstanceIds`). Read-only: it blocks nothing |
| `readApprovalTemplateCurrentFormSchema(templateId)` | Parsed form schema of the template's current version, or `null`; the list page reads it to build one control per filterable field (ADR 25) |
| `readApprovalInstance(id)` | One full instance with all relations |
| `readLaunchContext(templateId)` | Launch-page bootstrapping data. The second request also reads the current template version's `workflowDefinitionJson` (`approvalTemplateVersion(id:)`, only that one version) into `templateVersion.workflowDefinition` |
| `listLaunchableTemplates()` | Templates the current member may launch |
| `listInboxTasks(memberId)` | My pending tasks, all of them |
| `listInboxTasksPage({ assigneeMemberId, page, pageSize, templateIds?, templateKey? })` | One page of my pending tasks, newest first, as `MemberTaskPage` (`tasks`, `totalCount`); wraps `inboxTasks` and `inboxTaskCount` in one request. `templateIds` / `templateKey` (`MemberTaskTemplateFilter`, ADR 27 §7) keep tasks of those templates only, in the list and the count alike; both given means both must match |
| `listMemberOpenTasks(memberId)` | Administrator: the open tasks a member holds on running instances (assignee, or a PENDING / CLAIMED / WAITING candidate seat), with `memberRole` and `candidateStatus` |
| `listInactiveMembersWithOpenTasks()` | Administrator: members the host reports as deactivated who still hold open tasks, with `openTaskCount` (the rows `listMemberOpenTasks` returns for them), as `InactiveMemberWithOpenTasksRecord` (`memberId`, `name`, `email`, `openTaskCount`), sorted by name in `zh-Hant-TW` order, namesakes by `memberId`. Empty when the host member resolver does not implement `resolveInactive`, or when the engine is wired without the identity module |
| `listApprovalHistoryTasks(memberId)` | My historical decisions, the latest 50 |
| `listApprovalHistoryTasksPage({ assigneeMemberId, instanceState?, page, pageSize, templateIds?, templateKey? })` | One page of the tasks I acted on, most recently acted on first, as `MemberTaskPage`; `instanceState: 'RUNNING'` keeps cases still under way. Wraps `approvalHistoryTasks` and `approvalHistoryTaskCount` in one request |
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
| `decideTask({ ... })` | Decide a task (`action`: APPROVED / REJECTED / RETURNED / TRANSFERRED). On an APPROVED decision the approver of a non-ad-hoc task can send `formDataJson` (a JSON object of top-level `fieldKey` to value, merged into the form data) for the fields the node lets its approver fill in (`fieldAccess` `fill` other than `NONE`), with `expectedFormDataFingerprint` — the `formDataFingerprint` read with the instance. The GraphQL mutation requires the fingerprint whenever `formDataJson` is sent (`'{}'` counts as sent); the service command may leave it out, and then skips the staleness check. The merge is saved before the decision is signed, so the signature, any gateway after the node and an end node all see the filled values. `TASK_DECIDED` then carries `changedFieldKeys` (sorted keys whose value changed, never the values; absent when none changed). Neither field has a length cap, like `submitApprovalInstance` and `resubmitApprovalInstance`. The client `decideTask` takes this as the optional `fill: { formData, expectedFormDataFingerprint } \| null` (the two travel together, so one cannot be given without the other); it adds `formDataJson` (the `formData` serialised) and `expectedFormDataFingerprint` to the input only when `fill.formData` has at least one key, so an ordinary decision, `fill: null` or an empty `formData` sends neither, and an older server that does not know the fields is unaffected |
| `cancelApprovalInstance({ ... })` | Cancel an instance |
| `resubmitApprovalInstance({ ... })` | Re-submit after return. The optional `comment` is the applicant's note on what changed: trimmed, and left out of the input when blank so an older server that does not know the field is unaffected. A non-blank comment needs a server that has the field, so deploy the server first. The server caps it at 2000 UTF-16 code units, the JS string length, counted on the raw input before the service trims it (`@MaxLength` on `ResubmitApprovalInstanceInput.comment`, enforced by the host's `ValidationPipe` like every other DTO limit; the instance page's box sets the same `maxLength`) and stores it, trimmed (blank becomes `null`), as `comment` in the `INSTANCE_RESUBMITTED` activity-log payload |
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

Task notification payloads (`TASK_ASSIGNED`, `TASK_TRANSFERRED`) carry `hasFillableFields: boolean` next to `allowReject`: `!task.isAdhoc` and the node has at least one `fieldAccess` entry whose `fill` is not `NONE`, computed once where the payload is built, so every path that creates one reports it: first assignment, sequential activation, transfer, administrator reassignment, the task an ad-hoc directive opens (always `false`: it is ad-hoc) and the origin task reopened after an ad-hoc pre-approval is rejected (a normal task, so it follows its node like the others). The key is absent on notifications created before this release; treat absent as `false`. Hosts reading `payloadJson` should treat `true` as "the recipient must open the case to fill in fields" and not offer a one-tap approve.

The same payloads carry `requireApprovalComment: true` when the node has `UserTaskNodeData.requireApprovalComment` on, and the key is **absent** otherwise (never written as `false`, so the payload of every other node is unchanged). Unlike `hasFillableFields` it also follows an ad-hoc task, because that task runs on the main node and its approval needs the comment too. Hosts reading `payloadJson` should treat `true` as "the recipient must open the case to write the approval comment" and not offer a one-tap approve; the built-in `NotificationDrawer` does that: 同意 becomes 開啟案件. A notification created before this release has no such key, so the drawer still offers 同意 for it and the engine's refusal (「此節點要求同意時填寫意見，請輸入意見後再同意。」) is the only guard, shown inside the approve dialog.

`listNotifications({ ... })` (accepts `includeArchived`, `beforeId` keyset paging and `changedSince`; records carry `NotificationRecord.updatedAt`), `readUnreadNotificationCount(memberId)`, `readNotificationSummary()` (`NotificationSummaryRecord` — `{ unreadCount, latestUpdatedAt }`), `markNotificationRead({ ... })`, `markNotificationsRead({ ids })` (resolves to the ids that changed), `markAllNotificationsRead({ ... })`, `archiveNotifications({ ids })`, `unarchiveNotifications({ ids })`, `readNotificationPreference(memberId)`, `updateNotificationPreference({ ... })`.

### Pure helpers

| Name | Purpose |
|---|---|
| `readApprovalInstanceCaseTitle(instance)` | Display title from an instance; names data-source values from its option snapshot |
| `readFormDataCaseTitle({ ... })` | Display title from form data before submission; skips table, member (人員選擇) and org unit (組織選擇) fields and labels a table value as `N 列`. Optional `optionSnapshots` (an instance's `formDataOptionSnapshot`) names a data-source value; without it the stored value is shown |

---

# 📦 `@rytass/bpm-core-nestjs-module`

NestJS module, entities, services, migrations. Embedded via `BPMRootModule`.

## Module entry

| Name | Kind | Purpose |
|---|---|---|
| `BPMRootModule` | NestJS Module | Embed everything in one import |
| `BPMRootModuleOptions` / `BPMRootModuleAsyncOptions` | interface | Host wiring. **Every field is optional** — `forRoot()` and `forRootAsync()` boot with no arguments. Wiring-time only (never from `useFactory`, because Nest reads them while building routes, the schema, and handler metadata): `memberResolverProvider`, `attachmentStorageProvider`, `businessCalendarProvider`, `expressionFunctionsProvider`, `formDataSourceRegistryProvider`, `initiatorCustomFieldsResolverProvider`, `workflowServiceTaskDispatcherProvider`, `workflowWebhookRegistryProvider`, `resolverMetadataFactory`, `attachmentRoutePrefix`, `identityRegisterResolvers`, `imports`, `inject`. Everything else lives on `BPMRootRuntimeOptions` and can come from `useFactory`. |
| `BPMRootRuntimeOptions` | interface | Everything settable at runtime: the flattened notification/attachment/signature/identity options, `authContextFactory`, the flattened workflow-webhook options (`workflowWebhookTargetSources`, `workflowWebhookAllowedUrlPatterns`, `workflowWebhookEnforceAllowlistForRegistry`, `workflowWebhookSecretEncryptionKey`, and the `workflowWebhookDelivery*` scheduler/retry/timeout settings), `organizationTimeZone` (IANA zone in which organization effective dates are read; default `Asia/Taipei`, see the organization section), `expressionFunctions` (host expression functions, combined with `expressionFunctionsProvider`; see the expression functions section), `expressionMissingFormFieldsAsNull` (ADR 27 §3, default `false`: expressions read an unfilled top-level form field as `null`, a table as `[]`; changes `has(form.x)` to `true` for such a field, see docs/05 §5.1.2), and ready instances `memberResolver`, `attachmentStorage`, `businessCalendar`, `formDataSourceRegistry`, `initiatorCustomFieldsResolver`, `workflowServiceTaskDispatcher`, `workflowWebhookRegistry`. This is exactly what a `forRootAsync` `useFactory` returns, and it is embedded in `BPMRootModuleOptions` too, so a setting moves between `forRoot` and `forRootAsync` without reshaping. Prefer an instance over its `*Provider` twin whenever the value needs a secret. |
| `BPMRootModuleAsyncFactoryOptions` | type (deprecated) | Alias of `BPMRootRuntimeOptions` |
| `BPM_ROOT_OPTIONS` | injection token | The resolved `BPMRootRuntimeOptions`. BPM resolves the host `useFactory` **once** and publishes it here; every BPM sub-module reads this one token. Previously each sub-module called the host factory itself (five times per boot), so an instance-constructing factory handed a different instance to each consumer. |
| `BPMRootOptionsModule` / `BPMRootOptionsModuleAsyncOptions` | Module / interface | Global module publishing `BPM_ROOT_OPTIONS`; wired for you by `BPMRootModule` |
| `buildTypeOrmModuleOptions(config)` | function | Build TypeORM options including migrations |
| `BPM_CORE_MIGRATIONS` | const | 33-class migration array |
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
| `BPMMemberResolver`, `MemberResolver` (deprecated alias) | interface | Resolver contract — `resolve`/`resolveMany`/`search?`/`searchPaged?`/`resolveInactive?` (of the given ids, the members the host has deactivated; BPM passes every member holding an open seat on a running instance, active ones included, and never caches the answer; without it `inactiveMembersWithOpenTasks` is always empty) |
| `BPMMemberSearchPage`, `BPMMemberSearchPageOptions` | interface | Paged-search result (`items` + `total`) and 1-based page request for `searchPaged?` |
| `BPMRootIdentityOptions` | interface | Host-facing identity options: `identityMemberMetadataCacheTtlMs`, and `identityRegisterResolvers` (default `true`; set `false` when the host already publishes `member` / `members` / `memberCount` / `searchMembers`, keeping `IdentityService` without the colliding GraphQL fields) |
| `BPMResolvedIdentityOptions`, `DEFAULT_BPM_IDENTITY_OPTIONS`, `BPM_IDENTITY_OPTIONS` | interface / const / injection token | Resolved identity options, their defaults, and the token that carries them |
| `resolveBPMIdentityOptions()` | function | Apply defaults to a `BPMRootIdentityOptions` |
| `MemberNotFoundException` | exception | Raised when a member id cannot be resolved |
| `BPMMemberBaseDirectory`, `BPMMemberBaseSearchPage` | interface | Host directory contract (incl. optional `searchMembersPaged` and `resolveInactiveMembers`) and its host-shaped page |
| `BPMMemberBaseAdapterOptions`, `BPMMemberBaseResolverProviderOptions` | interface | Field readers + provider options for the member-base adapter |
| `BPMMemberBaseResolverAdapter` | class | Adapts a `BPMMemberBaseDirectory` into a `BPMMemberResolver` (exposes `searchPaged` only when the directory implements `searchMembersPaged`, and `resolveInactive` only when it implements `resolveInactiveMembers`) |
| `createBPMMemberBaseResolverProvider`, `createBPMAuthContextFromMemberBaseMember`, `readMemberMetadataFromMemberBaseMember` | function | Provider factory, auth-context projector, and metadata reader |

## `@rytass/bpm-core-nestjs-module/organization`

| Category | Names |
|---|---|
| Entities | `OrgUnitEntity`, `PositionEntity`, `MembershipEntity`, `ManagerResolutionEntity` |
| ObjectTypes | `OrgUnitOptionObject`, `OrgUnitRetirementImpactObject`, `OrgUnitTreeCommitResultObject`, `OrganizationSummaryObject`, `ResolvedManagerObject` |
| Enums | `OrgUnitTypeEnum`, `ManagerResolutionScopeTypeEnum` |
| DTOs | `CreateOrgUnitInput`, `UpdateOrgUnitInput`, `CommitOrgUnitTreeDraftInput`, `CommitOrgUnitTreeDraftMoveInput`, `CreatePositionInput`, `UpdatePositionInput`, `CreateMembershipInput`, `UpdateMembershipInput`, `CreateManagerResolutionInput`, `UpdateManagerResolutionInput` |
| Service | `OrganizationService`, `DeleteOrgUnitOptions` |
| Time zone | `BPMRootOrganizationOptions` (the `organizationTimeZone` root option), `DEFAULT_BPM_ORGANIZATION_TIME_ZONE` (re-exported from `@rytass/bpm-core-shared` since the next release; same name and value), `resolveBPMOrganizationTimeZone(value)` (validates and applies the default; throws on an unknown zone), `formatDateOnlyInTimeZone(date, timeZone)` (the `YYYY-MM-DD` date an instant falls on in a zone) |
| Module | `OrganizationModule` |
| GraphQL | `OrganizationDirectoryQueries`, `OrganizationPickerQueries`, `OrganizationQueries`, `OrganizationMutations` |

`OrganizationPickerQueries` is `@BPMAuthenticated()` — any signed-in member, not only a designer — and holds only the two reads behind the 組織選擇 (`org_unit`) form field, because a person filling in a form is not a designer: `searchOrgUnitOptions(searchText, limit)` (live units whose code or name contains the text, case-insensitive with `%` `_` `\` matched literally; a blank text lists the first units in tree order; `limit` defaults to 20 and is clamped to 1–50) and `orgUnitOptionsByIds(ids)` (up to 100 ids, **including retired units** with `deleted: true`, so a stored value can still be shown; an id that is not a uuid matches nothing). Both return `OrgUnitOption { id, code, name, deleted }` and nothing else — no parent, path, type or metadata. `OrganizationService` exposes them as `searchOrgUnitOptions({ searchText, limit })` and `listOrgUnitOptionsByIds(ids)`.

`OrganizationDirectoryQueries` is `@BPMDesignerOnly()` and holds only `orgUnits`, `positions` and `memberships`: the template designer and the compose wizard (which embeds it) load them through `readOrganizationDirectory()` to fill their approver pickers, and a designer is not necessarily an administrator. `OrganizationQueries` (manager rules, the counts, the summary, `orgUnit`, `orgUnitRetirementImpact`, `resolvedManager`) and `OrganizationMutations` stay `@BPMAdminOnly()` as whole classes, so a read added to `OrganizationQueries` is closed to designers by default. Nest runs class and method guards together, so a method can only be made stricter than its class, never looser; a read is opened to designers by moving it to `OrganizationDirectoryQueries`.

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
> `OrganizationService.deleteOrgUnit(id, { transferToOrgUnitId? })` (successor retirement was released in `v0.17.0`) retires a
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

The template designer reads "today" in the zone passed to the React providers
as `organizationTimeZone` (`<BPMNextProviders organizationTimeZone="…">` or
`<Providers>`), defaulting to the same `Asia/Taipei`. A host that sets
`organizationTimeZone` on `BPMRootModule` passes the same value there, or the
designer's position pickers and dry-run preview can disagree with the engine
for a membership effective from today (released in v0.21.1).

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
| Module | `FormDataSourceModule`, `FormDataSourceModuleOptions` (PR #145, released in v0.21.1: optional `workflowEngineModule`, the engine `DynamicModule` to import instead of the plain `WorkflowEngineModule`) |
| Service | `FormDataSourceService`, `BPMFormDataSourceOptionResult`, `BPMFormDataSourceResolveResult`. Phase 23 P4／P5 integration, released in v0.20.0: `FormDataSourceService.searchFormFieldOptions` takes `position: FormDataSourceBindingPosition` (`TOP_LEVEL_BINDING_POSITION` or `createTableColumnBindingPosition(rowValues)`) in place of the optional `rowValues` (breaking), so its two queries evaluate a table column as a column, from the schema, even when no row was sent; the three are re-exported from `form-data-source.service.ts`. `FormDataSourceValueResolverService.resolveFormFieldOptions` keeps its input and still reads the position from `rowValues` (its input carries no schema), so a table-column expression that reads `row` without row values fails closed as `INVALID_BINDING` |
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
`FORM_DATA_SOURCE_RUNTIME_CONTEXT_FORBIDDEN`. A launch context is allowed when
`WorkflowEngineService.readFormOptionsTemplateVersion` opens the template for
the member: its initiator policy, judged with the resolver's
`purpose: 'FORM_OPTIONS'` answer (since v0.22.0; before, the template had to
be in the member's launchable list). An instance being resubmitted must
be addressed by `instanceId` alone so its options resolve against its own form
definition snapshot rather than whatever version the template publishes today.

## `@rytass/bpm-core-nestjs-module/template`

| Category | Names |
|---|---|
| Entities | `ApprovalTemplateEntity`, `ApprovalTemplateVersionEntity`, `ApprovalTemplateCategoryEntity` |
| DTOs | `CreateApprovalTemplateInput`, `UpdateApprovalTemplateInput`, `UpdateApprovalTemplateDraftInput`, `CreateApprovalTemplateCategoryInput`, `UpdateApprovalTemplateCategoryInput`, `ComposeApprovalTemplateWithFormInput` |
| Objects | `ComposeApprovalTemplateWithFormObject` (the client's result type is `ComposeApprovalTemplateWithFormResult`), `FilterableFieldIssueObject` (GraphQL `FilterableFieldIssue`, ADR 25; the result of the `filterableFieldIssues` query below) |
| Functions | `parseWorkflowDefinitionJson()`, `lintWorkflowDefinition()`, `WorkflowDefinitionLintResult` (type), `EMPTY_WORKFLOW_DEFINITION` (unchanged, no dialect), `NEW_TEMPLATE_WORKFLOW_DEFINITION` (Phase 23 P4, released in v0.20.0: the same with `expressionDialect: 'cel-v2'`, what `createApprovalTemplate` now saves), `readUsagePointExpressions(definition, initiatorPolicyCel)` / `UsagePointExpression` / `ExpressionSource` (every expression of a definition with its label and use point) |
| Designer expression tools (Phase 23 P4, released in v0.20.0) | `ExpressionDesignerService` and the `@BPMDesignerOnly()` queries `previewExpression(input: BPMPreviewExpressionInput)`, `expressionCatalog(input: BPMExpressionCatalogInput)`, `analyzeWorkflowExpressions(input: BPMWorkflowExpressionsInput)` and `previewWorkflowDialectUpgrade(input: BPMWorkflowExpressionsInput)`, registered in `TemplateModule`. They read the draft the designer sends (nothing is stored) and answer with `BPMExpressionPreview` / `BPMExpressionIssue` / `BPMExpressionEvaluation`, `BPMExpressionCatalog` / `BPMExpressionCatalogField` / `BPMExpressionCatalogFunction` / `BPMExpressionCatalogFunctionParameter`, `BPMWorkflowExpressions` / `BPMWorkflowExpressionAnalysis`, `BPMWorkflowDialectUpgradePreview` / `BPMWorkflowDialectDifference`. Their TypeScript export names (from `dto/expression-designer.dto.ts`): inputs `PreviewExpressionInput`, `ExpressionCatalogInput`, `WorkflowExpressionsInput`; objects `ExpressionPreviewObject`, `ExpressionIssueObject`, `ExpressionEvaluationObject`, `ExpressionCatalogObject`, `ExpressionCatalogFieldObject`, `ExpressionCatalogFunctionObject`, `ExpressionCatalogFunctionParameterObject`, `WorkflowExpressionsObject`, `WorkflowExpressionAnalysisObject`, `WorkflowDialectUpgradePreviewObject`, `WorkflowDialectDifferenceObject`; type `ExpressionPreviewMode`. Limits: `MAX_PREVIEW_EXPRESSION_LENGTH` (2 000), `MAX_PREVIEW_SAMPLE_CONTEXT_JSON_LENGTH` (8 192), `MAX_DESIGNER_WORKFLOW_DEFINITION_JSON_LENGTH` (1 MiB), `EXPRESSION_PREVIEW_MODES`; from `expression-designer.service.ts`: `MAX_DESIGNER_EXPRESSIONS` (500; a draft with more expressions is refused, not truncated), `DIALECT_UPGRADE_CHECK_TIME_LIMIT_MS` (2 000, the upgrade check's wall clock; past it the result is `complete: false`) and `EXPRESSION_PREVIEW_LABEL` (`'expression'`, the label preview findings carry). The catalog reads the host registry's `list()` in isolation: when it throws, `functionsAvailable` is `false` and only `code=EXPRESSION_CATALOG_UNAVAILABLE reason=registry` is logged. The upgrade check runs every expression through both engines (`runExpressionDifferential`) on a filled and an empty sample under a 2 s wall clock. `readLastDecisionIssues(expression, label, usagePoint, edgeSourceNodeType, dialect)` produces `EXPR_LAST_DECISION_UNAVAILABLE` |
| Enums | `ApprovalTemplateLaunchModeEnum` (GraphQL `ApprovalTemplateLaunchMode`: `OPEN`, `HOST_ONLY`; ADR 27 §5, the `launchMode` of a template version), `ApprovalTemplateListStatusEnum`, `ApprovalTemplateActivationStatusEnum`, `ApprovalTemplateCategoryStatusEnum`, `ApprovalTemplateVersionStatusEnum`, `BPMTemplateChangeActionEnum`, `FilterableFieldIssueKind` (GraphQL `FilterableFieldIssueKind`: `TYPE_CHANGED`, `INVALID_VALUES`; ADR 25) |
| Service | `TemplateService` (injects `BPM_EXPRESSION_FUNCTION_REGISTRY` as `@Optional()`: publish checks every `cel-v2` function call through `assertPublishable`, falling back to the built-in names when no registry is bound; rollback checks only that the version's functions are still registered and does not lint again — released in v0.20.0) |
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

**Publish-time checks of the form and earlier-signer sources.** The same
publish also checks the four newer resolver types. Structure:
`FORM_MEMBER_MANAGER` / `FORM_ORG_UNIT_MANAGER` need a `formPath`;
`FORM_MEMBER_MANAGER` / `NODE_ACTOR_MANAGER` need an integer `levelsUp >= 1`;
`NODE_ACTOR` / `NODE_ACTOR_MANAGER` need `nodeIds` that is non-empty, does not
list the node itself, and names existing `userTask` nodes; the three manager
types take the same `fallback` rules as `ORG_MANAGER`; a resolver `type` this
build does not know is refused (`...approverResolver.type is not supported`),
and so is any of the four as a NOTIFY recipient source
(`...action.recipients.type is not supported`). Bound form:
`FORM_MEMBER_MANAGER` follows the `DYNAMIC_FORM` rules above and the member
field must also not be `multiple` (`<path> must reference a single-person
member field, not a multiple one: <fieldKey>`); `FORM_ORG_UNIT_MANAGER` needs
an `org_unit` field under the same required / always-visible rule
(`<path> must reference an org unit (組織選擇) field of the bound form: <path>`,
`<path> must reference a required org unit field that no visibility rule or
hidden flag can leave empty: <fieldKey>`). Graph: once the definition has
passed the structural lint, `NODE_ACTOR` / `NODE_ACTOR_MANAGER` nodes run the
shared `readNodeActorSourceIssues`, each line prefixed
`workflow.nodes.<id>.approverResolver.nodeIds: `.

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

**Filterable-field checks (ADR 25, released in v0.21.0).** Publishing a version (`publishApprovalTemplateVersion`, including the compose path) and rolling back (`rollbackApprovalTemplateVersion`) run `assertTemplateFilterableFieldsEnabled` on the version that becomes current. Any issue is a `ConflictException` (409) that lists each one: a type change against an older version that holds instances, or instance values that do not fit the type. The instance scan covers only the paths that are filterable for the first time, or whose field type changed, relative to the template's current version; a publish that makes nothing newly filterable reads no instance. The designer's read-only `filterableFieldIssues` query still scans every filterable path. The helpers are in `filterable-field-guard.ts`, which is not re-exported from the package index.

The designer's read-only check is the `filterableFieldIssues` GraphQL query, guarded by `@BPMDesignerOnly()` (the answer names templates and instance ids):

```graphql
filterableFieldIssues(
  templateId: ID            # both ids: only that template
  formDefinitionId: ID      # only this id: every template on that form definition
  schemaJson: String!       # the schema in the editor
): [FilterableFieldIssue!]!
```

It returns `kind`, `path`, `label`, `fieldType`, `templateId`, `templateName`, `message`, `conflictVersionNumbers`, `invalidInstanceCount` and `sampleInstanceIds`. It blocks nothing, and it never returns stored values. Neither id given returns an empty list. `FilterableFieldQueries` is the resolver class; it is not exported from the package index, but the query is part of the schema.

## `@rytass/bpm-core-nestjs-module/workflow-engine`

Workflow execution engine — the heaviest module.

| Category | Names |
|---|---|
| Entities | `ApprovalInstanceEntity` (incl. `formDataOptionSnapshot` / `formDataOptionSnapshotJson`, the nullable `businessKey`, and `formDataFingerprint` — a getter over the stored `formData` like the `*Json` ones, reliable on queries that return entity instances such as `approvalInstance`; hand it back as `expectedFormDataFingerprint`), `TaskEntity` (incl. `isAdhoc` / `adhocType` / `adhocOriginTaskId` / `adhocDirectiveId` / `slaStartedAt` / `nodeLabel` / `hasFillableFields`, read from the instance's workflow snapshot in the same batch query as `nodeLabel`), `TaskDecisionEntity`, `TaskCandidateEntity` (incl. `sequence`; status `WAITING` = not this candidate's turn yet in a `SEQUENTIAL` task, and `ActivityLogEventTypeEnum.TASK_CANDIDATE_ACTIVATED` is logged when the turn passes), `WorkflowTokenEntity`, `ActivityLogEntity` (incl. `seq`), `AdhocDirectiveEntity` |
| DTOs | `SubmitApprovalInstanceInput`, `DecideTaskInput`, `CancelApprovalInstanceInput`, `ResubmitApprovalInstanceInput`, `DryRunApprovalWorkflowInput`, `AdhocTargetInput`, `AdhocNotificationInput`, `ReassignTaskInput`, `ReassignMemberTasksInput` |
| Objects | `ApprovalInstancePageInfoObject`, `WorkflowDryRunResultObject`, `WorkflowDryRunStepObject`, `WorkflowDashboardSummaryObject`, `TaskReassignmentResultObject` (fields `taskId`, `instanceId`, `nodeId`, `outcome`, `errorCode`, `message`; the engine's plain shape is the interface `TaskReassignmentResult`), `MemberOpenTaskObject`, `InactiveMemberWithOpenTasksObject` (GraphQL `InactiveMemberWithOpenTasks`: `memberId`, `name`, `email`, `openTaskCount`; the rows of the admin-only `inactiveMembersWithOpenTasks` query) |
| Engine | `WorkflowEngineService` (incl. `findApprovalInstanceByBusinessKey`, `requestAdhocCountersign` / `requestAdhocPreApproval` / `configureAdhocNotification` / `cancelAdhocDirective` / `listAdhocDirectives`, `reassignTask` / `reassignMemberTasks` / `listMemberOpenTasks` / `listInactiveMembersWithOpenTasks`, `listInboxTasks` / `countInboxTasks` / `listApprovalHistoryTasks` / `countApprovalHistoryTasks`), `evaluateWorkflowEdgeCondition()`, `WorkflowConditionContext` |
| Decision options | `DecideTaskOptions` (engine-internal knobs kept out of the GraphQL schema: `transferReason`, and `automatic?: 'SLA_AUTO_APPROVE'`, which the SLA scan sets on a timeout auto-approval so the `TASK_DECIDED` activity payload carries `automatic` and a `NODE_ACTOR` / `NODE_ACTOR_MANAGER` node does not count it as someone's approval; a person's decision leaves the key out), `ExpireApprovalInstanceCommand` (`instanceId`, optional `comment`, `nodeId`, `taskId`; the input of `WorkflowEngineService.expireApprovalInstance`, which SLA `TERMINATE_INSTANCE` calls), `ReassignTaskOptions` (`actorMemberId`, `fromMemberId`, `toMemberId`, `reason`, `dryRun`; the options of `WorkflowEngineService.reassignTask` / `reassignMemberTasks`), the engine's plain return shapes `TaskReassignmentResult` (interface, same name as the GraphQL object), `MemberOpenTaskRecord` and `InactiveMemberOpenTasksRecord` (the rows of `listInactiveMembersWithOpenTasks`), `MANUAL_TRANSFER_DELEGATION_REASON`, `ADMIN_REASSIGN_DELEGATION_REASON` (`'ADMIN_REASSIGN'`, the delegation-chain reason of an administrator reassignment; its step carries `actorMemberId` and `comment`, both optional on `DelegationStep`) |
| Business key | `MAX_APPROVAL_INSTANCE_BUSINESS_KEY_LENGTH` (200 characters, counted as code points) |
| List options | `ListApprovalInstancesOptions` (ADR 25, released in v0.21.0; the options of `listApprovalInstances` and `readApprovalInstancePageInfo`): `fieldFilters?` (`ApprovalInstanceFieldFilter[]` from `@rytass/bpm-core-shared`), `page?`, `pageSize?`, `searchText?`, `sort?` (`ApprovalInstanceSort[]`), `state?` (`ApprovalInstanceStateEnum[]`), `templateId?`, `templateKey?` (ADR 27 §6, the GraphQL `templateKey` argument of `approvalInstances` / `approvalInstanceCount` / `approvalInstancePageInfo`: resolved to the live template's id, so field filters and sort work with it too; with `templateId` as well both must name the same template, and an unknown key matches nothing), `view?` (`ApprovalInstanceListViewEnum`). `countApprovalInstances` takes `Omit<ListApprovalInstancesOptions, 'page' | 'pageSize' | 'sort'>`, so a count cannot be given a page or a sort. `TaskListPageOptions` (`page?`, `pageSize?`), `TaskTemplateFilter` (`templateIds?`, `templateKey?`; ADR 27 §7 — keeps tasks of those templates, both given means both must match, an unknown key matches nothing), `InboxTaskListOptions` (`TaskListPageOptions` and `TaskTemplateFilter`; the options of `listInboxTasks` — omit the page for every open task — while `countInboxTasks` takes the filter alone) and `ApprovalHistoryTaskListOptions` (adds `instanceState?` and `TaskTemplateFilter`; the options of `listApprovalHistoryTasks`, whose unpaged form returns the latest 50, and of `countApprovalHistoryTasks`, which ignores the page) |
| Tokens | `BPM_WORKFLOW_ENGINE_SERVICE` (typed by the `BPMWorkflowEngineService` interface: `cancelApprovalInstance`, `decideTask`, `expireApprovalInstance`), `BPM_WORKFLOW_SERVICE_TASK_DISPATCHER`, `BPM_INITIATOR_CUSTOM_FIELDS_RESOLVER` |
| Initiator snapshot | `BPMInitiatorCustomFieldsResolver` (`resolveCustomFields(input)`), `BPMInitiatorCustomFieldsInput` (`authContext`, `defaultSnapshot`, `formData`, `memberId`, `purpose`, `templateId`, `templateVersionId`; `formData` / `templateId` / `templateVersionId` are `null` for the launchable list), `BPMInitiatorCustomFieldsPurpose` (`'FORM_OPTIONS' \| 'LAUNCHABLE_TEMPLATES' \| 'SUBMISSION'`; `'FORM_OPTIONS'` since v0.22.0). `WorkflowEngineService.listLaunchableApprovalTemplates(memberId, authContext?)` passes `authContext` on to the resolver (a bare one for the member when omitted). Released in v0.21.1. `WorkflowEngineService.readFormOptionsTemplateVersion(templateId, memberId, authContext?)` (v0.22.0) answers the published version whose form options the member may read, or `null`; `formData` is `null` and `templateId` / `templateVersionId` are set for it |
| Service tasks | `BPMWorkflowServiceTaskDispatcher`, `BPMWorkflowWebhookDispatchInput`, `BPMWorkflowWebhookDispatchResult`, `DefaultWorkflowServiceTaskDispatcher` (`fetch`-based, 30 s timeout) |
| Enums | `ApprovalInstanceStateEnum`, `ApprovalInstanceListViewEnum`, `ApprovalInstanceFieldFilterOperatorEnum` (GraphQL `ApprovalInstanceFieldFilterOperator`), `ApprovalInstanceSortDirectionEnum` (GraphQL `ApprovalInstanceSortDirection`), `WorkflowTokenStatusEnum`, `TaskStatusEnum`, `TaskAssignmentTypeEnum`, `TaskCandidateStatusEnum`, `TaskDecisionActionEnum`, `AdhocDirectiveTypeEnum`, `AdhocDirectiveStatusEnum`, `AdhocTargetKindEnum`, `AdhocPreApprovalRejectBehaviorEnum`, `MemberTaskRoleEnum`, `TaskReassignmentOutcomeEnum`, `TaskReassignmentErrorCodeEnum`. `ActivityLogEventTypeEnum` gains `INSTANCE_EXPIRED` (an SLA `TERMINATE_INSTANCE` ended the instance; no actor, the overdue task's `nodeId` / `taskId`) and `TASK_REASSIGNED`, written once per administrator reassignment with `actorMemberId`, `fromMemberId`, `toMemberId`, `reason`, `assigneeChanged`, `candidateStatus` and `sequence` in its payload |
| Module | `WorkflowEngineModule`, `WorkflowEngineModuleOptions` |

`WorkflowEngineService` picks its dispatcher rather than reading a registered
default: a binding under `BPM_WORKFLOW_SERVICE_TASK_DISPATCHER` first (the
host's own provider, or `workflowServiceTaskDispatcherProvider`), then the
`workflowServiceTaskDispatcher` runtime value, then the built-in `fetch`
dispatcher. `WorkflowEngineModule.forRoot` deliberately registers nothing when
the host passes no provider — a module-local default would shadow a token the
host bound from its own global module, silently sending WEBHOOK service tasks
through `fetch` instead of the host's signing or queueing dispatcher.

Nest builds **one** `WorkflowEngineService` (PR #145, released in v0.21.1):
`BPMRootModule` builds `WorkflowEngineModule.forRoot(...)` once and hands the
same dynamic module to `FormDataSourceModule.forRoot` through its new
`workflowEngineModule` option. Before, `FormDataSourceModule` imported the plain
class, so a second engine that did not hold `workflowServiceTaskDispatcherProvider`
or `initiatorCustomFieldsResolverProvider` ran the form option DataSources'
launchable-template check. `FormDataSourceModule.forRoot` used on its own still
falls back to the plain class.

### Initiator `customFields` resolver

The initiator snapshot (`ApprovalInstanceEntity.initiatorMetadataSnapshot`) is what initiator
policies, edge and entry conditions and expression approvers read as `initiator.*`.
When a case is submitted without a snapshot the engine builds one from its own
data: `memberId`, `orgUnitIds`, `positionId`, `positionIds`, `primaryOrgUnitId`,
and `customFields: {}`. The GraphQL `submitApprovalInstance` mutation never takes
a snapshot from the client, so every submission from a BPM page gets that
default, and a host had no way to put anything in `customFields` (a station, a
grade, a manager list it computed itself) short of calling the service directly.

Register `BPM_INITIATOR_CUSTOM_FIELDS_RESOLVER` (the `initiatorCustomFieldsResolver`
runtime option, or the `initiatorCustomFieldsResolverProvider` wiring option) to
fill it:

| Situation | `customFields` of the stored snapshot |
|---|---|
| No resolver registered | `{}`, exactly as before |
| Caller passed `initiatorMetadataSnapshotJson` (a host calling the service) | The caller's snapshot, stored as it is; the resolver is **not** called |
| Engine-built snapshot (no snapshot passed, including every GraphQL submission) | What `resolveCustomFields` returned (`purpose: 'SUBMISSION'`) |
| Resolver throws an `HttpException` | The submission fails with that exception as it is; no case is created |
| Resolver throws anything else | The submission fails with `InternalServerErrorException` (`無法取得發起人的自訂欄位，這次申請沒有送出；請稍後再試或聯絡系統管理者`); the original error is logged, never sent to the client; no case is created |
| Resolver takes longer than 10 s | The submission fails with `InternalServerErrorException` (`無法取得發起人的自訂欄位（逾時），這次申請沒有送出；請稍後再試或聯絡系統管理者`); no case is created. The timer is cleared when the resolver answers in time; what it settles with after the timeout is logged as a warning and dropped |
| Resolver returns anything but a plain, JSON-serializable object (`null`, an array, a string, a `Date`, a circular object, an object whose `toJSON` returns a non-object) | The submission fails with `InternalServerErrorException` (`無法取得發起人的自訂欄位（回傳格式不正確），這次申請沒有送出；請聯絡系統管理者`); what was wrong is logged; no case is created |

A submission never falls back to `{}`: every failure above leaves no case.

Rules:

- The resolver decides `customFields` and nothing else. `memberId`, `orgUnitIds`,
  `positionId`, `positionIds` and `primaryOrgUnitId` always come from the engine;
  it receives copies of the default snapshot and the form data, so editing them
  changes nothing.
- A submission calls it once, after the form data is validated and before the
  initiator policy is evaluated, so `initiatorPolicyCel` reads what it returned.
  It runs outside the engine transaction.
- The snapshot is fixed at that moment. Resubmitting a returned case does not call
  the resolver again and does not change the stored snapshot.
- `listLaunchableApprovalTemplates` (the `launchableApprovalTemplates` query)
  calls it too, **once per request** with `purpose: 'LAUNCHABLE_TEMPLATES'` and `null` for `formData`,
  `templateId` and `templateVersionId`, and judges every template's initiator
  policy against what it returned. So the answer must depend on the initiator
  only: a template the list shows has to be one the member can then submit.
  Return the same `customFields` for both purposes.
- The form data source's runtime check of a template (`formFieldOptions` /
  `resolveFormFieldOptions` with `templateId`) calls it once per request with
  `purpose: 'FORM_OPTIONS'`, that `templateId` and its published
  `templateVersionId`, and `null` for `formData`, then judges that template's
  initiator policy (since v0.22.0). This is the one purpose that may answer
  differently: it opens the template's options and nothing else, so a template
  only the host's backend submits can let members fill its form while the list
  and the GraphQL submission still refuse them. It falls back to
  `customFields: {}` on a failure as the list does; the snapshot is never
  stored.
- The list degrades where a submission fails. When the resolver throws (an
  `HttpException` included), returns a bad value or takes longer than 10 s, the
  list is still answered: it is judged against `customFields: {}` and a warning
  is logged. That fails closed — a policy that reads `initiator.customFields`
  then hits a missing key (`EXPRESSION_MISSING_KEY` in either dialect) and only
  that template is left out, by the list's per-template catch — while a template
  whose policy does not read it is listed as usual. A submission never falls back
  this way.
- Not called: `dryRunApprovalWorkflow` (the designer sends its own sample snapshot,
  and a draft has no template version to pass).
- The designer's trial run (`dryRunApprovalWorkflow`) uses the sample snapshot the
  designer sends, whose `customFields` is `{}`. A condition that reads
  `initiator.customFields` therefore evaluates differently in a trial run than
  in a real submission.
- Return a value for every key a template reads. A key whose value is `undefined`
  is dropped when the result is stored, and a condition that reads it then fails
  with `EXPRESSION_MISSING_KEY`, unless the template guards the read with
  `has(initiator.customFields.<key>)`.
- What the resolver returns is stored with the case (`initiatorMetadataSnapshotJson`)
  and can be read by anyone who can read the case. Do not return secrets.
- The `initiatorCustomFieldsResolverProvider` wiring option, the
  `initiatorCustomFieldsResolver` runtime value and a binding of the token in a
  `@Global()` host module all reach the one engine BPM builds; the provider wins
  when more than one is given.

A minimal resolver that adds the initiator's station:

```ts
import {
  BPMInitiatorCustomFieldsInput,
  BPMInitiatorCustomFieldsResolver,
} from '@rytass/bpm-core-nestjs-module';

class StationCustomFieldsResolver implements BPMInitiatorCustomFieldsResolver {
  constructor(private readonly hr: HrDirectory) {}

  async resolveCustomFields({
    memberId,
  }: BPMInitiatorCustomFieldsInput): Promise<Readonly<Record<string, unknown>>> {
    const employee = await this.hr.findByMemberId(memberId);

    return { grade: employee.grade, station: employee.station };
  }
}

// BPMRootModule.forRootAsync({
//   imports: [HrModule],
//   inject: [HrDirectory],
//   useFactory: (hr: HrDirectory) => ({
//     initiatorCustomFieldsResolver: new StationCustomFieldsResolver(hr),
//   }),
// })
```

A template can then say `initiator.customFields.station == 'TPE'` in an edge
condition or in its initiator policy.
A host that computes the approvers itself can return
them in `customFields` (say `approverIds`) and name them with an `EXPRESSION`
approver, `initiator.customFields.approverIds`: an expression approver is evaluated
against the stored snapshot like any other expression.

GraphQL surface added by the ad-hoc feature: mutations `requestAdhocCountersign`, `requestAdhocPreApproval`, `configureAdhocStageNotification`, `configureAdhocCompletionNotification`, `cancelAdhocDirective`; query `adhocDirectives(instanceId)`. Countersign / pre-approval are gated by the node's `allowAddSigner` flag and only affect the single instance (never the template).

### Decide-task errors (approver-filled fields)

What `WorkflowEngineService.decideTask` (and the `decideTask` GraphQL mutation) refuses when a node lets its approver fill in fields (`fieldAccess`, `fill` other than `NONE`). A host that approves server-to-server meets these and has to translate them. The messages are a stable contract. Behaviour and the workflow around them: `docs/08-frontend-schema.md` §8.

**Refusals added by field permissions.** Several can apply to one request: **do not rely on which one comes first**, nor on where they sit among the engine's older refusals (task not found, instance not running, transfer-target checks, …).

| Situation | Exception | Message |
|---|---|---|
| The task is no longer pending, including a decision that lost the race for the instance lock (every node, with or without `fieldAccess`) | `ConflictException` | `Task <taskId> is not pending` |
| GraphQL mutation only: `formDataJson` sent without `expectedFormDataFingerprint` (`'{}'` counts as sent; the service call may leave the fingerprint out) | `BadRequestException` | `expectedFormDataFingerprint is required when formDataJson is set` |
| `formDataJson` sent with an action other than `APPROVED` | `BadRequestException` | `formDataJson can only be sent with an APPROVED decision` |
| `formDataJson` is not valid JSON | `BadRequestException` | the message of the `JSON.parse` error (runtime-dependent) |
| `formDataJson` is valid JSON but not an object (an array, string, number or `null`) | `BadRequestException` | `formDataJson must be a JSON object` |
| `formDataJson` sent for an ad-hoc task | `ForbiddenException` | `Ad-hoc task <taskId> cannot fill in form fields` |
| A key is not a fillable field of the task's node (the keys are listed in the order of the JSON object) | `ForbiddenException` | `Workflow node <nodeId> does not let approvers fill in: <key>, <key>` |
| `expectedFormDataFingerprint` differs from the fingerprint of the current `formData` | `ConflictException` | `Approval instance <instanceId> form data changed; refresh and retry` |

A `REJECTED` decision without a comment gets the existing `Reject decision comment is required` (`BadRequestException`) first, even when it also sends `formDataJson`.

**Validation of the filled fields.** An `APPROVED` decision on a non-ad-hoc task at a node with at least one fillable field is always validated against the case's form snapshot, whether or not it sent `formDataJson` and for every candidate of a `SEQUENTIAL` task. All of these are `BadRequestException`. The checks run in this order and a failing group stops the later ones; the messages of one group are joined with `; `. They are the messages submit uses.

| Check | Message |
|---|---|
| A non-table field the node marks `required` is empty | `Form data is missing required fields: <label or fieldKey>, …` |
| A member field holds the wrong shape | `formData.<fieldKey> must be a member id` (single) / `formData.<fieldKey> must be an array of member ids` (multiple) |
| An `org_unit` field holds anything but a non-blank uuid string | `formData.<fieldKey> must be an organization unit id` |
| A table is not an array | `formData.<fieldKey> must be an array of rows` |
| A row is not an object | `formData.<fieldKey>[<i>] must be an object` |
| A row has a key that is not a column | `formData.<fieldKey>[<i>].<columnKey> is not a table column` |
| A cell value is not valid | `formData.<fieldKey>[<i>].<columnKey> is not a valid cell value` |
| A required column is empty | `formData.<fieldKey>[<i>].<columnKey> is required` |
| Too few rows (`<n>` is `minRows`, or `max(minRows, 1)` when the node marks the table `required`; a table with no value always reads `max(minRows, 1)`) | `formData.<fieldKey> must include at least <n> row(s)` |
| Too many rows | `formData.<fieldKey> must include at most <n> row(s)` |

"Empty" means `undefined`, `null`, a string that is blank after trimming, or an empty array; `false` and `0` are values.

### Decide-task comment requirements

Three refusals about the comment of a decision, all `BadRequestException`, all raised by `WorkflowEngineService.decideTask` (and the `decideTask` mutation). A host that approves server-to-server and translates the messages meets them.

| Situation | Message |
|---|---|
| `REJECTED` without a non-blank comment (every node) | `Reject decision comment is required` |
| `RETURNED` without a non-blank comment at a node with `returnBehavior.requireComment: true` | 「此節點要求退回時填寫意見，請輸入意見後再退回。」 |
| `APPROVED` by a person without a non-blank comment at a node with `requireApprovalComment: true` | 「此節點要求同意時填寫意見，請輸入意見後再同意。」 |

The last two read the instance's workflow snapshot, not the live template: a template that turns the setting on later does not block a case that is already running. Every approval a person makes at the node is held to `requireApprovalComment`, an ad-hoc task's included (its `nodeId` is the main node's). The one approval that is not a person's is the SLA `AUTO_APPROVE` timeout (`DecideTaskOptions.automatic`): it never waits for a comment. A whitespace-only comment counts as none.

### Host-only launch mode (ADR 27 §5)

`ApprovalTemplateVersionEntity.launchMode` (`ApprovalTemplateLaunchModeEnum`,
GraphQL `ApprovalTemplateLaunchMode`) sits beside `initiatorPolicyCel` and is
published with the version:

- `OPEN` (default) — unchanged behaviour.
- `HOST_ONLY` — the template is left out of `listLaunchableApprovalTemplates`,
  and the GraphQL `submitApprovalInstance` and `resubmitApprovalInstance`
  (`endUserSubmission: true`) answer 403 (`ForbiddenException`) before any data
  source is called. A resubmission is judged by the version the instance is
  bound to, so switching a later version does not affect cases already filed.
  The service methods called by the host are not restricted, and neither is the
  form-options check (`FORM_OPTIONS`), so a host's own launch page can still
  read options.

Set it with `launchMode` on `UpdateApprovalTemplateDraftInput` and
`ComposeApprovalTemplateWithFormInput`; absent keeps the draft's value, and a
fork copies it from the version it starts from.


`WorkflowEngineService.submitApprovalInstance` takes an optional
`initiatorCustomFields?: Readonly<Record<string, unknown>> | null` (service
layer only; the GraphQL mutation always passes `null`). The engine still builds
the default initiator snapshot and calls `BPM_INITIATOR_CUSTOM_FIELDS_RESOLVER`
(`purpose: 'SUBMISSION'`), then merges these fields over the resolver's
`customFields`, a key given here winning. The initiator policy reads the merged
snapshot. It replaces hand-building a whole `initiatorMetadataSnapshotJson` just
to add a few fields; passing both is a `BadRequestException`, and so is a value
that is not a plain object.

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

### Activity log write order (`seq`)

`activity_logs.created_at` defaults to `now()` — the transaction start time —
so every row one transaction writes (a submit, an approval and the steps it
advances) carries the same value, and `id` is a random uuid. Ordering by
either leaves those rows in an undefined order: the instance history could show
the next step's task before the decision that created it, or the start event
after the first step.

- **`ActivityLogEntity.seq`** — the write order. A `GENERATED ALWAYS` identity:
  the database numbers every insert and refuses a hand-written value. `bigint`,
  so it reads as a `string`. Not exposed through GraphQL.
- **Readers sort by it.** `listActivityLogs` (GraphQL `activityLogs`) returns
  rows in `seq` order instead of `createdAt`; the latest-return lookup behind
  resubmission and the submit record behind the completion notification's
  "filed on behalf of" name use it too. `@rytass/bpm-core-react` displays the
  history in the order it receives, so the history view follows.
- **Sort by `seq` in your own SQL.** A host reading `activity_logs` directly
  should order by `seq`, not `created_at, id`. It is insert order, not commit
  order: a long transaction can make a smaller `seq` visible after a larger
  one, so it is not a polling watermark across instances.

**Deploy order.** `ActivityLogEntity` selects `seq` on every read and returns
it from every insert, so run `ActivityLogSeq0000000029000` **before** deploying
this version: without the column every activity log read and write fails, and
every approval transaction with it.

**The backfill and its limits.** Existing rows are numbered by `created_at`,
then `cmin` (PostgreSQL's command id of the insert within its transaction),
then `ctid` for the rows one multi-row INSERT wrote, then `id`. This recovers
the real write order only for rows that were never updated — an update
replaces `cmin` — and BPM never updates this table. Rows restored with
`pg_dump`, rewritten by `pg_repack` or copied by logical replication share one
`cmin`, and the order falls back to `ctid`, which is usually but not always the
write order; so does a multi-row INSERT whose rows landed on different pages.
Rows of two transactions on the same instance are ordered by transaction
start, which can differ from write order when one waited for the other.
New rows are exact. Step 1 takes an `ACCESS EXCLUSIVE` lock on
`activity_logs`, and in a transaction that lock is held until commit — through
the backfill, which rewrites every row, `SET NOT NULL`, which scans the table,
and the unique index build. For that whole time nothing can read or write
`activity_logs`, and every submit, decision and instance history read touches
it, so they queue behind the migration or time out. Plan the run as downtime
proportional to the table size, in a maintenance window, and set `lock_timeout`
so step 1 gives up rather than queueing behind long transactions that already
hold the table. Run the migration in a transaction (`each` or `all`): in mode `none`, a row the
old version writes between the backfill and `SET NOT NULL` is `NULL` and fails
that step, and because the column is added without `IF NOT EXISTS`, a rerun
stops at step 1 until `seq` is dropped again.

**Hosts that generate their own migrations.** `migration:generate` produces
only `ADD "seq" bigint GENERATED ALWAYS AS IDENTITY`: PostgreSQL then numbers
existing rows in physical scan order, without the backfill, and without the
unique index. Hand-write it following `ActivityLogSeq0000000029000` statement
for statement. TypeORM's schema diff (0.3.x and 1.x) compares only whether a
column is generated, not `ALWAYS` versus `BY DEFAULT`, so a copy that gets
that wrong is not reported. The entity does not declare
`IDX_activity_logs_instance_seq`, so a later `migration:generate` proposes
dropping it, as it already does for the other migration-only indexes on this
table; declare it on the host side (for example with
`@Index('IDX_activity_logs_instance_seq', { synchronize: false })`) or remove
that statement from the generated file.

**Logical replication subscribers.** Add `seq` on the subscriber as a plain
nullable `bigint` — no identity, no backfill — **before** the publisher runs
this migration (a missing column stops the apply worker); the publisher's
backfill `UPDATE`s replicate the values. When a subscriber is promoted, run
steps 3 to 5 of the migration there (`SET NOT NULL`, the identity `DO` block,
the unique index).

### Approval-instance list: field filters and sort (ADR 25, released in v0.21.0)

The GraphQL list queries take form-field conditions and sort keys. Available from `WorkflowEngineService.listApprovalInstances`, `countApprovalInstances` and `readApprovalInstancePageInfo` (the service takes the same options; `countApprovalInstances` ignores `sort`).

| GraphQL query | New arguments |
|---|---|
| `approvalInstances(...)` | `fieldFilters: [ApprovalInstanceFieldFilterInput!]`, `sort: [ApprovalInstanceSortInput!]` |
| `approvalInstancePageInfo(...)` | `fieldFilters`, `sort` (same types) |
| `approvalInstanceCount(...)` | `fieldFilters` only |

All new arguments are optional; existing calls are unaffected.

- **Input types (GraphQL names).** `ApprovalInstanceFieldFilterInput`: `fieldKey` (≤ 200 chars), `operator` (`ApprovalInstanceFieldFilterOperator`: `EQUALS`, `NOT_EQUALS`, `IN`, `RANGE`, `CONTAINS`), `values` (≤ 100 items, each ≤ 500 chars), `from`, `to` (≤ 500 chars). `ApprovalInstanceSortInput`: `field` (a filterable top-level fieldKey, or `submittedAt`, `updatedAt`, `completedAt`), `direction` (`ApprovalInstanceSortDirection`, default `DESC`). The TypeScript classes behind them are not exported from the package index; the service-level types are `ApprovalInstanceFieldFilter` and `ApprovalInstanceSort` from `@rytass/bpm-core-shared` (see that section).
- **Requires `templateId`.** Any `fieldFilters`, or a `sort` on a form field, without `templateId` is refused (`BadRequestException`). The three time sort keys work without it.
- **Limits.** At most 20 conditions and 5 sort keys (`BadRequestException` above that). A `fieldKey` that is not a filterable field of the template's current version is refused with one generic message, so the response does not reveal whether the field exists. An unsortable key gets the same treatment.
- **Current version only.** The filterable fields are those marked `filterable` in the template's current form version (`current_version_id`). Unmarking a field stops the API from accepting it; the stored values stay and re-marking makes it usable again.
- **Operators by type.** `textarea`: `CONTAINS`. `boolean`: `EQUALS`. `text`, `select`, `autocomplete`, `radio`, `checkbox`: `EQUALS`, `NOT_EQUALS`, `IN`, `CONTAINS`. `number`, `money`: `EQUALS`, `NOT_EQUALS`, `IN`, `RANGE`. `date`, `datetime`: `EQUALS`, `NOT_EQUALS`, `RANGE`. `member`, `org_unit`: `EQUALS`, `NOT_EQUALS`, `IN`.
- **Combining.** All conditions are ANDed. Several conditions on the same path are merged (a range given as two entries). For a multi-value field (checkbox, multiple select / autocomplete / member), `EQUALS` and `IN` match when any value matches; `NOT_EQUALS` matches when no value equals the given one. An instance with no value matches no condition, `NOT_EQUALS` included.
- **Values.** Numbers and money are decimal strings, dates are `YYYY-MM-DD`, datetimes ISO 8601. Values are compared as their canonical text (dates and datetimes compare as strings; no SQL date cast), so an impossible date such as `2026-02-30` never fails the query. A value in a non-canonical format counts as no value. `CONTAINS` is a case-insensitive substring match against the stored value and, for an option field, its display name: a data-source option's name from the instance's option snapshot (the name at submission time; a later rename does not change old results), a static option's name from the template's versions that hold instances. `%`, `_` and `\` in the text are escaped.
- **Table columns.** `<tableKey>.<columnKey>` matches an instance when any row matches. Several conditions on the same table must hold on the **same row**. Table columns cannot be sorted on; a host that needs an aggregate sort should store it in a top-level hidden field and sort on that.
- **Sorting.** Sort keys apply in order. Top-level filterable fields (not `textarea`) and the three time fields are allowed. `submittedAt` is `started_at` (first submission; a resubmit keeps it), `updatedAt` is `updated_at` (see the table below), `completedAt` is `completed_at` (NULL until completed). A stored value of the wrong type sorts as NULL.
- **NULL order.** PostgreSQL's default: ascending puts NULLs last, descending puts them first.
- **Tie-breaker.** `id` is always the final key, in the direction of the last sort key. With no `sort`, the order is `created_at DESC, id DESC`. Earlier versions had no tie-breaker, so pages could repeat or skip rows with equal `created_at`.
- **Visibility.** Field filters and sort apply after the caller's readable-instance filter. Instances the caller cannot read never take part in the match, so they cannot affect results or counts. `canReadAllWorkflows` sees all instances. In v1 a field is filterable for anyone who can read the instance, because the read model returns the whole `formData`. A field hidden by `display: HIDE` or the `hidden` flag is still filterable; neither is a confidentiality boundary.
- **Count and page info agree.** `approvalInstances`, `approvalInstancePageInfo` and `approvalInstanceCount` share one query builder, so their counts match. Paging stays `page` / `pageSize` (OFFSET).
- **Index.** EQUALS and IN on a top-level field compile to `form_data @> …` and use the GIN index of migration `ApprovalInstanceFormDataGin0000000031000`. Other conditions and sorts are evaluated row by row over the template's instances.
- **v1 performance scope.** Designed for up to 10,000 instances per template, with a target of p95 < 300 ms for a paged query with 2–3 conditions and a sort. **Not measured yet.** Larger hosts need a new design; the GraphQL and client API would not change.
- **Writes check the type.** A filterable field's value is type-checked on submit, resubmit, an approver's fill (`decideTask` with `formDataJson`) and `SET_FORM_FIELD`, and a value of the wrong type is refused with `BadRequestException` (400). Submit checks against the submitted version, the other three against the current version, as the list reads it. Values that are absent, `null`, or `""` for a number, money, date, datetime or boolean field count as "no value" and pass.
- **Publish and rollback check the history.** Publishing (including the compose path) and rolling back check every field the new current version marks `filterable`: the same path must have had the same type in every older version that holds instances, and existing instances must hold values of the right type. A failure is a `ConflictException` (409) listing each issue. The designer can run the same check in advance with the `filterableFieldIssues` query (see the template section).
- **Designer warnings are not blocking.** Saving a draft never fails because of filterable fields.

#### `updatedAt` sort semantics

`updatedAt` sorts on `approval_instances.updated_at`. The table lists which engine actions write that row. The classification was read from the save calls in `workflow-engine.service.ts` (`instanceRepository.save`, `manager.getRepository(ApprovalInstanceEntity).save`); it was not tested.

| Action | Bumps `updated_at` |
|---|---|
| Submit, resubmit | Yes |
| Return (including a return to the start), reject | Yes |
| Cancel, and SLA `TERMINATE_INSTANCE` expiry (`closeInstance`) | Yes |
| Instance completes | Yes |
| Approver fill: a decision whose `formDataJson` changes a value (no change, no write) | Yes |
| `SET_FORM_FIELD` service task | Yes |
| Non-final approval | No |
| Transfer, administrator reassignment | No |
| Ad-hoc countersign, pre-approval, directive cancel | No |
| Reminders, NOTIFY webhook and notification service tasks | No |

#### Migration `ApprovalInstanceFormDataGin0000000031000`

- Creates `IDX_approval_instances_form_data_gin` (`USING gin ("form_data" jsonb_path_ops)`) with `CREATE INDEX IF NOT EXISTS`, inside the migration transaction. Nothing else changes: no table, column or backfill. `down()` drops the index.
- The build takes a SHARE lock on `approval_instances`, which blocks writes to instances while it runs. It is not `CONCURRENTLY`: TypeORM's default `migrationsTransactionMode` (`all`) rejects a batch that contains a non-transactional migration.
- **Large hosts.** Build the index before upgrading, outside any transaction, with the same name. The migration then skips it (`IF NOT EXISTS`):

  ```sql
  CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_approval_instances_form_data_gin"
    ON "approval_instances" USING gin ("form_data" jsonb_path_ops);
  ```

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
| Publish lint | `lintWorkflowWebhookTargets`, `LintWorkflowWebhookTargetsInput` (P6 adds optional `isEndpointUrlAllowed`, reported as `WORKFLOW_WEBHOOK_URL_NOT_ALLOWED`; Phase 23 P5 adds optional `conditionService`, which lints `EXPRESSION` bindings as `NOTIFY_WEBHOOK_BINDING` — without it such a binding cannot be published) |
| Errors | `BPM_WORKFLOW_WEBHOOK_ERROR_CODES` (P6 adds `DATABASE_SOURCE_DISABLED`, `ENDPOINT_DISABLED`, `ENDPOINT_KEY_CONFLICT`, `ENDPOINT_INVALID`, `ENDPOINT_CONTRACT_CHANGED`, `TEST_RATE_LIMITED`), `BPMWorkflowWebhookErrorCode`, `BPMWorkflowWebhookException` |
| GraphQL | `WorkflowWebhookQueries` (`workflowWebhookEndpoints(includeDeprecated)`, designer-only), `WorkflowWebhookEndpointObject` (P6 adds `disabled`), `WorkflowWebhookParameterObject`, `WorkflowWebhookEndpointSourceEnum` (GraphQL enum `BPMWorkflowWebhookEndpointSource`), `WorkflowWebhookParameterTypeEnum` (GraphQL enum `BPMWorkflowWebhookParameterType`) |
| Delivery | `WorkflowWebhookDeliveryService` (`enqueueNotifyWebhooks` inside the engine transaction, `deliverDue` for the scheduler, `deliverByIds` after commit, `listInstanceDeliveries`, `retryFailedDelivery` (an attempted `FAILED` row → `PENDING` with `attemptCount` 0; a row that failed while being queued is refused, a `WEBHOOK_DELIVERY_RETRIED` activity log in the same transaction, then an immediate attempt after commit), `readEndpointLabel`, `sendTestEvent` (P6: one event through the normal checks without a delivery row), `readRetryDelay`, `readCurrentTime`), `WorkflowWebhookTestOutcome`, `WorkflowWebhookDeliverySubscriber` (TypeORM subscriber that releases queued ids on commit and drops them on rollback), `WorkflowWebhookDeliverySchedulerService`, `BPM_WORKFLOW_WEBHOOK_FETCH` / `WorkflowWebhookFetch` (HTTP client, defaults to global `fetch`) |
| Observability | `WorkflowWebhookDeliveryResolver` (administrator-only `workflowWebhookDeliveries(instanceId)` and `retryWorkflowWebhookDelivery(id)`), `WorkflowWebhookDeliveryObject` (GraphQL `BPMWorkflowWebhookDelivery`; no frozen event, parameters or token id) |
| Outbox record | `WorkflowWebhookDeliveryEntity` (table `workflow_webhook_deliveries`, not a GraphQL type), `WorkflowWebhookFrozenEvent`, `WorkflowWebhookDeliveryStatusEnum` (GraphQL enum `BPMWorkflowWebhookDeliveryStatus`), `WORKFLOW_WEBHOOK_DELIVERY_ERROR_CODES` (P6 adds `ENDPOINT_DISABLED` → `WEBHOOK_ENDPOINT_DISABLED`), `WorkflowWebhookDeliveryErrorCode` |
| Enqueue | `buildWorkflowWebhookDeliveryDrafts` (Phase 23 P5: optional `expressions` evaluator for `EXPRESSION` bindings; without one such a binding fails its delivery), `WorkflowWebhookEnqueueContext`, `WorkflowWebhookDeliveryDraft` |
| Delivery options | `BPMResolvedWorkflowWebhookDeliveryOptions`, `WORKFLOW_WEBHOOK_MAX_TIMEOUT_MS` (30 s cap on any single request) |
| Module | `WorkflowWebhookModule`, `WorkflowWebhookModuleOptions`, `WorkflowWebhookOptionsModule`, `WorkflowWebhookOptionsModuleAsyncOptions` |

The catalog carries **no URL, header or secret**, whichever source an endpoint came from: the browser only ever sees key, version, label, description, parameters and source. `buildRequest()` is called once per delivery attempt rather than at enqueue time, so a rotated credential reaches deliveries that are already queued.

Delivery never happens inside the engine transaction. `enqueueNotifyWebhooks` writes `PENDING` rows (or `FAILED` ones, with their terminal activity log, when the endpoint is gone, its lookup threw, or a parameter no longer fits); the subscriber kicks `deliverByIds` once that transaction commits, and the scheduler (on by default whenever an endpoint is registered; `workflowWebhookDeliverySchedulerEnabled` overrides) retries the rest. Each attempt calls `buildRequest()`, refuses non-http(s) URLs and — for `DATABASE` endpoints, or all endpoints under `workflowWebhookEnforceAllowlistForRegistry` — URLs outside the allowlist, refuses a URL carrying credentials, a method other than `POST`/`PUT`/`PATCH` and a `buildRequest()` result without a string `url`, then sends with `redirect: 'manual'` and a timeout. Each row is re-stamped as its own attempt starts and written back only while that stamp still matches, so a row another worker reclaimed is never sent twice by this one nor overwritten by its late result. `2xx` is `SENT`; `408`/`429`/`5xx`, timeouts, network errors, a throwing `buildRequest()` and a throwing endpoint lookup retry with `base·2^(n−1)` backoff (±20 % jitter, never above the cap); other `4xx`, `3xx`, a missing endpoint and a refused URL fail at once. Rows are claimed at most five at a time and attempted together, the next five only once those finish, so a claimed row is always a row in flight and one receiver running into its timeout delays at most the other four in its group. Error details keep a host error's kind and a network error's system code, never a message that could quote the URL or a secret; at most 500 characters of a failing response body are kept, read from a 4 KB prefix, and NUL is stripped from every stored detail. An unexpected error inside BPM is recorded as `WEBHOOK_INTERNAL_ERROR` and retried. BPM sets `x-bpm-delivery-id`, `x-bpm-event` and, with a `signingSecret`, `x-bpm-timestamp` (the time of sending) and `x-bpm-signature-sha256 = HMAC-SHA256(secret, "<timestamp>.<body>")`; a host header cannot override any `x-bpm-*` header. Only the terminal outcome reaches the activity log (`SERVICE_TASK_EXECUTED` / `SERVICE_TASK_FAILED` with `action: 'NOTIFY_WEBHOOK'`, the endpoint key, version and label), and never the URL or response body. An administrator's retry adds `WEBHOOK_DELIVERY_RETRIED` (`ActivityLogEventTypeEnum`), carrying the acting member and the previous error code.

`workflowWebhookTargetSources` defaults to `['REGISTRY']`. `'DATABASE'` (P6) is dropped from the resolved list unless both `workflowWebhookAllowedUrlPatterns` and `workflowWebhookSecretEncryptionKey` are set; the module logs a warning naming whichever is missing (`resolveAndReportWorkflowWebhookOptions`). An invalid URL pattern throws while options resolve, so it fails the boot rather than silently allowing or denying everything.

## `@rytass/bpm-core-nestjs-module` — expression functions (root export)

Expression function registry (ADR 22 §3.5, docs/24 §2.6) — released in v0.20.0. No subpath yet.

| Name | Kind | Purpose |
|---|---|---|
| `BPMExpressionFunction` | interface | A descriptor without `builtIn`, plus a synchronous `handler(...args)` that only sees deep-frozen copies of its arguments |
| `BPMExpressionFunctionRegistry` | interface | `get(name)` (the function or `null`), `list()` (descriptors, built-ins first), `assertPublishable(names)` (the names that are not available, first-seen order, no duplicates) |
| `BPM_EXPRESSION_FUNCTIONS` | token | Host-provided functions as a list; unset means none. Supplied through `BPMRootModule`'s `expressionFunctionsProvider` |
| `BPM_EXPRESSION_FUNCTION_REGISTRY` | token | The resolved registry the core injects (global) |
| `StaticBPMExpressionFunctionRegistry` | class | `new (hostFunctions?)`: the nine built-ins plus the host functions, validated in the constructor. Lookups are by own name only (`constructor`, `toString` are never found) |
| `EmptyBPMExpressionFunctionRegistry` | class | The nine built-ins only |
| `BUILT_IN_EXPRESSION_FUNCTION_REGISTRY` | const | Shared built-ins-only registry; evaluation falls back to it wherever no registry was handed in |
| `validateExpressionFunctions` | function | `(functions) => readonly BPMExpressionFunction[]`: frozen copies, or a plain `Error` naming the function and the reason — name not matching `BPM_EXPRESSION_FUNCTION_NAME_PATTERN`, a built-in name, a name registered twice, a name starting with `true`, `false` or `null` (cel-js 0.8.2's lexer reads that prefix as a keyword, so cel-legacy could never call it), an `async` / generator handler (read from the prototype chain, so an own `Symbol.toStringTag` cannot hide it; the tag is still checked for a handler from another realm), a missing label, description or parameter list, an unsupported parameter or return type, a duplicated parameter name |
| `BPM_EXPRESSION_VALUE_TYPES` | const | The eight declarable value types (`bool`, `double`, `dyn`, `int`, `list`, `map`, `null`, `string`) |
| `BPM_BUILT_IN_EXPRESSION_FUNCTIONS` | const | The nine built-ins as `BPMExpressionFunction`s (see below) |
| `ExpressionFunctionModule` / `ExpressionFunctionModuleOptions` | Module / interface | Global module publishing `BPM_EXPRESSION_FUNCTION_REGISTRY`; `forRoot({ imports?, functionsProvider? })`. Wired for you by `BPMRootModule` |
| `expressionFunctionRegistryProvider` | Provider | Builds the registry from `BPMRootRuntimeOptions.expressionFunctions` followed by the `BPM_EXPRESSION_FUNCTIONS` list (both optional). Validation runs here, so an invalid function fails the boot under `forRoot` and `forRootAsync` alike; a name in both sources is a boot error. With no host function it returns `BUILT_IN_EXPRESSION_FUNCTION_REGISTRY` itself |

`BPMRootModule` takes host functions as the runtime option `expressionFunctions` (a list) and/or the wiring option `expressionFunctionsProvider` (a provider for `BPM_EXPRESSION_FUNCTIONS`). Unlike the other runtime/provider twins the two are **combined**, runtime list first. With neither, only the built-ins exist.

**Built-ins** (names reserved, no version suffix, available in both dialects): `abs`, `ceil`, `floor`, `round` (one number → `double`; `round` rounds halves away from zero, `round(-2.5)` is `-3`), `min`, `max` (exactly two numbers → `double`), `lower`, `upper` (locale independent), `trim` (one string → `string`). Numeric results are `double` in both dialects and never `-0`. In cel-v2 every function is a global call; the global `trim(s)` sits beside cel-v2's own `s.trim()` method, and no built-in shadows a cel-v2 global function (pinned by a real-engine test).

**Runtime rules** (both dialects, `condition/expression-function-invocation.ts`):

- Arguments are copied through the result walker into fresh deep-frozen JSON values (cel-v2 `int`s become numbers), so a handler never reaches `formData`; a strict-mode write throws `TypeError`, which fails the call. An argument that does not match its declared type, is not JSON, or is beyond the 64 KiB result limits is `EXPRESSION_TYPE_ERROR`, as is the wrong number of arguments.
- A handler that throws (anything, including an `ExpressionRuntimeError`), returns a thenable, or returns a value that is not JSON or not its `returnType` is `EXPRESSION_FUNCTION_FAILED`. Only `function=<name> code=EXPRESSION_FUNCTION_FAILED reason=<threw|thenable|invalid-result|return-type>` is logged, never the handler's message. A native promise gets a rejection handler through the intrinsic `Promise.prototype.then`, so it never becomes an unhandled rejection; a foreign thenable is never adopted and its `then` is never called, so no handler code runs after the evaluation, outside the budget.
- A failure is never absorbed: cel-v2's `||`, `&&` and `exists` absorb errors per CEL, but an evaluation in which any function failed is failed afterwards. A call cel-v2 short-circuits past is not run and does not fail.
- Handler time is part of the evaluation, so it is charged to the expression budget and a handler that does not finish is interrupted (`EXPRESSION_BUDGET_EXCEEDED`).
- A host-shaped name (`…_vN`) or built-in name the registry does not have — a function withdrawn after publishing — fails the evaluation with `EXPRESSION_FUNCTION_FAILED` before the engine runs, wherever the call sits. Any other unknown name keeps the engine's own error (`EXPRESSION_TYPE_ERROR`); the publish lint refuses it first. The publish lint and the rollback check use the same rule: only `…_vN` names and the nine built-ins are put to `assertPublishable`, never the engine's own functions (`size`, `int`, `matches`, …).
- cel-v2 signatures declare `int` / `double` parameters as `dyn` (so `f_v1(1000)` and `f_v1(form.qty)` both reach the handler, which then checks the number); every other parameter type is enforced by the engine. A declared `int` result is handed to cel-v2 as a `bigint`.

`ConditionService` injects `BPM_EXPRESSION_FUNCTION_REGISTRY` optionally and evaluates and lints with it (both dialects call its functions; the cel-v2 lint parses and type-checks in its environment, so host functions are type-checked). `new ConditionService()` still works and has the built-ins only. The registry is host code and the lint isolates it: a `get`, `list` or `assertPublishable` that throws or answers out of shape refuses the names asked about with `EXPR_FUNCTION_NOT_REGISTERED` (a registry whose `list` cannot be read refuses every cel-v2 expression), and only `code=EXPR_FUNCTION_NOT_REGISTERED reason=<fixed word>` is logged — never the registry's message.

## `@rytass/bpm-core-nestjs-module/condition`

| Name | Purpose |
|---|---|
| `ConditionService` | Condition-expression evaluation engine. `new ConditionService(functionRegistry?)`: Nest injects `BPM_EXPRESSION_FUNCTION_REGISTRY` (optional); without one only the nine built-ins exist. `prepareEngine(dialect?)` loads that dialect's engine (default `cel-legacy`) and builds the registry's function environment ahead of first use, outside any budget. `evaluateBoolean` / `evaluateValue` take an optional trailing `ExpressionCallOptions`; `lintExpression` / `lintExpressions` options take an optional `dialect`, whose parser decides syntax. A dialect it does not know is refused as `EXPRESSION_SYNTAX_ERROR` by all of them (lint returns `<label>: EXPRESSION_SYNTAX_ERROR`), never replaced by `cel-legacy`. Under `cel-v2` the lint walks the AST (Phase 23 P2) and returns the ERROR findings as `<label>: EXPR_*` lines (`formatExpressionLintIssue`), a blank or over-long expression included (`EXPR_PARSE_FAILED` / `EXPR_COMPLEXITY_EXCEEDED`, as in `lintExpressionIssues`); `cel-legacy` lines are unchanged. `lintExpressionIssues(expression, label, options?)` returns every finding, warnings included, as `ExpressionLintIssue[]` (released in v0.20.0). Phase 23 P4, released in v0.20.0: implements `OnApplicationBootstrap` and warms both engines at boot (`warmUp(): ExpressionWarmUpResult` — prepare, lint and evaluate one expression per dialect; elapsed ms per dialect, `null` and the log `code=EXPRESSION_WARM_UP_FAILED dialect=<d>` when one fails, never blocking boot; when at least one dialect warmed, `onApplicationBootstrap` also logs one `log`-level line `code=EXPRESSION_WARM_UP_DONE cel-legacy=<ms>ms cel-v2=<ms>ms`, a failed dialect reading `failed`; `warmUp()` itself stays silent). Released in v0.20.0: the cel-v2 lint also compares each registry function argument's checked type with the declared parameter (numbers are `dyn` in the engine signature), so `demo_costBand_v1(form.title)` against a text field is `EXPR_FIELD_TYPE_MISMATCH title`; an argument the check types as `dyn` is left to evaluation |
| `ConditionLintOptions` | Interface (newly exported, released in v0.20.0): the lint options — `dialect`, `maxExpressionLength`, `allowedRootIdentifiers`, `usagePoint` (an `ExpressionUsagePoint`, whose roots apply when no whitelist is given; a value that is not a use point allows no root and, under `cel-v2`, no host function), `formSchema`, `targetField` and `functionRegistry` (`Pick<BPMExpressionFunctionRegistry, 'assertPublishable' \| 'get'>`; absent or `null` means the registry `ConditionService` was given, which is the nine built-ins when it has none) |
| `ExpressionCallOptions` | Interface: optional `allowedRootIdentifiers` (root whitelist for the use point; when given, only those roots of the context reach the engine), `budget` (an `ExpressionBudget` to share) and `dialect` (the definition's or rule's `ExpressionDialect`; absent means `cel-legacy`) |
| `ExpressionDialect` | Type: `'cel-legacy' \| 'cel-v2'` (same as the shared `WorkflowExpressionDialect`) |
| `EXPRESSION_DIALECTS` / `DEFAULT_EXPRESSION_DIALECT` | Const: both dialects; the default `cel-legacy`, which a missing dialect always means |
| `isExpressionDialect` | Function: type guard for `ExpressionDialect` |
| `readExpressionDialect` / `readWorkflowExpressionDialect` | Function `(value, label)` / `(definition)`: the dialect a stored value names; `undefined` / `null` is `cel-legacy`, any other unknown value throws `ExpressionRuntimeError` `EXPRESSION_SYNTAX_ERROR` |
| `ExpressionRuntimeError` | Class. The only error an expression raises to a caller; extends `BadRequestException` (HTTP 400). Its message is `label: CODE` (plus an optional fixed detail), never engine text or context values |
| `EXPRESSION_ERROR_CODES` | Const array of the six ADR 22 §3.2 codes |
| `toExpressionRuntimeError` | Function `(error, label, expression?) => ExpressionRuntimeError`. Maps anything an evaluation threw to one of the six codes; an unrecognised message becomes `EXPRESSION_TYPE_ERROR` and none of its text is kept. `keyName` is set only when `expression` is given and writes that name as an identifier outside string literals (a computed index such as `form.a[form.b]` reports a context value, which is dropped) |
| `ExpressionErrorCode` | Type: union of `EXPRESSION_ERROR_CODES` |
| `ExpressionBudget` | Type (`export type`): the time ledger an operation shares across its expressions. `nextTimeoutMs()` is whole milliseconds; `record()` charges elapsed time |
| `ExpressionBudgetOptions` | Type (`export type`): `perExpressionMs` (default 100) and `cumulativeMs` (default 250) |
| `ConditionModule` | Module wrapper |

> `cel-js` is loaded on first parse, not at module import. Importing anything
> from the package root therefore no longer drags the ESM-only `cel-js` (and
> its `chevrotain` exports map, which `jest-resolve` cannot follow) into a
> host's jest run — consumer suites need no `moduleNameMapper` stub.
>
> `cel-v2` (`@marcbachmann/cel-js` 8, a new runtime dependency) is loaded the
> same way, on the first cel-v2 parse, so a host that never uses the dialect
> never resolves it. Its environment treats undeclared roots as `dyn`, allows
> mixed-type list and map literals, limits expressions to 200 AST nodes and
> depth 32 at parse time, and registers mixed `int`/`double` `+ - * / %` (both
> orders, a zero divisor is `EXPRESSION_TYPE_ERROR`) and exact `int == double`.
> Integer results come back as `number` (outside the safe range:
> `EXPRESSION_INVALID_RESULT`). The differences from `cel-legacy` are listed in
> `docs/23-expression-functions-phases.md` §P1.

## `@rytass/bpm-core-nestjs-module/delegation`

| Category | Names |
|---|---|
| Entity | `DelegationRuleEntity` (`priority`: higher wins among a principal's matching active rules, ties go to the rule created first — the same direction as manager rules; `scopeConditionDialect`: the `ExpressionDialect` `scopeConditionCel` is linted and evaluated with, `cel-legacy` for every rule stored before migration `DelegationScopeConditionDialect0000000030000`; saving a rule lints it at the `DELEGATION_CONDITION` use point, so a `cel-v2` condition must be boolean and may call the registry's host functions) |
| DTOs | `CreateDelegationRuleInput` (optional `scopeConditionDialect`, default `cel-legacy`), `UpdateDelegationRuleInput` (no dialect: an update keeps the rule's) |
| Enums | `DelegationRuleStatusEnum`, `DelegationScopeTypeEnum` |
| Service | `DelegationService` (`resolveAssignee` for one member, `resolveAssignees` for a whole node — the first hop of every chain shares one host `resolveInactive` call, which covers only rules in scope; a rule whose agent is deactivated is skipped, and when the host directory fails or has not answered within 5 seconds the dispatch is refused with a `ServiceUnavailableException` naming the `resolveInactive` lookup) |
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
| Objects | `NotificationSummaryObject` (GraphQL `NotificationSummary`: `unreadCount`, `latestUpdatedAt`) |
| Const | `MARK_NOTIFICATIONS_READ_LIMIT` (`500`, the most distinct ids one `markNotificationsRead` call accepts) |
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

**Paging, change detection and batch read (since `v0.17.2`).** For hosts that
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

**Hosts that generate their own migrations.** A host that does not run
`BPM_CORE_MIGRATIONS` and instead lets TypeORM `migration:generate` diff the
entities gets only the column: generate cannot produce the backfill, the
`bpm_notifications_touch_updated_at` function or the `BEFORE UPDATE` trigger.
Without the trigger `updatedAt` never moves after insert, so `changedSince`
and `latestUpdatedAt` silently stop reporting reads, archives and
resolutions — nothing errors. Hand-write that part, following
`NotificationUpdatedAt0000000028000` statement for statement, and check it by
updating a row and reading `updated_at` back.

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
| `BPM_CORE_MIGRATIONS` | Full 33-class migration list |

## `@rytass/bpm-core-nestjs-module/migrations`

32 ordered migrations:

1. `EnablePostgresExtensions0000000000001` — when `uuid-ossp` / `ltree` / `pg_trgm` are
   missing and the migration role has no CREATE privilege on the database, it
   fails with the SQL to run and who must run it, instead of a bare `42501`.
   `down()` is a no-op: the extensions may predate BPM. The `pg_trgm` check was
   released in `v0.17.0`; `WorkflowQueryIndexes0000000013000` still creates `pg_trgm`
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
29. `NotificationUpdatedAt0000000028000` — since `v0.17.2`. Adds `notifications.updated_at` (`timestamptz NOT NULL`, default `date_trunc('milliseconds', clock_timestamp())`), backfilled with each row's latest recorded timestamp (`GREATEST` of created / read / resolved / archived / sent / delivered / last-attempt, truncated to milliseconds); the `BEFORE UPDATE` trigger `TRG_notifications_updated_at` (function `bpm_notifications_touch_updated_at`) that advances it only when a column changed; and `IDX_notifications_recipient_updated_at` on `(recipient_member_id, updated_at)`. The backfill rewrites every notification row once. `down()` drops the index, trigger, function, then the column
30. `ActivityLogSeq0000000029000` — released in v0.17.5. Adds `activity_logs.seq` (`bigint NOT NULL GENERATED ALWAYS AS IDENTITY`), backfilled in write order (`created_at`, then the insert's `cmin`, then `ctid`, then `id`), and the unique index `IDX_activity_logs_instance_seq` on `(instance_id, seq)`. The column is added without `IF NOT EXISTS`, so a database where `seq` already exists fails instead of keeping values numbered without the backfill; drop the column to rerun. The identity and its start value (`COALESCE(MAX(seq), 0) + 1`) are set in one `DO` statement. The backfill rewrites every activity log row once. `down()` drops the index, then the column
31. `DelegationScopeConditionDialect0000000030000` — released in v0.20.0. Adds `delegation_rules.scope_condition_dialect` (`text NOT NULL DEFAULT 'cel-legacy'`, so every existing rule reads as `cel-legacy` without a table rewrite) and the check `CHK_delegation_rules_scope_condition_dialect` (`cel-legacy` or `cel-v2`). No rule is upgraded. `down()` raises an exception while any rule is not `cel-legacy` — dropping the column would silently re-read a cel-v2 condition with the older engine — then drops the check and the column

32. `ApprovalInstanceFormDataGin0000000031000` — released in v0.21.0. Creates `IDX_approval_instances_form_data_gin` (`USING gin ("form_data" jsonb_path_ops)`) for the approval-instance field filters (ADR 25). `CREATE INDEX IF NOT EXISTS` runs inside the migration transaction, so the build takes a SHARE lock on `approval_instances` and blocks writes to instances while it runs; `CONCURRENTLY` is not used, because TypeORM's default transaction mode rejects a non-transactional migration in a batch. A host with a large table should create the index first with `CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_approval_instances_form_data_gin" ON "approval_instances" USING gin ("form_data" jsonb_path_ops);` and this migration then skips it. No table, column or backfill is involved. `down()` drops only the index.
33. `HostIntegrationRound0000000032000` — not yet released (ADR 27). Additive only: `approval_templates.key` (`text NULL`) with the partial unique index `UQ_approval_templates_key_live` (`WHERE key IS NOT NULL AND deleted_at IS NULL`, so a soft-deleted template frees its key), `approval_templates.host_managed` and `form_definitions.host_managed` (`boolean NOT NULL DEFAULT false`), `approval_template_versions.launch_mode` (`text NOT NULL DEFAULT 'OPEN'`, checked to `OPEN` / `HOST_ONLY`), and the `approval_instance_events` outbox table (per-instance `seq`, `status` PENDING / DELIVERED / FAILED, retry columns; cascades with its instance). Every default is the pre-migration behaviour; `down()` drops all of it.

---

# 📦 `@rytass/bpm-core-react`

React UI library. Four export families: root barrel (foundation + host integration widgets), `next` (Next.js wrapper), `views/*` (pure React page bodies — no layout shell), `pages/*` (Next.js Server Component shims).

**Integration model (0.4.0+)**: BPMCore does not ship a navigation shell or sidebar. Hosts own the `<Layout>` / `<Navigation>` chrome and mount BPM views inside their existing layout. The root barrel exports building blocks the host wires into its own nav (`useBPMMember`, `useBPMLogout`, `<BPMNotificationBellButton />`). See `docs/integration-guide.md` and `apps/client/src/app/_components/host-layout.tsx` for a reference host layout.

## `@rytass/bpm-core-react` (root)

### Providers / Hooks

| Name | Kind | Purpose |
|---|---|---|
| `Providers` | Component | Composes Mezzanine `CalendarConfigProviderMoment` + `BPMLanguageProvider` + `AuthProvider` + `NotificationUnreadProvider` + `NotificationDrawerProvider` + mounts `<NotificationDrawer />` overlay. `language?: BPMLanguage` (default `'zh-TW'`, separate from the calendar `locale`; since `v0.17.3`). `organizationTimeZone?: string` (Released in v0.21.1): the IANA zone given to `BPMRootModule` as `organizationTimeZone`, in which BPM views read "today" against membership effective dates; defaults to `DEFAULT_BPM_ORGANIZATION_TIME_ZONE` (`'Asia/Taipei'`), and an unknown zone falls back to it with one console warning |
| `BPMLanguage` | type | `'en' \| 'zh-TW'` — language BPM views write their messages in. |
| `BPMLanguageProvider` | Component | `{ language, children }`; hosts pass the user's choice as state to switch it. |
| `useBPMLanguage()` | hook | Active `BPMLanguage`; `'zh-TW'` when no provider. |
| `BPM_LANGUAGES` / `DEFAULT_BPM_LANGUAGE` | const | Supported languages / `'zh-TW'`. |
| `BPMOrganizationTimeZoneProvider` | Component | Released in v0.21.1: `{ timeZone?, children }`. Resolves the zone as the engine does (trimmed; blank or missing → `DEFAULT_BPM_ORGANIZATION_TIME_ZONE`), except that a zone `Intl` rejects falls back to the default with one `console.warn` per value instead of throwing. Mounted by `Providers` from its `organizationTimeZone` prop. |
| `useBPMOrganizationTimeZone()` | hook | Released in v0.21.1: the resolved organization zone; `'Asia/Taipei'` when no provider. The template designer reads "today" with it. |
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
| `ApprovalInstanceListPage` | Component | Shared list page body (inbox / sent / cc / search). Returns content fragment — host wraps in its own layout. The filter bar has a template picker (`listApprovalTemplates`). With a template chosen, it adds one control per filterable field of that template's current form and offers those fields as sort keys, with `fieldFilters` and `sort` sent to the list query (ADR 25). Without a template, only the time fields can sort. The props are unchanged; the feature is internal to the page |
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
| `BPMNextProviders` | Component | One-line layout wrapper: reads `next/navigation` hooks → builds RouterAdapter → composes Providers inside a Suspense boundary. Forwards `language?: BPMLanguage` (since `v0.17.3`) and `organizationTimeZone?: string` (Released in v0.21.1) |

## `@rytass/bpm-core-react/next/workflow-chat-route`

Server route handler for the template-designer LLM assistant. The host wires it in one line (`apps/client/src/app/api/chat/route.ts` → `export const POST = createWorkflowChatPOST({ authorize: createBPMApiSessionAuthorize() })`). Holds the OpenAI key, runs `streamText`, declares `WORKFLOW_TOOLSET` as tools with **no `execute`** (forwarded to the browser). Talks to OpenAI directly via `@ai-sdk/openai` (no AI Gateway); reads `OPENAI_API_KEY` (server-only) and `BPM_LLM_MODEL` (optional OpenAI model id, default `gpt-5.4-mini`).

| Name | Kind | Purpose |
|---|---|---|
| `createWorkflowChatPOST` | function | Build the Next.js `POST(request)` handler. Phase 23 P4, released in v0.20.0: answers 404 unless `enabled` (default: `BPM_AI_ASSISTANT_ENABLED === 'true'`, read per request), 401 when the optional `authorize(request)` refuses or throws, 413 / 400 for a body over the byte or message limit or not shaped as `{ messages: UIMessage[] }`; drops every client `system` message and caps the output tokens |
| `readWorkflowChatMessages` | function | Phase 23 P4, released in v0.20.0: the request-body check behind the route (size, shape, message count, `system` messages dropped); answers the messages or the `Response` to send |
| `DEFAULT_WORKFLOW_CHAT_MAX_REQUEST_BYTES` / `DEFAULT_WORKFLOW_CHAT_MAX_MESSAGES` / `DEFAULT_WORKFLOW_CHAT_MAX_OUTPUT_TOKENS` | const | Phase 23 P4, released in v0.20.0: 1 MiB, 200 messages, 4 096 tokens |
| `buildWorkflowAiSdkTools` | function | Convert `WORKFLOW_TOOLSET` (JSON Schema) → AI SDK `ToolSet` (no execute) |
| `WORKFLOW_CHAT_SYSTEM_PROMPT` | const | Strict design-only guardrail prompt (zh-TW); Phase 23 P4 adds the expression rules (catalog first, `preview_expression` before any write, `lastDecision` only after a user task, never publish), shared with the offline Chrome model |
| `WorkflowChatRouteOptions` | interface | `{ model?, system? }`, plus (Phase 23 P4, released in v0.20.0) `enabled?`, `authorize?`, `maxRequestBytes?`, `maxMessages?`, `maxOutputTokens?` |
| `createBPMApiSessionAuthorize` | function | Released in v0.20.0: an `authorize` hook for `createWorkflowChatPOST`. Forwards only the request's `Cookie` header to the BPM API session endpoint (default `GET /auth/me`) and lets the caller in on a `200` whose JSON names a non-empty `memberId` (redirects are not followed); no cookie (no request is made), any other status, another body shape, a network error or the timeout refuses (401). `apps/client` wires it: `createWorkflowChatPOST({ authorize: createBPMApiSessionAuthorize() })` |
| `resolveBPMApiSessionBaseUrl` | function | Released in v0.20.0: `resolveBPMApiSessionBaseUrl(apiBaseUrl?)` — the API origin that hook asks, read from configuration only, never from the request (a `Host` or forwarded header must not pick the server that decides who is signed in): `apiBaseUrl` → `BPM_API_INTERNAL_URL` (server-only, e.g. the in-cluster API URL) → `NEXT_PUBLIC_API_AUTH_URL` → origin of `NEXT_PUBLIC_API_URL` → `http://localhost:17603` outside `NODE_ENV=production`. Only absolute http(s) URLs count; a relative setting is ignored. `null` when nothing applies, and the hook then refuses every request (401) |
| `BPMApiSessionAuthorizeOptions` | interface | Released in v0.20.0: `{ apiBaseUrl?, fetch?, sessionPath?, timeoutMs? }` |
| `DEFAULT_BPM_API_SESSION_PATH` / `DEFAULT_BPM_API_SESSION_TIMEOUT_MS` | const | Released in v0.20.0: `'/auth/me'`, 5 000 ms |

> The chat UI itself (`WorkflowChatDrawer`, `useWorkflowChat`, `useWorkflowDesignerController`) is internal to the isolated `views/templates/designer` entry and not separately exported. So are the Phase 23 P4 designer pieces under `views/templates/designer/expression/` (`ExpressionField`, `DialectUpgradeModal`, `createWorkflowExpressionTools`, `useWorkflowExpressionReferences`, the entry-condition / edge-expression edits): `useWorkflowDesignerController` takes an `expressionTools` option, and the designer injects the backend-backed tools so the assistant's expression writes are linted.

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
| `views/instances/detail` | `InstanceDetailView`, `InstanceDetailViewProps` (now toggles each section via `showForm` / `showAttachments` / `showTasks` / `showSignatures` / `showHistory` / `showWebhookDeliveries`; the webhook section is only ever shown to administrators, and only when the instance queued deliveries), plus the standalone section components `InstanceFormSection` (+ `InstanceFormSectionFill`; optional `fieldAccess` / `fieldLabelMarkers` / `fill` / `onReloadAfterConflict` for the approver-fill state, and `resubmitComment` / `onResubmitCommentChange` for the applicant's resubmission comment, whose box shows only when the case can be resubmitted (`canResubmitInstance`) and `onResubmitCommentChange` is given; `InstanceDetailView` keeps one draft, tied to the case it was written for: another case shows an empty box, coming back shows the draft again unless the applicant has typed on another case since, and a successful resubmission of that case clears it), `InstanceAttachmentsSection`, `InstanceTasksSection` (+ `InstanceTasksSectionHandle`, `InstanceTasksSectionFill`, `AdhocActionMode`; props add `fill` / `onFillApproveError` for the approver-fill state (`onFillApproveError(message, formDataIssues)`: the second argument is the refusal's structured `FormDataIssue[]`, `[]` when the error carries none; the container places each issue on its field by path and falls back to the message when one does not resolve), and `onDecidingChange` so a container that renders the decision buttons itself re-enables them when a decision settles; handle adds `canAddSignerCurrentTask` / `openAdhocModal(mode)`, props add `adhocDirectives`), `InstanceSignaturesSection`, `InstanceHistorySection` (optional `formSchema` names the fields an approval filled in; optional `taskDecisions` matches each decision row to its own decision), `InstanceWebhookDeliveriesSection` (status, attempts, last error and a confirmed retry for attempted `FAILED` rows) and their `*Props` | `@xyflow/react`, `dagre`, `react-pdf`, `pdfjs-dist` (attachment preview) |
| `views/instances/new` | `InstanceNewView` | medium |
| `views/templates/compose` | `TemplateComposeWizardView`, `TemplateComposeWizardViewProps` (opt-in `showAiAssistant` / `aiAssistantAvailable` surface the Step 1 embedded-designer AI assistant), `useTemplateComposeWizard`, `TemplateComposeWizard`, `ComposeWizardStep`, `ComposePublishPhase` | embeds designer + builder (`@xyflow/react`, `@codemirror/*`, `dagre`, `@hello-pangea/dnd`, `ai`, `@ai-sdk/react`) |
| `views/templates/designer` | `TemplateDesignerView`, `TemplateDesignerViewProps` (now supports `embedded` / `formSchemaOverride` / `initialWorkflowDefinition` / `initialInitiatorPolicyCel` / `onWorkflowChange` / `onInitiatorPolicyChange` for wizard reuse) | `@xyflow/react`, `@codemirror/*`, `dagre`, `@hello-pangea/dnd`, `ai`, `@ai-sdk/react` (the AI assistant is hidden by default but `WorkflowChatDrawer` is a static import, so both are needed to build) |
| `views/templates/categories` | `TemplateCategoriesView` | normal |
| `views/templates/versions` | `TemplateVersionsView` | normal |
| `views/forms/builder` | `FormBuilderView` — controlled panel (`value` / `onChange`; `templateId` / `formDefinitionId` (ADR 25): with either given, the builder checks the `filterable` fields against existing instances and shows the issues, never blocking a draft; no standalone page mode). Embedded by the template designer and compose wizard; its option-field editor loads the host catalog, filters by capability, edits field/constant bindings, preserves references on field rename, and requires confirmation for source/mode/dependent-field impact before applying changes | `pdfjs-dist`, `@codemirror/*`, `@hello-pangea/dnd` |
| `views/forms/renderer` | `FormRenderer`, `FormRendererView`, `FormRendererProps` (optional `fieldAccess`: per top-level field `{ visible, editable }` from `resolveFieldAccess`; a listed field overrides `readonly`, an unlisted one follows it; optional `fieldLabelMarkers`: per top-level field a marker shown after the label, e.g. 本關補填), `FormRendererDataSourceContext`, `FormDataSourceFieldState` (now carries `canRetry`, false when there is no query to re-issue; `onOpen()` (released in v0.21.3): call when the menu opens — a search-only control (AutoComplete, flat or in a table cell) loads its first page there and does nothing once that page is loaded, while `onReachBottom` keeps one identity for the life of the field and always pages with the latest cursor, so a menu that captured the handler before its first page still loads the next one; `loadingNextPage` (released in v0.21.3): true while the pending query is a next page — the renderer then withholds `loading` from an async AutoComplete, which would otherwise empty its list while paging; optional `selectionExpired` (Phase 23 P5, released in v0.20.0): true when a held value was re-resolved after an `EXPRESSION` binding's inputs changed and the host no longer accounts for it — the status is `INVALID` and `readFormDataSourceFieldStatusMessage()` answers the host's `FORM_DATA_SOURCE_VALUE_NOT_RESOLVED` copy; `FormRendererProps.onDataSourceStateChange` now passes it along with `hasValue` / `invalidValues` / `status`, so a page's submit banner can give the same sentence), `UseFormDataSourceFieldInput` (adds the table-cell inputs `fieldPath`, `snapshotKey` and `row`), `UseFormDataSourceFieldRow`, `useFormDataSourceField()`, `readFormDataSourceFieldStatusMessage()`, `isFormDataSourceFieldSubmissionBlocked()`, `readFormDataSourceSubmissionBlockMessage()` (picks wait-vs-fix copy for a refused submission; a blocked state with `selectionExpired` answers the same `FORM_DATA_SOURCE_VALUE_NOT_RESOLVED` copy as the field, Phase 23 P5, released in v0.20.0), `FormRendererProps.attachments` / `onDownloadAttachment` / `onFileUploadStateChange`, `FormRendererAttachment`, `FileUploadFieldState`, `readFileUploadSubmissionBlockMessage()` (wait-vs-retry copy while a `file_upload` field is uploading or holds a failed upload) | normal |
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

`InstanceAttachmentsSectionProps`, `InstanceFormSectionFill`, `InstanceFormSectionProps`, `InstanceHistorySectionProps`, `InstanceSignaturesSectionProps`, `InstanceTasksSectionFill`, `InstanceTasksSectionProps`, `InstanceWebhookDeliveriesSectionProps`

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
