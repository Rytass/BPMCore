import { Field, InputType } from '@nestjs/graphql';
import {
  ArrayMaxSize,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApprovalInstanceFieldFilterOperatorEnum } from '../workflow-engine.enums';

/**
 * One condition on a form field of the approval-instance list (ADR 25 §7.1).
 * `fieldKey` is a top-level fieldKey, or `<tableKey>.<columnKey>` for a table
 * column. EQUALS, NOT_EQUALS and CONTAINS read `values[0]`; IN reads every
 * value; RANGE reads `from` and `to`. The value formats are checked by the
 * compiler against the field's type, not here.
 */
@InputType()
export class ApprovalInstanceFieldFilterInput {
  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  fieldKey!: string;

  @Field(() => ApprovalInstanceFieldFilterOperatorEnum)
  @IsEnum(ApprovalInstanceFieldFilterOperatorEnum)
  operator!: ApprovalInstanceFieldFilterOperatorEnum;

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  values?: readonly string[] | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  from?: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  to?: string | null;
}
