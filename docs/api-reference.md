# BPMCore Public API Reference

Canonical inventory of every export from every published BPMCore package. **This file is the contract.** Any change to a `libs/*/src/**` export — adding, removing, renaming, or changing the visibility of a symbol — must update this file in the same commit.

Last verified against: `libs/shared@0.1.2`, `libs/bpm-core-client@0.1.2`, `libs/bpm-core@0.1.2` (`@rytass/bpm-core-nestjs-module`), `libs/bpm-core-react@0.2.0`.

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
| `SelectFieldDefinition` | type | single / multi select |
| `FormFieldOption` | interface | Option in a select field |
| `BooleanFieldDefinition` | type | Boolean toggle |
| `FileUploadFieldDefinition` | type | Attachment upload |
| `FormUiSchema` | interface | Layout description for renderer |
| `FormLayoutItem` | interface | One cell in the layout grid |

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
| `DecisionPolicy` | type | ANY / MAJORITY / ALL |
| `ReturnBehavior` | interface | Return-handling settings |
| `ReturnResubmitStrategy` | type | `'FROM_RETURN_POINT' \| 'RESTART'` |
| `SlaConfig` | interface | SLA timer config |
| `FieldPermission` | interface | Per-node read/write permission |
| `NotificationOverride` | interface | Node-level notification overrides |
| `NotificationChannel` | type | `'IN_APP' \| 'EMAIL' \| 'WEBHOOK'` |
| `ServiceAction` | type | Action runnable by a serviceTask |
| `GatewayDirection` | type | `'split' \| 'join'` |
| `WorkflowEdge` / `WorkflowEdgeData` | interface | Edge with optional condition |
| `WorkflowEdgeConditionOperator` | type | Edge condition operators |

---

# 📦 `@rytass/bpm-core-client`

Cross-platform typed GraphQL/REST client. All functions ultimately use `fetch`.

## `@rytass/bpm-core-client` (root)

### Transport / Endpoint

| Name | Kind | Purpose |
|---|---|---|
| `requestGraphQl<T>(query, variables?)` | async function | Generic GraphQL POST, returns typed data |
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
| Queries | `listFormDefinitions()`, `listFormDefinitionsPage()`, `readFormBuilder()`, `lintFormSchema()` |
| Mutations | `createFormDefinition(name)`, `updateFormDefinition()`, `updateFormDefinitionDraft()`, `publishFormDefinitionVersion()`, `forkFormDefinition()` |
| Factory | `createFieldDefinition()` |

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
| Records | `ApprovalTemplateRecord`, `ApprovalTemplateCategoryRecord`, `ApprovalTemplateVersionRecord`, `FormDefinitionRecord`, `FormDefinitionVersionRecord`, `PublishedFormVersionOption`, `MemberProfileRecord`, `WorkflowDryRunStepRecord`, `WorkflowDryRunResultRecord`, `TemplateDesignerRecord`, `ApprovalTemplatesPage`, `ApprovalTemplateCategoriesPage` |
| Types | `ApprovalTemplateListStatus`, `ApprovalTemplateCategoryStatus` |
| Queries | `listApprovalTemplates()`, `listApprovalTemplatesPage()`, `listApprovalTemplateCategoriesPage()`, `readTemplateDesigner()`, `searchPublishedFormVersionOptions()`, `resolveMemberOptions()`, `searchMemberOptions()` |
| Mutations | `createApprovalTemplate()`, `createApprovalTemplateCategory()`, `updateApprovalTemplateCategory()`, `deleteApprovalTemplateCategory()`, `updateApprovalTemplateDraft()`, `forkApprovalTemplate()`, `publishApprovalTemplateVersion()`, `rollbackApprovalTemplateVersion()` |
| Dry-run | `dryRunApprovalWorkflow()` |

## `@rytass/bpm-core-client/workflow`

### Types / Records

