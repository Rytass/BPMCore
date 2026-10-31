import { Field, ID, ObjectType } from '@nestjs/graphql';

/**
 * What an organization picker needs to show one unit: the id to store, a
 * label, and whether the unit has been retired since it was picked.
 *
 * Deliberately narrower than `OrgUnitEntity`: no parent, path, type or
 * metadata, because any signed-in member may read it.
 */
@ObjectType('OrgUnitOption')
export class OrgUnitOptionObject {
  @Field(() => ID)
  id!: string;

  @Field()
  code!: string;

  @Field()
  name!: string;

  @Field(() => Boolean)
  deleted!: boolean;
}
