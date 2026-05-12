import { Field, ID, InputType } from '@nestjs/graphql';
import { IsBoolean, IsOptional, IsString, Matches } from 'class-validator';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

@InputType()
export class CreateMembershipInput {
  @Field()
  @IsString()
  memberId!: string;

  @Field(() => ID)
  @IsString()
  orgUnitId!: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsString()
  positionId!: string | null;

  @Field({ defaultValue: false })
  @IsBoolean()
  isPrimary!: boolean;

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
  effectiveTo!: string | null;
}

@InputType()
export class UpdateMembershipInput {
  @Field(() => ID)
  @IsString()
  id!: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsString()
  orgUnitId!: string | null;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsString()
  positionId!: string | null;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  isPrimary!: boolean | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY_PATTERN, {
    message: 'effectiveFrom must use YYYY-MM-DD format',
  })
  effectiveFrom!: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY_PATTERN, {
    message: 'effectiveTo must use YYYY-MM-DD format',
  })
  effectiveTo!: string | null;
}
