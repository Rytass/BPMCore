import { Field, ID, InputType } from '@nestjs/graphql';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { OrgUnitTypeEnum } from '../organization.enums';

const ISO_DATE_TIME_WITH_TIME_ZONE_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

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

@InputType()
export class CommitOrgUnitTreeDraftMoveInput {
  @Field(() => ID)
  @IsString()
  id!: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsString()
  parentId!: string | null;

  @Field()
  @IsString()
  @Matches(ISO_DATE_TIME_WITH_TIME_ZONE_PATTERN, {
    message: 'baseUpdatedAt must be ISO 8601 datetime with timezone',
  })
  baseUpdatedAt!: string;
}

@InputType()
export class CommitOrgUnitTreeDraftInput {
  @Field(() => [CommitOrgUnitTreeDraftMoveInput])
  @IsArray()
  @ValidateNested({ each: true })
  moves!: readonly CommitOrgUnitTreeDraftMoveInput[];
}
