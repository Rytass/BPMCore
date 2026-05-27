# BPMCore Complete E2E Coverage Matrix

Use this as the baseline for a 100% current-feature e2e plan. The target is
implemented functionality only; do not treat future roadmap items as required
current coverage.

## Coverage Principles

- Every implemented feature needs at least one real API + real DB + browser UI
  path.
- GraphQL request helpers may create setup data, but final user journeys should
  assert UI behavior.
- Mocked Playwright specs are fast smoke coverage only. Full coverage should use
  seeded or real-flow specs.
- Full suite runs should start from a deterministic develop seed unless the user
  asks to preserve current local data.
- For destructive seed reset, ask or confirm unless already explicitly allowed.

## Preconditions

| Area        | Requirement                                                                 |
| ----------- | --------------------------------------------------------------------------- |
| API         | `pnpm api`, default `http://localhost:17603`.                               |
| Client      | `pnpm client`, default `http://localhost:17602`.                            |
| GraphQL     | `http://localhost:17603/graphql`; bare GET may return `400`.                |
| DB          | Vault-backed develop schema from `bpm_core/develop`.                        |
| Seed        | `pnpm demo:reset` creates Taiwan manufacturing org/form/template scenarios. |
| Accounts    | Use DB-backed `api_test_members`, for example `member-001`, `member-502`.   |
| Attachments | Include PDF, PNG/JPEG, invalid MIME, and over-limit files.                  |

## Suite Matrix

| Spec                               | Current Coverage Target                     | Key Assertions                                                                                     |
| ---------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `00-auth-session.e2e.ts`           | Login/logout/session/guards                 | test member list, login cookie, `me`, return-to-original page, logout, unauthenticated redirect.   |
| `01-health-migration-seed.e2e.ts`  | Health, migration, seed completeness        | `/api/health`, migration table, seeded org/forms/templates/instances/tasks/notifications/fixtures. |
| `02-admin-organization.e2e.ts`     | Organization, position, membership, manager | CRUD, draft tree save, path validation, member assignment, manager resolution.                     |
| `03-member-directory.e2e.ts`       | Member directory and resolver cache         | Search, pagination, profile fields, org memberships, cache refresh/miss behavior.                  |
| `04-form-builder.e2e.ts`           | Form definitions and versions               | Create/edit fields, preview, save, publish, archive/rollback, schema lint errors.                  |
| `05-template-categories.e2e.ts`    | Approval template categories                | Create/edit/sort/delete categories, assign to templates, filter list.                              |
| `06-template-designer.e2e.ts`      | Template designer and versioning            | React Flow nodes/edges, condition editing, resolvers, dry run, publish validation, versions.       |
| `07-launch-center.e2e.ts`          | Launch entry routes                         | Dashboard/inbox/templates shortcuts, launchable filtering, no-template state.                      |
| `08-linear-workflow.e2e.ts`        | Linear approval execution                   | Submit, task open, approve, complete; reject reason required; non-assignee cannot decide.          |
| `09-return-cancel-resubmit.e2e.ts` | Return, cancel, resubmit                    | Previous/initiator/specific return, draft warning, cancel, restart/from-return-point resubmit.     |
| `10-branching-parallel.e2e.ts`     | Branching and joins                         | CEL edge routing, default flow, multi-outgoing fork, AND/OR joins, sibling cancellation.           |
| `11-org-resolver-real.e2e.ts`      | Real organization approver resolution       | Direct, position, org member, org position, manager levels, fallback behavior.                     |
| `12-candidate-approvers.e2e.ts`    | Candidate group tasks                       | Candidate visibility, claim/decide, other candidates update, inbox/detail UI.                      |
| `13-delegation-transfer.e2e.ts`    | Delegation and manual transfer              | Admin/self delegation, revoke, delegation chain, cycle prevention, transfer audit trail.           |
| `14-workspace-lists.e2e.ts`        | Dashboard, sent, CC, search, pagination     | Real seeded counts, page info, filters, search, readable permissions, DB-backed totals.            |
| `15-notification-sla.e2e.ts`       | Notification center and SLA                 | Read/unread, bell count, preferences, due countdown, warning/overdue rows.                         |
| `16-delivery-worker.e2e.ts`        | Email/webhook notification delivery         | SMTP disabled/enabled paths, signed webhook, host dispatcher, retry, failed terminal state.        |
| `17-service-tasks.e2e.ts`          | Workflow service tasks                      | `NOTIFY`, `WEBHOOK`, `SET_FORM_FIELD`, host workflow dispatcher, activity logs, payload shape.     |
| `18-attachment-signature.e2e.ts`   | Attachments, previews, signatures           | Upload, signed preview/download, unauthorized access denied, decision signature chain verify.      |
| `19-instance-detail-audit.e2e.ts`  | Instance detail consistency                 | Snapshot, graph status, tokens, tasks, candidates, decisions, activities, attachments, signatures. |
| `20-embedding-contract.e2e.ts`     | `BPMRootModule` wrapper app contracts       | Member resolver, auth context, attachment storage, notification dispatcher, workflow dispatcher.   |
| `21-security-readability.e2e.ts`   | Authorization and readable scope            | Initiator/assignee/candidate/decider/CC/admin allowed; unrelated member hidden/403/404.            |
| `22-performance-query.e2e.ts`      | Query/index and scale behavior              | Page info avoids full entity list, `EXPLAIN` key indexes, large-list search/pagination budget.     |
| `23-responsive-browser.e2e.ts`     | Responsive browser usability                | Desktop/mobile layout, no text overlap, tables/drawers/React Flow interactions.                    |

