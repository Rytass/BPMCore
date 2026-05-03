import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType('FormSchemaLintResult')
export class FormSchemaLintResultObject {
  @Field()
  valid!: boolean;

  @Field(() => [String])
  errors!: readonly string[];
}
