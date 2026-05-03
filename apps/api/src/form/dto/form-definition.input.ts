import { Field, ID, InputType } from '@nestjs/graphql';
import { IsOptional, IsString, IsUUID } from 'class-validator';

@InputType()
export class CreateFormDefinitionInput {
  @Field()
  @IsString()
  name!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  description!: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  createdByMemberId!: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  schemaJson!: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  uiSchemaJson!: string | null;
}

@InputType()
export class UpdateFormDefinitionInput {
  @Field(() => ID)
  @IsUUID()
  id!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  name!: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  description!: string | null;
}

@InputType()
export class UpdateFormDefinitionDraftInput {
  @Field(() => ID)
  @IsUUID()
  versionId!: string;

  @Field()
  @IsString()
  schemaJson!: string;

  @Field()
  @IsString()
  uiSchemaJson!: string;
}

@InputType()
export class LintFormSchemaInput {
  @Field()
  @IsString()
  schemaJson!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  uiSchemaJson!: string | null;
}
