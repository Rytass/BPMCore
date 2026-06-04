import { Field, ObjectType } from '@nestjs/graphql';
import { FormDefinitionEntity } from '../form/form-definition.entity';
import { FormDefinitionVersionEntity } from '../form/form-definition-version.entity';
import { ApprovalTemplateEntity } from './approval-template.entity';
import { ApprovalTemplateVersionEntity } from './approval-template-version.entity';

@ObjectType('ComposeApprovalTemplateWithFormResult')
export class ComposeApprovalTemplateWithFormObject {
  @Field(() => FormDefinitionEntity)
  formDefinition!: FormDefinitionEntity;

  @Field(() => FormDefinitionVersionEntity)
  formDefinitionVersion!: FormDefinitionVersionEntity;

  @Field(() => ApprovalTemplateEntity)
  template!: ApprovalTemplateEntity;

  @Field(() => ApprovalTemplateVersionEntity)
  templateVersion!: ApprovalTemplateVersionEntity;

  @Field()
  published!: boolean;
}
