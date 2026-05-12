import { Field, ID, InputType } from '@nestjs/graphql';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { OrgUnitTypeEnum } from '../organization.enums';

@InputType()
export class CreateOrgUnitInput {
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsString()
  parentId!: string | null;

  @Field()
  @IsString()
  code!: string;

  @Field()
  @IsString()
  name!: string;

  @Field(() => OrgUnitTypeEnum)
  @IsEnum(OrgUnitTypeEnum)
  type!: OrgUnitTypeEnum;

  @Field({ defaultValue: '{}' })
  @IsString()
  metadataJson!: string;
}

@InputType()
export class UpdateOrgUnitInput {
  @Field(() => ID)
  @IsString()
  id!: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsString()
  parentId!: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  code!: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  name!: string | null;

  @Field(() => OrgUnitTypeEnum, { nullable: true })
  @IsOptional()
  @IsEnum(OrgUnitTypeEnum)
  type!: OrgUnitTypeEnum | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  metadataJson!: string | null;
}
