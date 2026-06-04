import { registerEnumType } from '@nestjs/graphql';

export enum NotificationChannelEnum {
  EMAIL = 'EMAIL',
  IN_APP = 'IN_APP',
  WEBHOOK = 'WEBHOOK',
}

export enum NotificationDigestModeEnum {
  DAILY = 'DAILY',
  INSTANT = 'INSTANT',
}

export enum NotificationStatusEnum {
  DELIVERY_IN_PROGRESS = 'DELIVERY_IN_PROGRESS',
  FAILED = 'FAILED',
  PENDING = 'PENDING',
  READ = 'READ',
  SENT = 'SENT',
}

/**
 * Action-lifecycle of an actionable notification (TASK_ASSIGNED /
 * TASK_TRANSFERRED), orthogonal to the delivery `status`. `null` resolution
 * means the action is still OPEN (awaiting the recipient's decision); any
 * non-null value means the notification has been resolved and its inline
 * 同意/拒絕 actions must no longer be offered.
 */
export enum NotificationResolutionEnum {
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  RETURNED = 'RETURNED',
  TRANSFERRED = 'TRANSFERRED',
  SUPERSEDED = 'SUPERSEDED',
}

export enum NotificationTypeEnum {
  INSTANCE_COMPLETED = 'INSTANCE_COMPLETED',
  SLA_OVERDUE = 'SLA_OVERDUE',
  SLA_WARNING = 'SLA_WARNING',
  TASK_ASSIGNED = 'TASK_ASSIGNED',
  TASK_TRANSFERRED = 'TASK_TRANSFERRED',
  WORKFLOW_NOTIFICATION = 'WORKFLOW_NOTIFICATION',
}

registerEnumType(NotificationChannelEnum, {
  name: 'NotificationChannel',
});

registerEnumType(NotificationDigestModeEnum, {
  name: 'NotificationDigestMode',
});

registerEnumType(NotificationStatusEnum, {
  name: 'NotificationStatus',
});

registerEnumType(NotificationResolutionEnum, {
  name: 'NotificationResolution',
});

registerEnumType(NotificationTypeEnum, {
  name: 'NotificationType',
});
