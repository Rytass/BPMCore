import { Field, ID, ObjectType } from '@nestjs/graphql';
import { MemberMetadata } from '@rytass/bpm-core-shared';

@ObjectType('MemberProfile')
export class MemberProfileObject {
  @Field(() => ID)
  memberId!: string;

  @Field()
  name!: string;

  @Field()
  email!: string;

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
  };
}
