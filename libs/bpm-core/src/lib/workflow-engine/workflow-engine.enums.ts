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
}

export enum TaskDecisionActionEnum {
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  RETURNED = 'RETURNED',
  TRANSFERRED = 'TRANSFERRED',
}

export enum ActivityLogEventTypeEnum {
  ENGINE_PROCESS_REQUESTED = 'ENGINE_PROCESS_REQUESTED',
  INSTANCE_CANCELLED = 'INSTANCE_CANCELLED',
  INSTANCE_RESUBMITTED = 'INSTANCE_RESUBMITTED',
  INSTANCE_STARTED = 'INSTANCE_STARTED',
  INSTANCE_RETURNED = 'INSTANCE_RETURNED',
  SERVICE_TASK_EXECUTED = 'SERVICE_TASK_EXECUTED',
  SERVICE_TASK_FAILED = 'SERVICE_TASK_FAILED',
  SLA_TRIGGERED = 'SLA_TRIGGERED',
  TASK_CREATED = 'TASK_CREATED',
  TASK_DECIDED = 'TASK_DECIDED',
  TOKEN_ADVANCED = 'TOKEN_ADVANCED',
  TOKEN_CREATED = 'TOKEN_CREATED',
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
