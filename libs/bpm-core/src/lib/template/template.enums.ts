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

registerEnumType(ApprovalTemplateCategoryStatusEnum, {
  name: 'ApprovalTemplateCategoryStatus',
});
