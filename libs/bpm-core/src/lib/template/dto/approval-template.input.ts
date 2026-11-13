import { Field, ID, InputType, Int } from '@nestjs/graphql';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { ApprovalTemplateLaunchModeEnum } from '../template.enums';

@InputType()
export class CreateApprovalTemplateInput {
  @Field()
  @IsString()
  name!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  description?: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  category?: string | null;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  createdByMemberId?: string | null;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  formDefinitionVersionId?: string | null;
}

@InputType()
export class UpdateApprovalTemplateInput {
  @Field(() => ID)
  @IsUUID()
  id!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  name?: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  description?: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  category?: string | null;

  /**
   * Category to attach, as a three-state value:
   *
   * - omitted (`undefined`) — keep the current category;
   * - `null` — detach the template from its category;
   * - an id — attach that category.
   *
   * Optional so callers can say "keep it". Declared required, the natural way
   * to satisfy the type on an unrelated rename was to pass `null`, which
   * quietly detached the category.
   */
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;
}

@InputType()
export class CreateApprovalTemplateCategoryInput {
  @Field()
  @IsString()
  name!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  description?: string | null;

  @Field(() => Boolean, { nullable: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean | null;

  @Field(() => Int, { nullable: true })
  @IsInt()
  @IsOptional()
  sortOrder?: number | null;
}

@InputType()
export class UpdateApprovalTemplateCategoryInput {
  @Field(() => ID)
  @IsUUID()
  id!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  name?: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  description?: string | null;

  @Field(() => Boolean, { nullable: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean | null;

  @Field(() => Int, { nullable: true })
  @IsInt()
  @IsOptional()
  sortOrder?: number | null;
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
  formDefinitionVersionId?: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  initiatorPolicyCel?: string | null;

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
  notificationConfigJson?: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  slaDefaultsJson?: string | null;
}