| Group | Names |
|---|---|
| Instance | `ApprovalInstanceState`, `ApprovalInstanceRecord`, `ApprovalInstanceView`, `ApprovalInstancesPageInput / Result`, `ApprovalInstancePageInfoRecord`, `LaunchContext`, `LaunchableTemplateRecord` |
| Task | `TaskStatus`, `TaskAssignmentType`, `TaskDecisionAction`, `TaskRecord`, `TaskCandidateRecord`, `TaskDecisionRecord`, `WorkflowTokenRecord` |
| Form snapshot | `FormDefinitionSnapshot`, `WorkflowFormData` |
| Activity | `ActivityLogRecord` |
| Member | `MemberProfileRecord`, `MemberDirectoryPage` |
| Delegation | `DelegationScopeType`, `DelegationRuleStatus`, `DelegationRuleRecord` |
| Notification | `NotificationChannel`, `NotificationDigestMode`, `NotificationStatus`, `NotificationType`, `NotificationRecord`, `NotificationPreferenceRecord` |
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

### Mutations

| Name | Purpose |
|---|---|
| `submitApprovalInstance({ ... })` | Launch a new instance |
| `decideTask({ ... })` | Decide a task (APPROVE / REJECT / RETURN) |
| `cancelApprovalInstance({ ... })` | Cancel an instance |
| `resubmitApprovalInstance({ ... })` | Re-submit after return |
| `uploadAttachment({ ... })` | Multipart upload |

### Member helpers (in workflow subpath)

`resolveMemberProfiles(ids)`, `searchMembers(query)`, `listMemberDirectoryPage({ ... })`.

### Delegation

`listDelegationRules({ ... })`, `listDelegationRulesPage({ ... })`, `createDelegationRule({ ... })`, `revokeDelegationRule({ ... })`.

### Notification

`listNotifications({ ... })`, `readUnreadNotificationCount(memberId)`, `markNotificationRead({ ... })`, `markAllNotificationsRead({ ... })`, `readNotificationPreference(memberId)`, `updateNotificationPreference({ ... })`.

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
| `buildTypeOrmModuleOptions(config)` | function | Build TypeORM options including migrations |
| `BPM_CORE_MIGRATIONS` | const | 14-class migration array |
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
| `BPM_MEMBER_RESOLVER` | injection token | Host MUST provide a resolver |
| `MemberResolver` | interface | Resolver contract |
| `IdentityOptions` | interface | Identity module options |
| `MemberBaseAdapter` | class | Default adapter reading from `BPMAuthContext` |

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

## `@rytass/bpm-core-nestjs-module/template`

| Category | Names |
|---|---|
| Entities | `ApprovalTemplateEntity`, `ApprovalTemplateVersionEntity`, `ApprovalTemplateCategoryEntity` |
| DTOs | `ApprovalTemplateInput` |
| Validators | `WorkflowDefinitionValidator` |
| Enums | `TemplateEnums` |
| Service | `TemplateService` |
| Module | `TemplateModule` |

## `@rytass/bpm-core-nestjs-module/workflow-engine`

Workflow execution engine — the heaviest module.

| Category | Names |
|---|---|
| Entities | `ApprovalInstanceEntity`, `TaskEntity`, `TaskDecisionEntity`, `TaskCandidateEntity`, `WorkflowTokenEntity`, `ActivityLogEntity` |
| DTOs | `SubmitApprovalInstanceInput`, `DecideTaskInput`, `CancelApprovalInstanceInput`, `ResubmitApprovalInstanceInput`, `DryRunApprovalWorkflowInput` |
| Objects | `ApprovalInstancePageInfo`, `WorkflowDryRunResult`, `WorkflowDashboardSummary` |
| Engine | `WorkflowEngineService`, `WorkflowConditionEvaluator` |
| Tokens | `WorkflowEngineTokens`, `WORKFLOW_SERVICE_TASK_DISPATCHER` |
| Enums | `WorkflowEngineEnums` |
| Module | `WorkflowEngineModule` |

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

## `@rytass/bpm-core-nestjs-module/notification`

| Category | Names |
|---|---|
| Services | `NotificationService`, `NotificationDeliveryService` |
| Token | `NOTIFICATION_DISPATCHER` (host injects email/webhook adapter) |
| Options | `NotificationOptions`, `NotificationOptionsModule` |
| Enums | `NotificationEnums` |
| Module | `NotificationModule` |

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
| `BPM_CORE_MIGRATIONS` | Full 14-class migration list |

