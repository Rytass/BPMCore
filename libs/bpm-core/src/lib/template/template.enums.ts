import { registerEnumType } from '@nestjs/graphql';

export enum ApprovalTemplateVersionStatusEnum {
  ARCHIVED = 'ARCHIVED',
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
}

export enum ApprovalTemplateListStatusEnum {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
}

export enum ApprovalTemplateActivationStatusEnum {
  ACTIVE = 'ACTIVE',
  ALL = 'ALL',
  INACTIVE = 'INACTIVE',
}

/**
 * Who may start an instance of a template version (ADR 27 §5).
 * - `OPEN`: anyone the initiator policy allows, through GraphQL or the host.
 * - `HOST_ONLY`: only the host's backend, calling `WorkflowEngineService`
 *   directly. GraphQL submission and resubmission are refused and the template
 *   is left out of `launchableApprovalTemplates`.
 */
export enum ApprovalTemplateLaunchModeEnum {
  HOST_ONLY = 'HOST_ONLY',
  OPEN = 'OPEN',
}

export enum ApprovalTemplateCategoryStatusEnum {
  ACTIVE = 'ACTIVE',
  ALL = 'ALL',
  INACTIVE = 'INACTIVE',
}

registerEnumType(ApprovalTemplateVersionStatusEnum, {
  name: 'ApprovalTemplateVersionStatus',
});

registerEnumType(ApprovalTemplateListStatusEnum, {
  name: 'ApprovalTemplateListStatus',
});

registerEnumType(ApprovalTemplateActivationStatusEnum, {
  name: 'ApprovalTemplateActivationStatus',
});

registerEnumType(ApprovalTemplateLaunchModeEnum, {
  description:
    'Who may start an instance: OPEN (anyone the initiator policy allows) or HOST_ONLY (only the host backend; GraphQL submit and resubmit are refused).',
  name: 'ApprovalTemplateLaunchMode',
});

registerEnumType(ApprovalTemplateCategoryStatusEnum, {
  name: 'ApprovalTemplateCategoryStatus',
});
