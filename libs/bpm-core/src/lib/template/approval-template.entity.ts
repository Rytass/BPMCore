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
