import { Field, InputType } from '@nestjs/graphql';
import { IsOptional, IsString, IsUUID } from 'class-validator';

@InputType()
export class ResubmitApprovalInstanceInput {
  @Field()
  @IsUUID()
  instanceId!: string;

  @Field()
  @IsString()
  initiatorMemberId!: string;

  @Field()
  @IsString()
  formDataJson!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  title!: string | null;
}
