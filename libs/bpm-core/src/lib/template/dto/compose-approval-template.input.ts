import { Field, ID, InputType } from '@nestjs/graphql';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { ApprovalTemplateLaunchModeEnum } from '../template.enums';

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

  /**
   * `HOST_ONLY` keeps the template off the launch page and refuses submission
   * and resubmission through GraphQL; the host's backend submits it through
   * the service (ADR 27 §5). Absent keeps the draft's current value.
   */
  @Field(() => ApprovalTemplateLaunchModeEnum, {
    description:
      'OPEN (default): members start it from the launch page. HOST_ONLY: only the host backend submits it; it is left out of the launchable list and GraphQL submit and resubmit are refused with 403. Absent keeps the draft value.',
    nullable: true,
  })
  @IsOptional()
  @IsEnum(ApprovalTemplateLaunchModeEnum)
  launchMode?: ApprovalTemplateLaunchModeEnum | null;

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
