import { Field, ID, InputType } from '@nestjs/graphql';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  ValidateIf,
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
  parentId?: string | null;

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

  /**
   * Target parent, as a three-state value:
   *
   * - omitted (`undefined`) — keep the current parent;
   * - `null` — move the unit to the top level;
   * - an id — move the unit under that parent.
   *
   * The property is optional precisely so callers can express "keep the
   * current parent". It used to be declared required, which pushed every
   * TypeScript caller into passing `null` for a field they did not mean to
   * touch — and each such call silently moved the unit and its whole subtree
   * to the root.
   */
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsString()
  parentId?: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  code?: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  name?: string | null;

  @Field(() => OrgUnitTypeEnum, { nullable: true })
  @IsOptional()
  @IsEnum(OrgUnitTypeEnum)
  type?: OrgUnitTypeEnum | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  metadataJson?: string | null;
}

@InputType()
export class CommitOrgUnitTreeDraftMoveInput {
  @Field(() => ID)
  @IsString()
  id!: string;

  /**
   * Where the unit lands: an id, or `null` for the top level.
   *
   * Required, unlike `UpdateOrgUnitInput.parentId` — a draft move exists to
   * state a destination, so there is no "leave it alone" case to express.
   * Making it optional would give the same field name two opposite readings a
   * few lines apart in this file, which is precisely the trap
   * `UpdateOrgUnitInput.parentId` was fixed to remove.
   */
  @Field(() => ID, { nullable: true })
  @ValidateIf((_move, value): boolean => value !== null)
  @IsString({
    message: 'parentId must be an org unit id, or null for the top level',
  })
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
