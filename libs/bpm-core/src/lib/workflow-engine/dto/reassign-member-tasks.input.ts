import { Field, ID, InputType } from '@nestjs/graphql';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

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

  /** Only these tasks; omitted or null means every open task, as before. */
  @Field(() => [ID], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('all', { each: true })
  taskIds?: string[] | null;
}
