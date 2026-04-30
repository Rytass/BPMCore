export type VersionStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export type ApprovalInstanceState =
  | 'DRAFT'
  | 'RUNNING'
  | 'APPROVED'
  | 'REJECTED'
  | 'RETURNED'
  | 'CANCELLED'
  | 'EXPIRED';

export type WorkflowTokenStatus = 'ACTIVE' | 'WAITING' | 'CONSUMED';

export type TaskStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'TRANSFERRED'
  | 'CANCELLED';

export type TaskDecisionAction =
  | 'APPROVED'
  | 'REJECTED'
  | 'RETURNED'
  | 'TRANSFERRED';

export type DelegationRuleStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED';

export type DelegationScopeType = 'ALL' | 'TEMPLATE_LIST' | 'CONDITION_BASED';
