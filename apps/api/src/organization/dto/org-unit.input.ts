import { Field, ID, InputType } from '@nestjs/graphql';
import { OrgUnitTypeEnum } from '../organization.enums';

@InputType()
export class CreateOrgUnitInput {
  @Field(() => ID, { nullable: true })
  parentId!: string | null;

  @Field()
  code!: string;

  @Field()
  name!: string;

  @Field(() => OrgUnitTypeEnum)
  type!: OrgUnitTypeEnum;

  @Field({ defaultValue: '{}' })
  metadataJson!: string;
}

@InputType()
export class UpdateOrgUnitInput {
  @Field(() => ID)
  id!: string;

  @Field(() => ID, { nullable: true })
  parentId!: string | null;

  @Field(() => String, { nullable: true })
  code!: string | null;

  @Field(() => String, { nullable: true })
  name!: string | null;

  @Field(() => OrgUnitTypeEnum, { nullable: true })
  type!: OrgUnitTypeEnum | null;

  @Field(() => String, { nullable: true })
  metadataJson!: string | null;
}
