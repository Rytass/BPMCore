import { Field, InputType } from '@nestjs/graphql';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApprovalInstanceSortDirectionEnum } from '../workflow-engine.enums';

/**
 * One sort key of the approval-instance list (ADR 25 §7.5). `field` is a
 * top-level filterable fieldKey, or one of `submittedAt`, `updatedAt`,
 * `completedAt`. Keys apply in order; the list always ends with `id`.
 */
@InputType()
export class ApprovalInstanceSortInput {
  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  field!: string;

  @Field(() => ApprovalInstanceSortDirectionEnum, { nullable: true })
  @IsOptional()
  @IsEnum(ApprovalInstanceSortDirectionEnum)
  direction?: ApprovalInstanceSortDirectionEnum | null;
}
