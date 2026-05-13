import { Field, ID, InputType, Int } from '@nestjs/graphql';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

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

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  categoryId!: string | null;

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

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  categoryId!: string | null;
}

@InputType()
export class CreateApprovalTemplateCategoryInput {
  @Field()
  @IsString()
  name!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  description!: string | null;

  @Field(() => Boolean, { nullable: true })
  @IsBoolean()
  @IsOptional()
  isActive!: boolean | null;

  @Field(() => Int, { nullable: true })
  @IsInt()
  @IsOptional()
  sortOrder!: number | null;
}

@InputType()
export class UpdateApprovalTemplateCategoryInput {
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

  @Field(() => Boolean, { nullable: true })
  @IsBoolean()
  @IsOptional()
  isActive!: boolean | null;

  @Field(() => Int, { nullable: true })
  @IsInt()
  @IsOptional()
  sortOrder!: number | null;
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
