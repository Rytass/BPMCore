# BPMCore Audit Remediation Plan

Date: 2026-05-16

This plan tracks the repository-wide audit findings and the required repair
order. ContentHeader is intentionally excluded because the project rule was
corrected in `AGENTS.md` and ContentHeader remains valid for this project.

## Completion Rules

- Every batch must include focused unit, integration, or component tests for the
  changed behavior.
- Every batch that changes runtime behavior must finish with `pnpm e2e:client`
  after the local API and client are available.
- If an e2e case needs new browser coverage, add or update a Playwright spec
  instead of relying only on manual checks.
- A batch is not complete until its listed verification commands pass.
- Do not commit or push unless explicitly instructed.
- Keep fixes scoped. Do not combine package-boundary changes with workflow
  runtime changes unless one directly blocks the other.

## Completion Status

All remediation batches below were implemented on 2026-05-16. Verification
evidence:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm nx test bpm-core --runInBand`
- `pnpm nx test client --runInBand`
- `pnpm nx build bpm-core --skip-nx-cache`
- `pnpm playwright test -c apps/client-e2e/playwright.config.ts apps/client-e2e/specs/workflow-linear-w5.spec.ts`
- `pnpm playwright test -c apps/client-e2e/playwright.config.ts apps/client-e2e/specs/workflow-org-resolution-real.spec.ts`
- `pnpm e2e:client`

## Batch 1 - Embedding Auth And Host Provider Contract (Completed)

Goal: make `BPMRootModule` reliable for real external NestJS hosts.

Fixes:

- Make `BPMRootModule.forRoot()` support `imports`, so `useExisting` host
  providers can be resolved without forcing host modules to become global.
- Pass host imports through child dynamic modules that receive host providers.
- Make `@BPMCurrentAuthContext()` and `@BPMCurrentMemberId()` resolve through
  the same injectable `BPMAuthContextAccessor` path used by
  `BPMAuthenticatedGuard`.
- Add a regression test where GraphQL context does not contain
  `bpmAuthContext`, but `authContextFactory` returns a member. The guard and
  decorators must both resolve the same member.
- Recheck all resolvers that accept current-member decorators so required IDs
  are not nullable at runtime.

Validation:

- `pnpm nx test bpm-core --runInBand`
- `pnpm typecheck`
- `pnpm e2e:client`

## Batch 2 - Package Surface, Dependencies, And Migration Contract (Completed)

Goal: make the npm package practical for external NestJS applications.

Fixes:

- Align `package.json` exports, `src/index.ts`, `tsconfig.base.json`, and README
  public import guidance.
- Decide root-only vs stable subpath imports. If subpaths remain, document them
  as stable and include every exported domain path consistently.
- Move NestJS, TypeORM, GraphQL, and `reflect-metadata` framework packages to
  `peerDependencies`, with compatible repo `devDependencies` for local builds.
- Split database helpers into a pure data-source option builder plus Vault
  adapter helpers.
- Make `buildTypeOrmModuleOptions()` and README agree about whether migrations
  are included for runtime and migration flows.
- Export a stable `BPM_CORE_MIGRATIONS` list that works from the compiled
  package.
- Decide how extension migrations should behave for DB users that cannot
  `CREATE EXTENSION`.
- Make migration SQL schema behavior explicit for multi-schema hosts.

Validation:

- `pnpm nx build bpm-core --skip-nx-cache`
- Inspect `dist/libs/bpm-core/package.json`
- `pnpm typecheck`
- `pnpm e2e:client`

## Batch 3 - Scheduler, Delivery, And Worker Safety (Completed)

Goal: prevent duplicate background work in real multi-replica deployments.

Fixes:

- Add DB claim/lock behavior for pending email/webhook delivery.
- Add DB claim/lock behavior for SLA scans and timeout actions.
- Add uniqueness or idempotency protection for SLA warning/overdue
  notifications.
- Decide whether embedded API processes should run schedulers by default. If
  not, default them off and provide an explicit worker module or option.
- Extract notification delivery behind a host-replaceable provider, so hosts can
  use existing mail service, queue, tenant router, or event bus.
- Keep built-in SMTP and signed webhook delivery as default adapters, not the
  only implementation path.

Validation:

- Unit tests for concurrent delivery scans.
- Unit tests for concurrent SLA scans and timeout actions.
- `pnpm nx test bpm-core --runInBand`
- `pnpm e2e:client`

## Batch 4 - Workflow Read And Process Authorization (Completed)

Goal: stop exposing workflow runtime data and system operations to every logged
in member.

Fixes:

- Replace unscoped workflow read resolvers with current-member scoped service
  methods.
- Define readable instance rules: initiator, active or past assignee, task
  candidate, delegated actor, or admin permission/role.
- Scope `approvalInstances`, `approvalInstance`, `workflowTokens`, `tasks`,
  `taskDecisions`, `taskCandidates`, and `activityLogs` consistently.
- Move `processApprovalInstance` out of public user-facing GraphQL, or restrict
  it to a system/admin permission and process normal submit/decision flows
  internally.
- Replace client all-instance filtering with scoped summary/query APIs.
- Keep explicit admin/reporting access separate from normal user workflow reads.

Validation:

- API tests for readable and unreadable members.
- API tests proving non-admin users cannot call system process operations.
- Playwright coverage for requester, approver, and unrelated member access to
  instance detail.
- `pnpm nx test bpm-core --runInBand`
- `pnpm e2e:client`

## Batch 5 - Form And Admin Authorization (Completed)

Goal: make design/admin APIs match the role and permission model.

Fixes:

- Protect form definition create/update/fork/publish/rollback with admin or
  designer permissions.
- Define minimal BPM admin/designer permissions for organization, member
  directory, form, template, template category, and delegation administration.
- Hide admin navigation entries for non-admin users.
- Add backend authorization checks on admin mutations and admin-only queries,
  not only UI gating.
- Add clear forbidden states when a user opens an admin URL directly.
- Remove or deprecate public GraphQL arguments that ask for a member id but are
  ignored in favor of current auth context.

Validation:

- API tests for admin/designer and non-admin access to admin/design resolvers.
- Playwright e2e for admin seeing admin navigation and requester not seeing it.
- Playwright direct URL check for non-admin admin page access.
- `pnpm nx test bpm-core --runInBand`
- `pnpm e2e:client`

## Batch 6 - Form Submission Validation And Requester Flow (Completed)

Goal: prevent invalid approval instances and make submit errors actionable.

Fixes:

- Keep backend validation for submitted and resubmitted `formData` against the
  stored form schema and conditional required rules.
- Add frontend validation to `FormRenderer` or page-level submit paths.
- Block `/instances/new` submit when required fields are missing.
- Block `/instances/[id]` resubmit when required fields are missing.
- Ensure attachment fields validate required file presence.
- Surface field-level or clear form-level errors and focus the first invalid
  field.

Validation:

- Unit tests for required, conditional required, hidden optional, and file upload
  fields.
- Playwright e2e for missing required fields and successful submit after fixing
  them.
- `pnpm nx test bpm-core --runInBand`
- `pnpm e2e:client`

## Batch 7 - Workflow Runtime Correctness (Completed)

Goal: keep legal templates from producing stuck or inconsistent instances.

Fixes:

- Decide runtime semantics for `NOTIFY` service tasks: terminal notification
  node, or normal service task with outgoing edges.
- Align validator and runtime so legal templates cannot create a dead-running
  instance.
- Create actual notification records for configured recipients.
- If terminal, finalize the instance when no active/waiting token remains.
- If non-terminal, allow outgoing edges and advance tokens after notification
  creation.
- Update SLA warning/overdue notification creation so candidate-group tasks
  notify all pending or claimed candidates.
- Define timeout actions for candidate groups: `REMIND`, `AUTO_APPROVE`,
  `ESCALATE`, and `TERMINATE_INSTANCE`.
- When cancel, return, reject, resubmit, or OR-join sibling cancellation closes
  tasks, close related `task_candidates` rows too.
- Add candidate status transitions for cancelled and superseded task states.

Validation:

- Unit tests for terminal notify and notify-with-next-node behavior.
- Unit tests for candidate-group SLA warning/overdue and timeout actions.
- Unit tests for candidate cleanup after cancel, return, and OR-join alternative
  cancellation.
- Playwright e2e using a template that reaches a notify service task and does
  not remain stuck in `RUNNING`.
- Playwright e2e for candidate task SLA display and action after candidate
  closure.
- `pnpm nx test bpm-core --runInBand`
- `pnpm e2e:client`

## Batch 8 - Attachment Access And Host Routing (Completed)

Goal: make attachments usable for real approvers and external host routes.

Fixes:

- Allow current/past direct assignees, candidate-group members, delegated actors,
  uploader, and initiator to read form-level instance attachments when they can
  read the instance.
- Remove ignored `uploaderMemberId` from upload GraphQL input, or keep it
  nullable/deprecated only for schema compatibility.
- Remove ignored `requestedByMemberId` arguments from attachment URL queries, or
  keep them nullable/deprecated only for schema compatibility.
- Make signed URL path configurable through root options, such as route prefix
  or a host-provided URL builder.
- Add `attachmentStorageProviderId` or equivalent metadata so custom storage is
  not recorded as `local`.

Validation:

- Unit tests for attachment readability by initiator, uploader, direct assignee,
  candidate, delegate, and unrelated member.
- Unit tests for custom storage provider id and custom signed URL path.
- Playwright e2e for approver preview/download of applicant-uploaded PDF.
- `pnpm nx test bpm-core --runInBand`
- `pnpm e2e:client`

## Batch 9 - Frontend Safety And UX Flow (Completed)

Goal: make high-cost and destructive journeys harder to break by accident.

Fixes:

- Harden login `next` redirect so protocol-relative URLs, absolute external
  URLs, and backslash variants are rejected.
- Add confirm modal for cancelling an approval instance.
- Require or at least allow a cancel reason and persist it in the activity log.
- Add dirty guard for form builder and template designer navigation/back/refresh
  when unsaved changes exist.
- Show candidate approvers by member display name and email, not raw member ids.
- Update candidate e2e expectations to assert readable labels.
- Add notification preference saving state, failure rollback, and serialized
  updates.
- Keep notification center and navigation unread badge in sync after marking a
  notification read.

Validation:

- Component or unit tests for redirect sanitization, notification preference
  rollback, and form validation helpers.
- Playwright e2e for cancel confirmation.
- Playwright e2e for dirty guard.
- Playwright e2e for notification badge update.
- `pnpm typecheck`
- `pnpm e2e:client`

## Batch 10 - Real Golden Path E2E (Completed)

Goal: prove the complete user journey against the real API and DB, not only
GraphQL route mocks.

Fixes:

- Keep existing GraphQL mock specs as fast UI regression coverage.
- Add at least one seeded DB golden path:
  login as admin, create or use a form, create or use a template, publish,
  launch instance, approve or return, transfer or delegate where applicable,
  receive notification, upload/preview attachment, and verify signature/activity
  records through GraphQL.
- Document which test data can be dirty and which must be reset by the
  wrapper-app commands `pnpm demo:reset` or `pnpm staging:reset`.

Validation:

- `pnpm demo:reset`
- `pnpm staging:reset`
- New real-flow Playwright spec
- `pnpm e2e:client`

## Batch 11 - Documentation Reconciliation (Completed)

Goal: make docs match the corrected runtime and package behavior.

Fixes:

- Update root README and package README after auth, attachment, migration,
  scheduler, exports, and peer dependency changes.
- Update `docs/06-data-model.md` for `approval_template_categories`,
  `task_candidates`, `tasks.assignment_type`, notification `title`/`body`, and
  notification delivery state columns.
- Update migration order docs to match `BPM_CORE_MIGRATIONS`, or point to the
  exported list as the source of truth.
- Update `docs/02-domain-model.md` to describe PostgreSQL-backed member metadata
  cache.
- Mark `/sent`, `/cc`, `/search`, `/dashboard`, and reporting as planned until
  implemented.
- Update `docs/10-bpm-embedding-auth.md` with the final embedding contract,
  worker/scheduler guidance, route-prefix guidance, and migration consumption
  path.
- Add user-facing docs for requester, approver, admin, and IT designer flows
  after runtime fixes land.

Validation:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm e2e:client` after doc-linked behavior changes are implemented.

