import { Field, InputType } from '@nestjs/graphql';
import { IsOptional, IsString, IsUUID } from 'class-validator';

@InputType()
export class CancelApprovalInstanceInput {
  @Field()
  @IsUUID()
  instanceId!: string;

  @Field()
  @IsString()
  cancelledByMemberId!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  comment!: string | null;
}
