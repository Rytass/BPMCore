import { Field, ID, InputType } from '@nestjs/graphql';
import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';

@InputType()
export class ReassignTaskInput {
  @Field(() => ID)
  @IsUUID()
  taskId!: string;

  @Field()
  @IsString()
  fromMemberId!: string;

  @Field()
  @IsString()
  toMemberId!: string;

  @Field()
  @IsString()
  reason!: string;

  /** Evaluate and report the outcome without writing anything. */
  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean | null;
}
