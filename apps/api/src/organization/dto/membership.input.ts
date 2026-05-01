import { Field, ID, InputType } from '@nestjs/graphql';

@InputType()
export class CreateMembershipInput {
  @Field()
  memberId!: string;

  @Field(() => ID)
  orgUnitId!: string;

  @Field(() => ID, { nullable: true })
  positionId!: string | null;

  @Field({ defaultValue: false })
  isPrimary!: boolean;

  @Field()
  effectiveFrom!: string;

  @Field(() => String, { nullable: true })
  effectiveTo!: string | null;
}

@InputType()
export class UpdateMembershipInput {
  @Field(() => ID)
  id!: string;

  @Field(() => ID, { nullable: true })
  orgUnitId!: string | null;

  @Field(() => ID, { nullable: true })
  positionId!: string | null;

  @Field(() => Boolean, { nullable: true })
  isPrimary!: boolean | null;

  @Field(() => String, { nullable: true })
  effectiveFrom!: string | null;

  @Field(() => String, { nullable: true })
  effectiveTo!: string | null;
}
