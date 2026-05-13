import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('approval_template_categories')
@ObjectType('ApprovalTemplateCategory')
export class ApprovalTemplateCategoryEntity {
  @PrimaryGeneratedColumn('uuid')
  @Field(() => ID)
  id!: string;

  @Column('text')
  @Field()
  name!: string;

  @Column('text', { nullable: true })
  @Field(() => String, { nullable: true })
  description!: string | null;

  @Column('boolean', { default: true, name: 'is_active' })
  @Field()
  isActive!: boolean;

  @Column('int', { default: 0, name: 'sort_order' })
  @Field(() => Int)
  sortOrder!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  @Field()
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  @Field()
  updatedAt!: Date;
}
