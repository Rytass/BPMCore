import { Field, ID, ObjectType } from '@nestjs/graphql';
import { MemberMetadata } from '@bpm/shared';

@ObjectType('MemberProfile')
export class MemberProfileObject {
  @Field(() => ID)
  memberId!: string;

  @Field()
  name!: string;

  @Field()
  email!: string;

  @Field({ nullable: true })
  primaryOrgUnitId!: string | null;

  @Field({ nullable: true })
  positionId!: string | null;

  @Field()
  customFieldsJson!: string;
}

export function toMemberProfileObject(
  metadata: MemberMetadata,
): MemberProfileObject {
  return {
    customFieldsJson: JSON.stringify(metadata.customFields),
    email: metadata.email,
    memberId: metadata.memberId,
    name: metadata.name,
    positionId: metadata.positionId,
    primaryOrgUnitId: metadata.primaryOrgUnitId,
  };
}
