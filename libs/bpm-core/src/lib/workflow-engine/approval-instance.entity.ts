import { FormDataSourceValueSnapshots } from '@rytass/bpm-core-shared/form';
import { WorkflowDefinition } from '@rytass/bpm-core-shared/workflow';
import { Field, ID, ObjectType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApprovalInstanceStateEnum } from './workflow-engine.enums';

/**
 * `businessKey` identifies the host document an instance was submitted for.
 * It is unique per template, but only among rows that have one, and it stays
 * with the instance whatever its state: a cancelled or rejected instance still
 * holds its key. Backed by `ApprovalInstanceBusinessKey0000000026000`.
 */
@Index('approval_instances_business_key_key', ['templateId', 'businessKey'], {
  unique: true,
  where: '"business_key" IS NOT NULL',
})
@Entity('approval_instances')
@ObjectType('ApprovalInstance')
export class ApprovalInstanceEntity {
  @PrimaryGeneratedColumn('uuid')
  @Field(() => ID)
  id!: string;

  @Column('uuid', { name: 'template_id' })
  @Field(() => ID)
  templateId!: string;

  @Column('uuid', { name: 'template_version_id' })
  @Field(() => ID)
  templateVersionId!: string;

  @Column('text', { name: 'initiator_member_id' })
  @Field()
  initiatorMemberId!: string;

  /**
   * Who actually pressed submit, when that is not the applicant (an assistant,
   * or a manager filing for a subordinate). NULL on rows written before the
   * column existed, which means "the initiator submitted it themselves".
   */
  @Column('text', { name: 'submitted_by_member_id', nullable: true })
  @Field(() => String, { nullable: true })
  submittedByMemberId!: string | null;

  @Column('jsonb', { name: 'initiator_metadata_snapshot' })
  initiatorMetadataSnapshot!: Readonly<Record<string, unknown>>;

  @Column('jsonb', { name: 'workflow_snapshot' })
  workflowSnapshot!: WorkflowDefinition;

  @Column('jsonb', { name: 'form_definition_snapshot' })
  formDefinitionSnapshot!: Readonly<Record<string, unknown>>;

  @Column('jsonb', { name: 'form_data' })
  formData!: Readonly<Record<string, unknown>>;

  @Column('jsonb', {
    default: () => "'{}'::jsonb",
    name: 'form_data_option_snapshot',
  })
  formDataOptionSnapshot!: FormDataSourceValueSnapshots;

  @Column('text')
  @Field(() => ApprovalInstanceStateEnum)
  state!: ApprovalInstanceStateEnum;

  @Column('text')
  @Field()
  title!: string;

  @Column('text', { name: 'business_key', nullable: true })
  @Field(() => String, { nullable: true })
  businessKey!: string | null;

  @Column('timestamptz', { name: 'started_at' })
  @Field()
  startedAt!: Date;

  @Column('timestamptz', { name: 'completed_at', nullable: true })
  @Field(() => Date, { nullable: true })
  completedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  @Field()
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  @Field()
  updatedAt!: Date;

  @Field(() => String)
  get initiatorMetadataSnapshotJson(): string {
    return JSON.stringify(this.initiatorMetadataSnapshot);
  }

  @Field(() => String)
  get workflowSnapshotJson(): string {
    return JSON.stringify(this.workflowSnapshot);
  }

  @Field(() => String)
  get formDefinitionSnapshotJson(): string {
    return JSON.stringify(this.formDefinitionSnapshot);
  }

  @Field(() => String)
  get formDataJson(): string {
    return JSON.stringify(this.formData);
  }

  @Field(() => String)
  get formDataOptionSnapshotJson(): string {
    return JSON.stringify(this.formDataOptionSnapshot ?? {});
  }
}
