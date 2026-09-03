import { Field, ID, InputType, Int } from '@nestjs/graphql';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

@InputType()
export class CreatePositionInput {
  @Field()
  @IsString()
  code!: string;

  @Field()
  @IsString()
  name!: string;

  @Field(() => Int)
  @IsInt()
  @Min(0)
  level!: number;

  @Field({ defaultValue: '{}' })
  @IsString()
  metadataJson!: string;
}

@InputType()
export class UpdatePositionInput {
  @Field(() => ID)
  @IsString()
  id!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  code?: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  name?: string | null;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  level?: number | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  metadataJson?: string | null;
}
