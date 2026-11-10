import type {
  ApprovalInstanceFieldFilter,
  ApprovalInstanceSort,
} from '@rytass/bpm-core-shared';
import type { ApprovalInstanceFieldFilterInput } from './approval-instance-field-filter.input';
import type { ApprovalInstanceSortInput } from './approval-instance-sort.input';

/**
 * Maps the GraphQL inputs of the approval-instance list onto the shared filter
 * types the service takes. An absent list stays absent; `null` members drop out.
 */
export function toApprovalInstanceFieldFilters(
  filters: readonly ApprovalInstanceFieldFilterInput[] | null,
): readonly ApprovalInstanceFieldFilter[] | undefined {
  return filters?.map((filter): ApprovalInstanceFieldFilter => ({
    fieldKey: filter.fieldKey,
    operator: filter.operator,
    ...(filter.values ? { values: filter.values } : {}),
    ...(filter.from ? { from: filter.from } : {}),
    ...(filter.to ? { to: filter.to } : {}),
  }));
}

export function toApprovalInstanceSorts(
  sorts: readonly ApprovalInstanceSortInput[] | null,
): readonly ApprovalInstanceSort[] | undefined {
  return sorts?.map((sort): ApprovalInstanceSort => ({
    field: sort.field,
    ...(sort.direction ? { direction: sort.direction } : {}),
  }));
}
