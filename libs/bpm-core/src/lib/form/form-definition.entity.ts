import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
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

  @Field(() => Int, { nullable: true })
  currentVersionNumber?: number | null;

  @Field(() => Date, { nullable: true })
  currentVersionCreatedAt?: Date | null;

  @Field(() => Date, { nullable: true })
  currentVersionPublishedAt?: Date | null;

  /**
   * The form is maintained by host code (ADR 27 §9). `formDefinitions` leaves
   * it out unless `includeHostManaged` is passed. Not a lock.
   */
  @Column('boolean', { default: false, name: 'host_managed' })
  @Field({
    description:
      'The form is maintained by host code. formDefinitions leaves it out unless includeHostManaged is true. Not a lock.',
  })
  hostManaged!: boolean;
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
