import { Field, Int, ObjectType } from '@nestjs/graphql';

/**
 * What `deleteOrgUnit` would have to deal with before it can retire a unit,
 * so a caller can ask for a successor unit up front instead of reading it off
 * a rejected delete.
 *
 * "Open" means not yet ended in the organization time zone: `effectiveTo` is
 * empty or today or later. That deliberately includes rows that only start in
 * the future — retiring the unit under them would leave the member in a unit
 * that is gone the day the row takes effect.
 */
@ObjectType('OrgUnitRetirementImpact')
export class OrgUnitRetirementImpactObject {
  /** Live child units. These always block the delete; move them first. */
  @Field(() => Int)
  childUnitCount!: number;

  /** Open memberships, which move to the successor unit. */
  @Field(() => Int)
  openMembershipCount!: number;

  /** Open `ORG_UNIT`-scoped manager rules for this unit, which are ended. */
  @Field(() => Int)
  openManagerResolutionCount!: number;
}
