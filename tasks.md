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
