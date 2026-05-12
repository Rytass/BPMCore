import { registerEnumType } from '@nestjs/graphql';

export enum FormDefinitionVersionStatusEnum {
  ARCHIVED = 'ARCHIVED',
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
}

export enum FormDefinitionListStatusEnum {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
}

registerEnumType(FormDefinitionVersionStatusEnum, {
  name: 'FormDefinitionVersionStatus',
});

registerEnumType(FormDefinitionListStatusEnum, {
  name: 'FormDefinitionListStatus',
});
