import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType('ResolvedManager')
export class ResolvedManagerObject {
  @Field()
  memberId!: string;

  @Field({ nullable: true })
  managerMemberId!: string | null;
}