## Suggested Execution Order

1. Batch 1, because every protected resolver depends on correct current-member
   resolution and host provider wiring.
2. Batch 2, because package shape and migration behavior define how external
   projects consume the module.
3. Batch 3, because duplicate background work is the largest production
   integration risk.
4. Batch 4 and Batch 5, because they define read, process, and admin
   authorization boundaries.
5. Batch 6, because it prevents invalid instances before deeper runtime fixes.
6. Batch 7 and Batch 8, because they fix workflow and attachment behavior using
   the finalized authorization rules.
7. Batch 9, because it improves high-risk user journeys.
8. Batch 10, because it proves the complete real journey.
9. Batch 11, after code behavior is stable.

---

# Form Builder 表格欄位介面易用性（2026-08-25）

以 `lin.ceo` 在 `/templates/compose` 實際建一張含表格欄位的表單，逐步記錄卡點。
分批處理，**已完成**的兩項是真缺陷，其餘為提案。

## 已完成

1. **型別選單點不到最後兩個型別**（`b596640`）。Mezzanine `Dropdown` 的 Popper
   middleware 只有 offset／zIndex／width，**沒有 flip 或 shift**，選單永遠向下且
   不避開視窗邊緣；表格是頁面最後一個欄位時，選單被裁掉且頁面已無可捲空間，
   「下拉選單」與「自動完成」在 1440×757 完全無法選取。修法：`menuMaxHeight`
   讓選單自身可捲 ＋ 設定欄底部保留可捲空間。不覆寫元件樣式。
