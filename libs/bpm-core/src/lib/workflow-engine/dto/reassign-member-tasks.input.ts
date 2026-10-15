import { Field, InputType } from '@nestjs/graphql';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

@InputType()
export class ReassignMemberTasksInput {
  @Field()
  @IsString()
  fromMemberId!: string;

  @Field()
  @IsString()
  toMemberId!: string;

  @Field()
  @IsString()
  reason!: string;

  /** Evaluate every open task and report the outcomes without writing anything. */
  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean | null;
}
