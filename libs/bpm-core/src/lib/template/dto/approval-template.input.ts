import { Field, ID, InputType } from '@nestjs/graphql';
import { IsOptional, IsString, IsUUID } from 'class-validator';

@InputType()
export class CreateApprovalTemplateInput {
  @Field()
  @IsString()
  name!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  description!: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  category!: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  createdByMemberId!: string | null;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  formDefinitionVersionId!: string | null;
}

@InputType()
export class UpdateApprovalTemplateInput {
  @Field(() => ID)
  @IsUUID()
  id!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  name!: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  description!: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  category!: string | null;
}

@InputType()
export class UpdateApprovalTemplateDraftInput {
  @Field(() => ID)
  @IsUUID()
  versionId!: string;

  @Field()
  @IsString()
  workflowDefinitionJson!: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  formDefinitionVersionId!: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  initiatorPolicyCel!: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  notificationConfigJson!: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  slaDefaultsJson!: string | null;
}