## `@rytass/bpm-core-nestjs-module/migrations`

14 ordered migrations:

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

---

# 📦 `@rytass/bpm-core-react`

React UI library. Four export families: root barrel (foundation), `next` (Next.js wrapper), `views/*` (pure React), `pages/*` (Next.js Server Component shims).

## `@rytass/bpm-core-react` (root)

### Providers / Hooks

| Name | Kind | Purpose |
|---|---|---|
| `Providers` | Component | Composes Mezzanine `CalendarConfigProviderMoment` + `AuthProvider` + `NotificationUnreadProvider` + `NotificationDrawerProvider` |
| `AuthProvider` | Component | Wraps current-member context, handles login/logout |
| `AuthProviderProps` | interface | `publicPaths`, `loginPath`, etc. |
| `useAuth()` | hook | Current member + login/logout methods |
| `RouterAdapter` | interface | Framework-agnostic router contract (pathname / push / replace / back / searchParams) |
| `RouterAdapterProvider` | Component | Inject host's RouterAdapter |
| `RouterAdapterProviderProps` | interface | Provider props |
| `useRouterAdapter()` | hook | Read current adapter |
| `defaultBrowserSearchParams()` | function | Fallback reader from `window.location.search` |
| `NotificationDrawerProvider` | Component | Drawer open/close context |
| `useNotificationDrawer()` | hook | Drawer state + open/close handlers |
| `NotificationUnreadProvider` | Component | Polls unread notification count |
| `useNotificationUnread()` | hook | Unread count + refresh trigger |
| `formatDateTime(value)` | function | moment-based `YYYY-MM-DD HH:mm:ss` formatter |

### Reusable Components

| Name | Kind | Purpose |
|---|---|---|
| `AppNavigation` | Component | Four-group sidebar + notification bell |
| `AppNavigationProps` | interface | `{ activeHref }` |
| `NotificationDrawer` | Component | Mezzanine Drawer + NotificationCenter |
| `ApprovalInstanceListPage` | Component | Shared list page (inbox / sent / cc / search) |
| `ApprovalInstanceListPageProps` | interface | view / state / title / description / etc. |
| `DashboardPage` | Component | Five-metric workflow dashboard |
| `DashboardPageProps` | interface | `{ activeHref }` |
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

## Views (pure React, require a RouterAdapter)

### Group barrels (preferred for most consumers)

| Subpath | Includes |
|---|---|
| `views/workflow` | `InboxView`, `SentView`, `CcView`, `SearchView` |
| `views/instances` | `InstanceNewView` (detail stays isolated due to weight) |
| `views/templates` | `TemplatesView`, `TemplateCategoriesView`, `TemplateVersionsView` (designer isolated) |
| `views/forms` | `FormsView`, `FormRenderer` / `FormRendererView` (builder isolated) |
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

| Subpath | View | Heavy peerDeps |
|---|---|---|
| `views/instances/detail` | `InstanceDetailView` | `@xyflow/react`, `dagre` |
| `views/instances/new` | `InstanceNewView` | medium |
| `views/templates/designer` | `TemplateDesignerView` | `@xyflow/react`, `@codemirror/*`, `dagre`, `@hello-pangea/dnd` |
| `views/templates/categories` | `TemplateCategoriesView` | normal |
| `views/templates/versions` | `TemplateVersionsView` | normal |
| `views/forms/builder` | `FormBuilderView` | `pdfjs-dist`, `@codemirror/*`, `@hello-pangea/dnd` |
| `views/forms/renderer` | `FormRendererView` (alias of `FormRenderer`) | normal |
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
| `pages/templates/designer` | `/templates/[id]/designer` | Yes | `params.id` → `templateId` |
| `pages/templates/versions` | `/templates/[id]/versions` | Yes | `params.id` → `templateId` |
| `pages/forms` | `/forms` | No | — |
| `pages/forms/builder` | `/forms/[id]/builder` | Yes | `params.id` → `formId` |
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
