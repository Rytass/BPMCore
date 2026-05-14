import { WorkflowDefinition } from '@rytass/bpm-core-shared/workflow';
import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApprovalTemplateVersionStatusEnum } from './template.enums';

@Entity('approval_template_versions')
@ObjectType('ApprovalTemplateVersion')
export class ApprovalTemplateVersionEntity {
  @PrimaryGeneratedColumn('uuid')
  @Field(() => ID)
  id!: string;

  @Column('uuid', { name: 'template_id' })
  @Field(() => ID)
  templateId!: string;

  @Column('int')
  @Field(() => Int)
  version!: number;

  @Column('text')
  @Field(() => ApprovalTemplateVersionStatusEnum)
  status!: ApprovalTemplateVersionStatusEnum;

  @Column('jsonb', { name: 'workflow_definition' })
  workflowDefinition!: WorkflowDefinition;

  @Column('uuid', { name: 'form_definition_version_id', nullable: true })
  @Field(() => ID, { nullable: true })
  formDefinitionVersionId!: string | null;

  @Column('text', { name: 'initiator_policy_cel', nullable: true })
  @Field(() => String, { nullable: true })
  initiatorPolicyCel!: string | null;

  @Column('jsonb', { name: 'notification_config', nullable: true })
  notificationConfig!: Readonly<Record<string, unknown>> | null;

  @Column('jsonb', { name: 'sla_defaults', nullable: true })
  slaDefaults!: Readonly<Record<string, unknown>> | null;

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
  get workflowDefinitionJson(): string {
    return JSON.stringify(this.workflowDefinition);
  }

  @Field(() => String, { nullable: true })
  get notificationConfigJson(): string | null {
    return this.notificationConfig ? JSON.stringify(this.notificationConfig) : null;
  }

  @Field(() => String, { nullable: true })
  get slaDefaultsJson(): string | null {
    return this.slaDefaults ? JSON.stringify(this.slaDefaults) : null;
  }
}
