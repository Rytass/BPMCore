import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType('SignatureVerification')
export class SignatureVerificationObject {
  @Field()
  instanceId!: string;

  @Field()
  valid!: boolean;

  @Field()
  checkedCount!: number;

  @Field(() => [String])
  errors!: readonly string[];
}
