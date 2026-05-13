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

registerEnumType(ApprovalTemplateCategoryStatusEnum, {
  name: 'ApprovalTemplateCategoryStatus',
});
