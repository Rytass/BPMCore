import { registerEnumType } from '@nestjs/graphql';

export enum ApprovalInstanceStateEnum {
  APPROVED = 'APPROVED',
  CANCELLED = 'CANCELLED',
  DRAFT = 'DRAFT',
  EXPIRED = 'EXPIRED',
  REJECTED = 'REJECTED',
  RETURNED = 'RETURNED',
  RUNNING = 'RUNNING',
}

export enum ApprovalInstanceListViewEnum {
  ALL = 'ALL',
  CC = 'CC',
  SENT = 'SENT',
}

export enum WorkflowTokenStatusEnum {
  ACTIVE = 'ACTIVE',
  CONSUMED = 'CONSUMED',
  WAITING = 'WAITING',
}

export enum TaskStatusEnum {
  CANCELLED = 'CANCELLED',
  COMPLETED = 'COMPLETED',
  IN_PROGRESS = 'IN_PROGRESS',
  PENDING = 'PENDING',
  TRANSFERRED = 'TRANSFERRED',
}

export enum TaskAssignmentTypeEnum {
  CANDIDATE_GROUP = 'CANDIDATE_GROUP',
  DIRECT_MEMBER = 'DIRECT_MEMBER',
}

export enum TaskCandidateStatusEnum {
  CANCELLED = 'CANCELLED',
  CLAIMED = 'CLAIMED',
  COMPLETED = 'COMPLETED',
  PENDING = 'PENDING',
  SUPERSEDED = 'SUPERSEDED',
  TRANSFERRED = 'TRANSFERRED',
  /** SEQUENTIAL task, not this candidate's turn yet. */
  WAITING = 'WAITING',
}

/** Whose seat an open task gives a member: the assignee field, or a candidate row. */
export enum MemberTaskRoleEnum {
  ASSIGNEE = 'ASSIGNEE',
  CANDIDATE = 'CANDIDATE',
}

export enum TaskReassignmentOutcomeEnum {
  REASSIGNED = 'REASSIGNED',
  REJECTED = 'REJECTED',
  WOULD_REASSIGN = 'WOULD_REASSIGN',
}

/** Why an administrator reassignment was refused. Every refusal is explicit, never skipped silently. */
export enum TaskReassignmentErrorCodeEnum {
  INSTANCE_NOT_RUNNING = 'INSTANCE_NOT_RUNNING',
  REASON_REQUIRED = 'REASON_REQUIRED',
  SOURCE_NOT_ON_TASK = 'SOURCE_NOT_ON_TASK',
  TARGET_ALREADY_DECIDED = 'TARGET_ALREADY_DECIDED',
  TARGET_ALREADY_ON_TASK = 'TARGET_ALREADY_ON_TASK',
  TARGET_GRADE_TOO_LOW = 'TARGET_GRADE_TOO_LOW',
  TARGET_IS_INITIATOR = 'TARGET_IS_INITIATOR',
  TARGET_IS_SUBMITTER = 'TARGET_IS_SUBMITTER',
  TARGET_SAME_AS_SOURCE = 'TARGET_SAME_AS_SOURCE',
  TASK_NOT_OPEN = 'TASK_NOT_OPEN',
  /** A database or engine failure while reassigning one task; that task alone is reported. */
  UNEXPECTED_ERROR = 'UNEXPECTED_ERROR',
}

export enum TaskDecisionActionEnum {
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  RETURNED = 'RETURNED',
  TRANSFERRED = 'TRANSFERRED',
}

export enum ActivityLogEventTypeEnum {
  ADHOC_DIRECTIVE_CANCELLED = 'ADHOC_DIRECTIVE_CANCELLED',
  ADHOC_DIRECTIVE_CREATED = 'ADHOC_DIRECTIVE_CREATED',
  ADHOC_PRE_APPROVAL_RETURNED = 'ADHOC_PRE_APPROVAL_RETURNED',
  ENGINE_PROCESS_REQUESTED = 'ENGINE_PROCESS_REQUESTED',
  INSTANCE_CANCELLED = 'INSTANCE_CANCELLED',
  INSTANCE_RESUBMITTED = 'INSTANCE_RESUBMITTED',
  INSTANCE_STARTED = 'INSTANCE_STARTED',
  INSTANCE_RETURNED = 'INSTANCE_RETURNED',
  SERVICE_TASK_EXECUTED = 'SERVICE_TASK_EXECUTED',
  SERVICE_TASK_FAILED = 'SERVICE_TASK_FAILED',
  SLA_TRIGGERED = 'SLA_TRIGGERED',
  /** A SEQUENTIAL task passed to its next candidate. */
  TASK_CANDIDATE_ACTIVATED = 'TASK_CANDIDATE_ACTIVATED',
  TASK_CREATED = 'TASK_CREATED',
  TASK_DECIDED = 'TASK_DECIDED',
  /** An administrator moved an open task's seat to another member in place (task id unchanged). */
  TASK_REASSIGNED = 'TASK_REASSIGNED',
  TOKEN_ADVANCED = 'TOKEN_ADVANCED',
  TOKEN_CREATED = 'TOKEN_CREATED',
  /** An administrator re-queued a FAILED NOTIFY webhook delivery (ADR 18 §3.10). */
  WEBHOOK_DELIVERY_RETRIED = 'WEBHOOK_DELIVERY_RETRIED',
}

registerEnumType(ApprovalInstanceStateEnum, {
  name: 'ApprovalInstanceState',
});

registerEnumType(ApprovalInstanceListViewEnum, {
  name: 'ApprovalInstanceListView',
});

registerEnumType(WorkflowTokenStatusEnum, {
  name: 'WorkflowTokenStatus',
});

registerEnumType(TaskStatusEnum, {
  name: 'TaskStatus',
});

registerEnumType(TaskAssignmentTypeEnum, {
  name: 'TaskAssignmentType',
});

registerEnumType(TaskCandidateStatusEnum, {
  name: 'TaskCandidateStatus',
});

registerEnumType(TaskDecisionActionEnum, {
  name: 'TaskDecisionAction',
});

registerEnumType(ActivityLogEventTypeEnum, {
  name: 'ActivityLogEventType',
});

registerEnumType(MemberTaskRoleEnum, {
  name: 'MemberTaskRole',
});

registerEnumType(TaskReassignmentOutcomeEnum, {
  name: 'TaskReassignmentOutcome',
});

registerEnumType(TaskReassignmentErrorCodeEnum, {
  name: 'TaskReassignmentErrorCode',
});