## Existing Specs To Reuse

| Existing Spec                          | Reuse Strategy                                                   |
| -------------------------------------- | ---------------------------------------------------------------- |
| `admin-orgs.spec.ts`                   | Expand for full org CRUD, manager resolution, member directory.  |
| `form-builder-w2.spec.ts`              | Expand for all field types, archive/rollback, lint negatives.    |
| `template-categories.spec.ts`          | Expand for sorting/deletion constraints and template filtering.  |
| `template-designer-w3.spec.ts`         | Expand for full service task and validation coverage.            |
| `workflow-launch-entry.spec.ts`        | Keep as launch smoke; add seed-backed route checks.              |
| `workflow-linear-w5.spec.ts`           | Expand for reject/cancel/permissions and signature assertions.   |
| `workflow-branching-w6.spec.ts`        | Expand for AND/OR joins and runtime token assertions.            |
| `workflow-org-resolution-real.spec.ts` | Keep as core resolver exhaustive path; split if runtime is slow. |
| `workflow-candidate-approvers.spec.ts` | Expand candidate status and concurrent visibility cases.         |
| `delegation-transfer-w8.spec.ts`       | Expand self-service delegation and chain/cycle cases.            |
| `notification-sla-w9.spec.ts`          | Expand worker delivery and SLA timeout actions.                  |
| `workspace-routes-seeded.spec.ts`      | Keep as seeded workspace smoke; expand filters/page info.        |

## GraphQL Surface Checklist

Cover these through UI journeys plus direct GraphQL assertions where helpful:

- Organization: org units, positions, memberships, manager resolutions,
  summary, resolved manager, all create/update/delete mutations.
- Identity: member profile, profiles, cache, search, counts.
- Form: definitions, versions, lint, create/update/fork/publish/archive/rollback.
- Template: templates, categories, versions, create/update/publish/archive/rollback.
- Workflow engine: instances, count, pageInfo, dashboard summary, instance
  detail, tokens, tasks, inbox/history, launchable templates, decisions,
  candidates, activities, submit/process/decide/cancel/resubmit/dry run.
- Delegation: list/count/create/update/revoke.
- Notification: list/count/unread/preference/read/update preference.
- Attachment: upload, list, signed download URL, signed preview URL.
- Signature: list and verify.

## Negative Coverage

- Auth required for every protected route and GraphQL operation.
- Non-assignee cannot approve/reject/return/transfer.
- Unrelated member cannot read hidden instance, attachment URL, tasks, or
  signature details.
- Draft/unpublished templates cannot be launched.
- Invalid workflow structure cannot publish.
- Invalid form schema cannot publish.
- Invalid attachment MIME/size is rejected.
- Webhook/email disabled configuration records expected failure without crashing
  workflow execution.

## Suggested Execution Order

1. Environment, migration, seed, auth.
2. Admin data setup: org/member/form/template/category.
3. Workflow runtime: launch, linear, branching, return/cancel/resubmit.
4. Human workflow: candidate, delegation, transfer.
5. Notification/SLA/delivery/service tasks.
6. Attachment/signature/audit detail.
7. Security/readability/performance/responsive.

## Completion Criteria

- Every implemented app route has at least one browser assertion.
- Every GraphQL Query/Mutation has at least one e2e-backed exercise path.
- Every workflow runtime branch has success and negative/permission coverage.
- Full suite can run from a fresh `pnpm demo:reset` state.
- Failures retain Playwright trace, screenshot, and enough seeded IDs to debug.
