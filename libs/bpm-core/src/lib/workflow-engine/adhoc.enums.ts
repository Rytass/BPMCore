import { registerEnumType } from '@nestjs/graphql';

export enum AdhocDirectiveTypeEnum {
  COMPLETION_NOTIFY = 'COMPLETION_NOTIFY',
  COUNTERSIGN = 'COUNTERSIGN',
  PRE_APPROVAL = 'PRE_APPROVAL',
  STAGE_NOTIFY = 'STAGE_NOTIFY',
}

export enum AdhocDirectiveStatusEnum {
  CANCELLED = 'CANCELLED',
  CONSUMED = 'CONSUMED',
  PENDING = 'PENDING',
}

export enum AdhocTargetKindEnum {
  MEMBER = 'MEMBER',
  ORG_UNIT_MEMBER = 'ORG_UNIT_MEMBER',
  POSITION = 'POSITION',
  WEBHOOK = 'WEBHOOK',
}

export enum AdhocPreApprovalRejectBehaviorEnum {
  REJECT_INSTANCE = 'REJECT_INSTANCE',
  RETURN_TO_ORIGIN = 'RETURN_TO_ORIGIN',
}

registerEnumType(AdhocDirectiveTypeEnum, {
  name: 'AdhocDirectiveType',
});

registerEnumType(AdhocDirectiveStatusEnum, {
  name: 'AdhocDirectiveStatus',
});

registerEnumType(AdhocTargetKindEnum, {
  name: 'AdhocTargetKind',
});

registerEnumType(AdhocPreApprovalRejectBehaviorEnum, {
  name: 'AdhocPreApprovalRejectBehavior',
});
