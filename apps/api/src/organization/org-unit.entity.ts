import { Field, ID, ObjectType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OrgUnitTypeEnum } from './organization.enums';

@Entity('org_units')
@ObjectType('OrgUnit')
export class OrgUnitEntity {
  @PrimaryGeneratedColumn('uuid')
  @Field(() => ID)
  id!: string;

  @Column('uuid', { name: 'parent_id', nullable: true })
  @Field(() => ID, { nullable: true })
  parentId!: string | null;

  @Column('text', { unique: true })
  @Field()
  code!: string;

  @Column('text')
  @Field()
  name!: string;

  @Column('text')
  @Field(() => OrgUnitTypeEnum)
  type!: OrgUnitTypeEnum;

  @Column('ltree')
  @Field()
  path!: string;

  @Column('jsonb', { default: {} })
  metadata!: Readonly<Record<string, unknown>>;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  @Field(() => Date, { nullable: true })
  deletedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  @Field()
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  @Field()
  updatedAt!: Date;
}
