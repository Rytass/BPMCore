import { registerEnumType } from '@nestjs/graphql';

export enum ApprovalTemplateVersionStatusEnum {
  ARCHIVED = 'ARCHIVED',
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
}

registerEnumType(ApprovalTemplateVersionStatusEnum, {
  name: 'ApprovalTemplateVersionStatus',
});
