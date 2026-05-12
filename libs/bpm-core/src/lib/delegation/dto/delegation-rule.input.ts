import { Field, ID, InputType, Int } from '@nestjs/graphql';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
} from 'class-validator';
import { DelegationScopeTypeEnum } from '../delegation.enums';

const ISO_DATE_TIME_WITH_TIME_ZONE_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

@InputType()
export class CreateDelegationRuleInput {
  @Field()
  @IsString()
  principalMemberId!: string;

  @Field()
  @IsString()
  agentMemberId!: string;

  @Field(() => DelegationScopeTypeEnum)
  @IsEnum(DelegationScopeTypeEnum)
  scopeType!: DelegationScopeTypeEnum;

  @Field(() => [String], { nullable: true })
  @IsArray()
  @IsOptional()
  @IsUUID('4', { each: true })
  scopeTemplateIds?: readonly string[] | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  scopeConditionCel?: string | null;

  @Field(() => Int, { nullable: true })
  @IsInt()
  @IsOptional()
  @Min(1)
  priority?: number | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE_TIME_WITH_TIME_ZONE_PATTERN, {
    message: 'startAt must be ISO 8601 datetime with timezone',
  })
  startAt?: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE_TIME_WITH_TIME_ZONE_PATTERN, {
    message: 'endAt must be ISO 8601 datetime with timezone',
  })
  endAt?: string | null;

  @Field(() => Boolean, { nullable: true })
  @IsBoolean()
  @IsOptional()
  requiresConfirmation?: boolean | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  createdByMemberId?: string | null;
}

@InputType()
export class UpdateDelegationRuleInput {
  @Field(() => ID)
  @IsUUID()
  id!: string;

  @Field()
  @IsString()
  agentMemberId!: string;

  @Field(() => DelegationScopeTypeEnum)
  @IsEnum(DelegationScopeTypeEnum)
  scopeType!: DelegationScopeTypeEnum;

  @Field(() => [String], { nullable: true })
  @IsArray()
  @IsOptional()
  @IsUUID('4', { each: true })
  scopeTemplateIds?: readonly string[] | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  scopeConditionCel?: string | null;

  @Field(() => Int)
  @IsInt()
  @Min(1)
  priority!: number;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE_TIME_WITH_TIME_ZONE_PATTERN, {
    message: 'startAt must be ISO 8601 datetime with timezone',
  })
  startAt?: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE_TIME_WITH_TIME_ZONE_PATTERN, {
    message: 'endAt must be ISO 8601 datetime with timezone',
  })
  endAt?: string | null;

  @Field(() => Boolean)
  @IsBoolean()
  requiresConfirmation!: boolean;
}
