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

Stable subpaths are available for narrower imports:

```ts
import type { ConditionContextType } from '@rytass/bpm-core-shared/condition';
import type { FormDefinitionSchema } from '@rytass/bpm-core-shared/form';
import type { ApprovalInstanceState } from '@rytass/bpm-core-shared/status';
import type { WorkflowDefinition } from '@rytass/bpm-core-shared/workflow';
```

## Contract Areas

| Area          | Source module        | Notes                                                         |
| ------------- | -------------------- | ------------------------------------------------------------- |
| Workflow JSON | `./lib/workflow`     | React Flow-aligned workflow nodes, edges, resolvers, actions. |
| Form schema   | `./lib/form`         | Form builder schema, UI schema, validation rules.             |
| Conditions    | `./lib/condition`    | CEL lint/evaluation result shapes shared with clients.        |
| Identity      | `./lib/identity`     | Member metadata shape used by picker and resolver UIs.        |
| Organization  | `./lib/organization` | Org unit, position, membership, manager rule contracts.       |
| Status        | `./lib/status`       | Approval instance/task/status display contracts.              |

## Workflow Notes

`WorkflowDefinition` is the canonical serialized workflow shape:

- `nodes` and `edges` are stored as JSONB on template versions.
- `WorkflowEdge` includes React Flow handles (`sourceHandle`, `targetHandle`)
  because the designer persists them for stable rendering.
- `WorkflowEdgeData.condition` is the executable CEL expression. The structured
  fields (`conditionFieldKey`, `conditionOperator`, `conditionValue`) are kept
  for designer UI compatibility and fallback display.
- `ApproverResolver` includes direct member, position, org-unit member,
  org-unit position, org-manager, dynamic-form, and expression resolvers.
- Service actions include broader schema support for `NOTIFY`, `WEBHOOK`, and
  `SET_FORM_FIELD`; the current designer/runtime only execute `NOTIFY`.

## Commands

```bash
pnpm nx typecheck shared
pnpm nx build shared
```
