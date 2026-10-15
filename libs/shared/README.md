# @rytass/bpm-core-shared

Shared TypeScript contracts for BPMCore clients and host-side tests.

This package does not contain runtime services. It publishes serializable data
contracts used by `apps/client`, `libs/bpm-core`, and external consumers that
need to build compatible workflow/form payloads.

## Public Imports

The package root exports every shared contract currently used by BPMCore:

```ts
import type { WorkflowDefinition, FormDefinitionSchema, MemberMetadata, OrgUnit, ApprovalInstanceState } from '@rytass/bpm-core-shared';
```

Subpaths declared in `package.json` `exports` are available for narrower imports:

```ts
import type { ConditionContextType } from '@rytass/bpm-core-shared/condition';
import type { FormDefinitionSchema } from '@rytass/bpm-core-shared/form';
import type { ApprovalInstanceState } from '@rytass/bpm-core-shared/status';
import type { WorkflowDefinition } from '@rytass/bpm-core-shared/workflow';
```

The subpaths are `condition`, `form`, `status`, `workflow`, `workflow-graph`,
`workflow-command`, and `workflow-toolset`. There is no `identity` or
`organization` subpath; import those contracts from the package root.

## Contract Areas

| Area          | Source module        | Notes                                                                                                           |
| ------------- | -------------------- | --------------------------------------------------------------------------------------------------------------- |
| Workflow JSON | `./lib/workflow`     | React Flow-aligned workflow nodes, edges, resolvers, actions.                                                   |
| Form schema   | `./lib/form`         | Form builder schema (`FormDefinitionSchema`), UI schema, validation rules.                                      |
| Conditions    | `./lib/condition`    | CEL lint/evaluation result shapes and the expression context shapes (`InstanceContext`, `LastDecisionContext`). |
| Identity      | `./lib/identity`     | Member metadata shape used by picker and resolver UIs. Root import only.                                        |
| Organization  | `./lib/organization` | Org unit, position, membership, manager rule contracts. Root import only.                                       |
| Status        | `./lib/status`       | Approval instance/task/status display contracts. `ApprovalInstanceState` includes `EXPIRED`.                    |

## Form option sources

Form option fields use the additive `FormFieldOptionSource` contract. Static
`options` remain supported; dynamic fields store only a registered
`FormDataSourceReference` with an exact version and direct field/constant
bindings. Transport details, credentials, queries, and authorization context
never belong in the form JSON. Legacy `select` and new `autocomplete` fields
without a `mode` normalize to `single`; `radio` is always single and
`checkbox` is always multiple.

## Workflow Notes

`WorkflowDefinition` is the canonical serialized workflow shape:

- `nodes` and `edges` are stored as JSONB on template versions.
- `WorkflowEdge` includes React Flow handles (`sourceHandle`, `targetHandle`)
  because the designer persists them for stable rendering.
- `WorkflowEdgeData.condition` is the executable CEL expression. The structured
  fields (`conditionFieldKey`, `conditionOperator`, `conditionValue`) are kept
  for designer UI compatibility and fallback display.
- An edge condition may read `lastDecision` (unreleased; it landed after `v0.16.2`), the newest decision recorded on
  the node the edge leaves (`LastDecisionContext`). It is `null` until that
  node has a decision, so guard it with `lastDecision != null && ...`. Publish
  rejects `lastDecision` in every other expression: initiator policy, entry
  condition, `EXPRESSION` resolver, webhook payload, and `SET_FORM_FIELD` value.
- `ApproverResolver` has these types: `DIRECT`, `POSITION`, `ORG_UNIT_MEMBER`,
  `ORG_UNIT_POSITION`, `ORG_MANAGER`, `ORG_UNIT_MANAGER`, `ORG_MANAGER_CHAIN`,
  `DYNAMIC_FORM`, and `EXPRESSION`. `ORG_MANAGER`, `ORG_UNIT_MANAGER`, and
  `ORG_MANAGER_CHAIN` accept an optional `fallback` (`NONE`, `DIRECT`, or
  `POSITION`). The `POSITION` fallback type is not released yet (it landed after
  `v0.16.2`); older engines reject it at run time.
- Service task actions (`ServiceAction`) have three types. The workflow engine
  executes all three at run time:
  - `NOTIFY`: `channels`, `recipients` (an `ApproverResolver`), optional
    `template`, and optional `webhooks` (host-registered NOTIFY webhook
    endpoints, referenced by key and version; no URL or secret is stored).
  - `WEBHOOK`: `url`, optional `headers` and `payload`.
  - `SET_FORM_FIELD`: `fieldPath` and `value`.
- The designer's service-task panel creates and edits `NOTIFY` actions only.
  `WEBHOOK` and `SET_FORM_FIELD` actions can be stored in a workflow JSON
  document, and the workflow-assistant toolset (`workflow-toolset`) can produce
  all three, but the panel does not offer them as choices. Editing a
  non-`NOTIFY` action's recipients in the panel replaces it with a `NOTIFY`
  action.

## Commands

```bash
pnpm nx typecheck shared
pnpm nx build shared
```
