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

/**
 * Why a signer may not take back an approval they already gave. The server
 * refuses with a 409 whose `extensions.originalError.code` is one of these
 * values; a client can map each to its own wording. Defined here so the
 * server and the React package read the same list.
 */
export const SIGNER_RECALL_ERROR_CODES = {
  /** The host has not turned `signerRecallEnabled` on. */
  DISABLED: 'SIGNER_RECALL_DISABLED',
  NOT_THE_SIGNER: 'SIGNER_RECALL_NOT_THE_SIGNER',
  ALREADY_RECALLED: 'SIGNER_RECALL_ALREADY_RECALLED',
  NOT_A_PERSONAL_APPROVAL: 'SIGNER_RECALL_NOT_A_PERSONAL_APPROVAL',
  INSTANCE_NOT_RUNNING: 'SIGNER_RECALL_INSTANCE_NOT_RUNNING',
  STAGE_NOT_SETTLED_BY_THIS_APPROVAL:
    'SIGNER_RECALL_STAGE_NOT_SETTLED_BY_THIS_APPROVAL',
  DELEGATED_SEAT: 'SIGNER_RECALL_DELEGATED_SEAT',
  STAGE_NOTIFY_SENT: 'SIGNER_RECALL_STAGE_NOTIFY_SENT',
  NEXT_STAGE_ACTED: 'SIGNER_RECALL_NEXT_STAGE_ACTED',
  NEXT_STAGE_NOT_SINGLE: 'SIGNER_RECALL_NEXT_STAGE_NOT_SINGLE',
  PASSED_SERVICE_TASK: 'SIGNER_RECALL_PASSED_SERVICE_TASK',
  PASSED_JOIN: 'SIGNER_RECALL_PASSED_JOIN',
} as const;

export type SignerRecallErrorCode =
  (typeof SIGNER_RECALL_ERROR_CODES)[keyof typeof SIGNER_RECALL_ERROR_CODES];
