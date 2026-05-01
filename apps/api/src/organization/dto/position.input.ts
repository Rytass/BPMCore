import { Field, ID, InputType, Int } from '@nestjs/graphql';

@InputType()
export class CreatePositionInput {
  @Field()
  code!: string;

  @Field()
  name!: string;

  @Field(() => Int)
  level!: number;

  @Field({ defaultValue: '{}' })
  metadataJson!: string;
}

@InputType()
export class UpdatePositionInput {
  @Field(() => ID)
  id!: string;

  @Field(() => String, { nullable: true })
  code!: string | null;

  @Field(() => String, { nullable: true })
  name!: string | null;

  @Field(() => Int, { nullable: true })
  level!: number | null;

  @Field(() => String, { nullable: true })
  metadataJson!: string | null;
}