2. **DataSource 訊息講機器語言**（`b9d703a`）。原本回
   `schema.fields[0].columns[1].dataSource.bindings missing required parameter:
   plant`，旁邊的面板卻叫「廠別」。改為「「請購明細」表格的「成本中心」欄尚未
   指定必要參數「廠別」的來源」；binding 提示與「沒有相容欄位」也改用標籤與人話。

3. **改完欄型別後面板停在別欄**（`2a511e2`）。新型別帶來的選項／數值範圍／來源
   設定就藏在使用者看不到的地方；改為確認變更後自動選取該欄。

4. **版面重做：欄設定就地展開**（`a697705`、`7450458`）。原本「表格層設定／欄清單／
   被選欄的設定」是三個同層平鋪的兄弟，沒有任何訊號說在設定哪一欄。改用 Mezzanine
   `Table` 原生的 `expandable`（可控 `expandedRowKeys` ＋ `expandedRowRender`），
   欄設定直接展開在該列底下，「在設定哪一欄」變成不需要回答的問題。同時：欄清單
   脫離 `BPMFormField`（其 `.mzn-form-field__data-entry` 的 640px 上限就是清單只佔
   面板三分之一的原因）改為 `fullWidth`；欄序改 標題 → 型別 → 必填，`欄位 Key`
   移進展開區；欄位設定 grid 從 `auto-fit` 六欄收斂為兩欄上限；必填 toggle 去掉與
   表頭重複的文字。draggable 與 expandable 實測可共存。

