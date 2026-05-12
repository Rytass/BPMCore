import { Field, InputType } from '@nestjs/graphql';
import { IsOptional, IsString, IsUUID } from 'class-validator';

@InputType()
export class SubmitApprovalInstanceInput {
  @Field()
  @IsUUID()
  templateId!: string;

  @Field()
  @IsString()
  initiatorMemberId!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  initiatorMetadataSnapshotJson!: string | null;

  @Field()
  @IsString()
  formDataJson!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  title!: string | null;
}
