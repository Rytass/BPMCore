import { Field, ID, InputType } from '@nestjs/graphql';
import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';

@InputType()
export class ComposeApprovalTemplateWithFormInput {
  // --- Target identity (decides create vs update of existing drafts) ---
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  formDefinitionId!: string | null;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  templateId!: string | null;

  // --- Form content ---
  @Field()
  @IsString()
  formName!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  formDescription!: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  schemaJson!: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  uiSchemaJson!: string | null;

  // --- Template content ---
  @Field()
  @IsString()
  templateName!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  templateDescription!: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  category!: string | null;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  categoryId!: string | null;

  @Field()
  @IsString()
  workflowDefinitionJson!: string;

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

  // --- Behaviour flag ---
  @Field()
  @IsBoolean()
  publish!: boolean;
}