## 待辦（依痛感排序）

**A. 提示與回饋**

- 剛改成下拉選單／自動完成的欄沒有「尚未設定選項」提示，要到發布才被擋。
- 預覽頁對未完成設定顯示 runtime 語氣的「選項查詢條件不正確，請重新確認表單
  內容。」，設計期應說明是哪個參數還沒指定來源。
- 畫布卡片只寫「表格 · 選填 · table_1」，不顯示欄數與欄名。
- 變更型別的確認 Modal：新欄沒有可丟棄的設定時也跳，且不說哪一欄、從什麼型別
  變成什麼型別；文案「確認後才會寫入 schema」是工程語言。
- DataSource 說明行直接印 `policy：WHEN_VALUE_OR_BINDINGS_CHANGE`。
- 表格內沒有長文字／單選／複選／附件，工具列上卻有，沒有任何說明（ADR 16 §3.10
  的排除項）。

**B. 結構**

- 欄清單再加一個「狀態」欄：選項未設定／參數未綁定 → 警示 chip（欄序與 `欄位 Key`
  的降級已在第 4 項完成）。
- 標題輸入時自動產生 key（可覆寫）：現在打完中文標題，key 永遠是 `text_1`。

**C. 教學性**

- 第一次新增表格欄位時說明可用型別、為什麼不能巢狀、最少／最多列數的意思。
