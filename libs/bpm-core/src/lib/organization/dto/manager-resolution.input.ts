import { Field, ID, InputType, Int } from '@nestjs/graphql';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';
import { ManagerResolutionScopeTypeEnum } from '../organization.enums';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

@InputType()
export class CreateManagerResolutionInput {
  @Field(() => ManagerResolutionScopeTypeEnum)
  @IsEnum(ManagerResolutionScopeTypeEnum)
  scopeType!: ManagerResolutionScopeTypeEnum;

  @Field()
  @IsString()
  scopeId!: string;

  @Field()
  @IsString()
  managerMemberId!: string;

  @Field(() => Int, { defaultValue: 0 })
  @IsInt()
  @Min(0)
  priority!: number;

  @Field()
  @IsString()
  @Matches(DATE_ONLY_PATTERN, {
    message: 'effectiveFrom must use YYYY-MM-DD format',
  })
  effectiveFrom!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY_PATTERN, {
    message: 'effectiveTo must use YYYY-MM-DD format',
  })
  effectiveTo?: string | null;
}

@InputType()
export class UpdateManagerResolutionInput {
  @Field(() => ID)
  @IsString()
  id!: string;

  @Field(() => ManagerResolutionScopeTypeEnum, { nullable: true })
  @IsOptional()
  @IsEnum(ManagerResolutionScopeTypeEnum)
  scopeType?: ManagerResolutionScopeTypeEnum | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  scopeId?: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  managerMemberId?: string | null;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY_PATTERN, {
    message: 'effectiveFrom must use YYYY-MM-DD format',
  })
  effectiveFrom?: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY_PATTERN, {
    message: 'effectiveTo must use YYYY-MM-DD format',
  })
  effectiveTo?: string | null;
}
