import { Field, InputType } from '@nestjs/graphql';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
} from 'class-validator';
import { AdhocTargetKindEnum } from '../adhoc.enums';

/**
 * Polymorphic ad-hoc target. Exactly the fields matching `kind` must be set:
 * MEMBER → memberIds, POSITION → positionId, ORG_UNIT_MEMBER → orgUnitId
 * (+ optional includeDescendants), WEBHOOK → webhookUrl (+ optional
 * webhookHeadersJson). WEBHOOK is only valid for notification directives.
 */
@InputType()
export class AdhocTargetInput {
  @Field(() => AdhocTargetKindEnum)
  @IsEnum(AdhocTargetKindEnum)
  kind!: AdhocTargetKindEnum;

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsString({ each: true })
  memberIds?: readonly string[] | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  positionId?: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  orgUnitId?: string | null;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  includeDescendants?: boolean | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUrl({ require_tld: false })
  webhookUrl?: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  webhookHeadersJson?: string | null;
}
