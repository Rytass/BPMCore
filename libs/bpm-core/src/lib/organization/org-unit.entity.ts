import { Field, ID, ObjectType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OrgUnitTypeEnum } from './organization.enums';

/**
 * Codes are unique among *live* units only.
 *
 * A plain `unique: true` on `code` would outlive the soft delete and burn the
 * code forever, while `assertOrgUnitCodeAvailable` — which ignores
 * soft-deleted rows — would keep clearing it and let the insert fail in the
 * driver instead. Keep this partial index in step with migration
 * `OrgUnitCodeActiveUnique0000000022000`.
 */
@Index('org_units_code_active_key', ['code'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
@Entity('org_units')
@ObjectType('OrgUnit')
export class OrgUnitEntity {
  @PrimaryGeneratedColumn('uuid')
  @Field(() => ID)
  id!: string;

  @Column('uuid', { name: 'parent_id', nullable: true })
  @Field(() => ID, { nullable: true })
  parentId!: string | null;

  @Column('text')
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
