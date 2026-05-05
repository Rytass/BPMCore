import { Field, InputType } from '@nestjs/graphql';

@InputType()
export class SubmitApprovalInstanceInput {
  @Field()
  templateId!: string;

  @Field()
  initiatorMemberId!: string;

  @Field(() => String, { nullable: true })
  initiatorMetadataSnapshotJson!: string | null;

  @Field()
  formDataJson!: string;

  @Field(() => String, { nullable: true })
  title!: string | null;
}
