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

export enum TaskDecisionActionEnum {
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  RETURNED = 'RETURNED',
  TRANSFERRED = 'TRANSFERRED',
}

export enum ActivityLogEventTypeEnum {
  ENGINE_PROCESS_REQUESTED = 'ENGINE_PROCESS_REQUESTED',
  INSTANCE_STARTED = 'INSTANCE_STARTED',
  SLA_TRIGGERED = 'SLA_TRIGGERED',
  TASK_CREATED = 'TASK_CREATED',
  TASK_DECIDED = 'TASK_DECIDED',
  TOKEN_ADVANCED = 'TOKEN_ADVANCED',
  TOKEN_CREATED = 'TOKEN_CREATED',
}

registerEnumType(ApprovalInstanceStateEnum, {
  name: 'ApprovalInstanceState',
});

registerEnumType(WorkflowTokenStatusEnum, {
  name: 'WorkflowTokenStatus',
});

registerEnumType(TaskStatusEnum, {
  name: 'TaskStatus',
});

registerEnumType(TaskDecisionActionEnum, {
  name: 'TaskDecisionAction',
});

registerEnumType(ActivityLogEventTypeEnum, {
  name: 'ActivityLogEventType',
});
