import { Field, ID, ObjectType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApprovalTemplateCategoryEntity } from './approval-template-category.entity';

@Entity('approval_templates')
@ObjectType('ApprovalTemplate')
export class ApprovalTemplateEntity {
  @PrimaryGeneratedColumn('uuid')
  @Field(() => ID)
  id!: string;

  @Column('text')
  @Field()
  name!: string;

  @Column('text', { nullable: true })
  @Field(() => String, { nullable: true })
  description!: string | null;

  @Column('text', { nullable: true })
  @Field(() => String, { nullable: true })
  category!: string | null;

  /**
   * Read-only projection of the `category_id` column, which
   * {@link categoryDetail} owns.
   *
   * Both properties map to the same column, and TypeORM gives the relation
   * precedence on persist. While this one was writable, assigning it looked
   * like it worked and was then silently discarded by the loaded relation —
   * `updateApprovalTemplate` moved a template between categories, reported
   * success, and left `categoryId` pointing at the old one while the legacy
   * `category` string moved. Writes go through `categoryDetail`; this stays
   * for reading and for `where` clauses.
   */
  @Column({
    insert: false,
    name: 'category_id',
    nullable: true,
    type: 'uuid',
    update: false,
  })
  @Field(() => ID, { nullable: true })
  categoryId?: string | null;

  @ManyToOne(() => ApprovalTemplateCategoryEntity, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'category_id' })
  @Field(() => ApprovalTemplateCategoryEntity, { nullable: true })
  categoryDetail?: ApprovalTemplateCategoryEntity | null;

  @Column('uuid', { name: 'current_version_id', nullable: true })
  @Field(() => ID, { nullable: true })
  currentVersionId!: string | null;

  /**
   * A stable key the host declares for a template it owns (ADR 27 §6), so it
   * can find "its" template without keeping its own id registry. Unique among
   * templates that are not soft-deleted; `null` when no host claimed one.
   */
  @Column('text', { nullable: true })
  @Field(() => String, {
    description:
      'Stable key a host declares for a template it owns. Unique among templates that are not deleted; null when none was set.',
    nullable: true,
  })
  key!: string | null;

  /**
   * The template's definition is maintained by host code (ADR 27 §9). BPM's
   * template and form lists leave it out unless `includeHostManaged` is
   * passed. It is **not** a lock: anyone who reaches the template by id can
   * still change it. It also says nothing about who may start an instance;
   * that is the version's `launchMode`.
   */
  @Column('boolean', { default: false, name: 'host_managed' })
  @Field({
    description:
      'The definition is maintained by host code. Template lists leave it out unless includeHostManaged is true. Not a lock, and unrelated to launchMode (who may start an instance).',
  })
  hostManaged!: boolean;

  @Column('boolean', { default: true, name: 'is_active' })
  @Field()
  isActive!: boolean;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  @Field(() => Date, { nullable: true })
  deletedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  @Field()
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  @Field()
  updatedAt!: Date;

  @Column('text', { name: 'created_by_member_id', nullable: true })
  @Field(() => String, { nullable: true })
  createdByMemberId!: string | null;
}
