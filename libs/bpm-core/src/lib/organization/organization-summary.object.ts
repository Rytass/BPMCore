import { Field, Int, ObjectType } from '@nestjs/graphql';

@ObjectType('OrganizationSummary')
export class OrganizationSummaryObject {
  @Field(() => Int)
  orgUnitCount!: number;

  @Field(() => Int)
  positionCount!: number;

  @Field(() => Int)
  membershipCount!: number;

  @Field(() => Int)
  managerResolutionCount!: number;
}
