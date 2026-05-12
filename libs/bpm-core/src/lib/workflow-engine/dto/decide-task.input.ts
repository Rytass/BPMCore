import { Field, InputType } from '@nestjs/graphql';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { TaskDecisionActionEnum } from '../workflow-engine.enums';

@InputType()
export class DecideTaskInput {
  @Field()
  @IsUUID()
  taskId!: string;

  @Field()
  @IsString()
  decidedByMemberId!: string;

  @Field(() => TaskDecisionActionEnum)
  @IsEnum(TaskDecisionActionEnum)
  action!: TaskDecisionActionEnum;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  comment?: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  returnToNodeId?: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  transferToMemberId?: string | null;
}
