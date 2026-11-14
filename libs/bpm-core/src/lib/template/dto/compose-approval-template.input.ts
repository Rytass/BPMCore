import { Field, ID, InputType } from '@nestjs/graphql';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateIf,
} from 'class-validator';
import { TEMPLATE_KEY_PATTERN } from '../template-key';
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

  /**
   * Host key that finds the template to version when `templateId` is absent
   * (ADR 27 §6.2). Not found: the template is created with this key.
   */
  @Field(() => String, {
    description:
      'Host key that finds the template to version, used when templateId is absent. A live template with this key gets a new draft version; if none exists, a new template is created with this key. Same format as key. An empty string or null is ignored.',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_object: object, value: unknown): boolean => value !== '')
  @IsString()
  @Matches(TEMPLATE_KEY_PATTERN, {
    message: 'templateKey must match ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$',
  })
  templateKey?: string | null;

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

  /**
   * Host key for the template (ADR 27 §6). Applied on create; on an existing
   * template it is set after the row lock. Absent keeps the current key.
   */
  @Field(() => String, {
    description:
      'Stable key the host declares for a template it owns (ADR 27 §6). Starts with a letter or digit; then letters, digits, ".", "_" or "-"; at most 128 characters. Unique among live templates. An empty string clears it. Absent keeps the current key.',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_object: object, value: unknown): boolean => value !== '')
  @IsString()
  @Matches(TEMPLATE_KEY_PATTERN, {
    message: 'key must match ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$',
  })
  key?: string | null;

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

  /**
   * Host-owned flag (ADR 27 §6.2). Service-only: no `@Field`. Applied to the
   * template (absent keeps the stored value) and to the form (absent creates
   * it with `false`, keeps the stored value otherwise).
   */
  hostManaged?: boolean;

  // --- Behaviour flag ---
  @Field()
  @IsBoolean()
  publish!: boolean;
}
