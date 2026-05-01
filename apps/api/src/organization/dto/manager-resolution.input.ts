import { Field, ID, InputType, Int } from '@nestjs/graphql';
import { ManagerResolutionScopeTypeEnum } from '../organization.enums';

@InputType()
export class CreateManagerResolutionInput {
  @Field(() => ManagerResolutionScopeTypeEnum)
  scopeType!: ManagerResolutionScopeTypeEnum;

  @Field()
  scopeId!: string;

  @Field()
  managerMemberId!: string;

  @Field(() => Int, { defaultValue: 0 })
  priority!: number;

  @Field()
  effectiveFrom!: string;

  @Field(() => String, { nullable: true })
  effectiveTo!: string | null;
}

@InputType()
export class UpdateManagerResolutionInput {
  @Field(() => ID)
  id!: string;

  @Field(() => ManagerResolutionScopeTypeEnum, { nullable: true })
  scopeType!: ManagerResolutionScopeTypeEnum | null;

  @Field(() => String, { nullable: true })
  scopeId!: string | null;

  @Field(() => String, { nullable: true })
  managerMemberId!: string | null;

  @Field(() => Int, { nullable: true })
  priority!: number | null;

  @Field(() => String, { nullable: true })
  effectiveFrom!: string | null;

  @Field(() => String, { nullable: true })
  effectiveTo!: string | null;
}
