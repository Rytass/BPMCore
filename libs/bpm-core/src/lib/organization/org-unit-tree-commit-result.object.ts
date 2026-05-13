import { Field, ObjectType } from '@nestjs/graphql';
import { OrgUnitEntity } from './org-unit.entity';

@ObjectType('OrgUnitTreeCommitResult')
export class OrgUnitTreeCommitResultObject {
  @Field(() => [OrgUnitEntity])
  orgUnits!: readonly OrgUnitEntity[];
}
