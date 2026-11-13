import { registerEnumType } from '@nestjs/graphql';
import type { BPMInstanceEventStatus } from './instance-event.types';

/**
 * GraphQL view of the outbox status. Values match `BPMInstanceEventStatus`
 * one to one; the two maps below keep that pairing checked by the compiler.
 */
export enum ApprovalInstanceEventStatusEnum {
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED',
  PENDING = 'PENDING',
}

registerEnumType(ApprovalInstanceEventStatusEnum, {
  name: 'BPMApprovalInstanceEventStatus',
});

export const APPROVAL_INSTANCE_EVENT_STATUS_TO_ENUM: Readonly<
  Record<BPMInstanceEventStatus, ApprovalInstanceEventStatusEnum>
> = {
  DELIVERED: ApprovalInstanceEventStatusEnum.DELIVERED,
  FAILED: ApprovalInstanceEventStatusEnum.FAILED,
  PENDING: ApprovalInstanceEventStatusEnum.PENDING,
};

export const APPROVAL_INSTANCE_EVENT_ENUM_TO_STATUS: Readonly<
  Record<ApprovalInstanceEventStatusEnum, BPMInstanceEventStatus>
> = {
  [ApprovalInstanceEventStatusEnum.DELIVERED]: 'DELIVERED',
  [ApprovalInstanceEventStatusEnum.FAILED]: 'FAILED',
  [ApprovalInstanceEventStatusEnum.PENDING]: 'PENDING',
};
