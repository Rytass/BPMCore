import { Field, ID, ObjectType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('form_definitions')
@ObjectType('FormDefinition')
export class FormDefinitionEntity {
  @PrimaryGeneratedColumn('uuid')
  @Field(() => ID)
  id!: string;

  @Column('text')
  @Field()
  name!: string;

  @Column('text', { nullable: true })
  @Field(() => String, { nullable: true })
  description!: string | null;

  @Column('uuid', { name: 'current_version_id', nullable: true })
  @Field(() => ID, { nullable: true })
  currentVersionId!: string | null;

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
