import { FormDefinitionSchema, FormUiSchema } from '@rytass/bpm-core-shared/form';
import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { FormDefinitionVersionStatusEnum } from './form.enums';

@Entity('form_definition_versions')
@ObjectType('FormDefinitionVersion')
export class FormDefinitionVersionEntity {
  @PrimaryGeneratedColumn('uuid')
  @Field(() => ID)
  id!: string;

  @Column('uuid', { name: 'form_definition_id' })
  @Field(() => ID)
  formDefinitionId!: string;

  @Column('int')
  @Field(() => Int)
  version!: number;

  @Column('text')
  @Field(() => FormDefinitionVersionStatusEnum)
  status!: FormDefinitionVersionStatusEnum;

  @Column('jsonb')
  schema!: FormDefinitionSchema;

  @Column('jsonb', { name: 'ui_schema' })
  uiSchema!: FormUiSchema;

  @Column('timestamptz', { name: 'published_at', nullable: true })
  @Field(() => Date, { nullable: true })
  publishedAt!: Date | null;

  @Column('text', { name: 'published_by_member_id', nullable: true })
  @Field(() => String, { nullable: true })
  publishedByMemberId!: string | null;

  @Column('timestamptz', { name: 'archived_at', nullable: true })
  @Field(() => Date, { nullable: true })
  archivedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  @Field()
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  @Field()
  updatedAt!: Date;

  @Field(() => String)
  get schemaJson(): string {
    return JSON.stringify(this.schema);
  }

  @Field(() => String)
  get uiSchemaJson(): string {
    return JSON.stringify(this.uiSchema);
  }
}
