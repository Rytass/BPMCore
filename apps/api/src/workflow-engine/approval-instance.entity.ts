import { WorkflowDefinition } from '@bpm/shared/workflow';
import { Field, ID, ObjectType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApprovalInstanceStateEnum } from './workflow-engine.enums';

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

  @Column('jsonb', { name: 'initiator_metadata_snapshot' })
  initiatorMetadataSnapshot!: Readonly<Record<string, unknown>>;

  @Column('jsonb', { name: 'workflow_snapshot' })
  workflowSnapshot!: WorkflowDefinition;

  @Column('jsonb', { name: 'form_definition_snapshot' })
  formDefinitionSnapshot!: Readonly<Record<string, unknown>>;

  @Column('jsonb', { name: 'form_data' })
  formData!: Readonly<Record<string, unknown>>;

  @Column('text')
  @Field(() => ApprovalInstanceStateEnum)
  state!: ApprovalInstanceStateEnum;

  @Column('text')
  @Field()
  title!: string;

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
}
