import { Field, InputType } from '@nestjs/graphql';
import { IsOptional, IsString } from 'class-validator';

@InputType()
export class DryRunApprovalWorkflowInput {
  @Field()
  @IsString()
  workflowDefinitionJson!: string;

  @Field()
  @IsString()
  formDataJson!: string;

  @Field()
  @IsString()
  initiatorMemberId!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  initiatorMetadataSnapshotJson!: string | null;
}
