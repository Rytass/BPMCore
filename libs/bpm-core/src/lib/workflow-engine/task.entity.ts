import { Field, ID, ObjectType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AdhocDirectiveTypeEnum } from './adhoc.enums';
import {
  TaskAssignmentTypeEnum,
  TaskStatusEnum,
} from './workflow-engine.enums';

@Entity('tasks')
@ObjectType('Task')
export class TaskEntity {
  @PrimaryGeneratedColumn('uuid')
  @Field(() => ID)
  id!: string;

  @Column('uuid', { name: 'instance_id' })
  @Field(() => ID)
  instanceId!: string;

  @Column('uuid', { name: 'token_id' })
  @Field(() => ID)
  tokenId!: string;

  @Column('text', { name: 'node_id' })
  @Field()
  nodeId!: string;

  @Column('text', { name: 'original_assignee_member_id', nullable: true })
  @Field(() => String, { nullable: true })
  originalAssigneeMemberId!: string | null;

  @Column('text', { name: 'assignee_member_id', nullable: true })
  @Field(() => String, { nullable: true })
  assigneeMemberId!: string | null;

  @Column('text', {
    default: TaskAssignmentTypeEnum.DIRECT_MEMBER,
    name: 'assignment_type',
  })
  @Field(() => TaskAssignmentTypeEnum)
  assignmentType!: TaskAssignmentTypeEnum;

  @Column('jsonb', { default: { type: 'SINGLE' }, name: 'decision_policy_snapshot' })
  decisionPolicySnapshot!: Readonly<Record<string, unknown>>;

  @Column('jsonb', { name: 'delegation_chain' })
  delegationChain!: readonly Readonly<Record<string, unknown>>[];

  @Column('text')
  @Field(() => TaskStatusEnum)
  status!: TaskStatusEnum;

  @Column('timestamptz', { name: 'sla_due_at', nullable: true })
  @Field(() => Date, { nullable: true })
  slaDueAt!: Date | null;

  @Column('boolean', { default: false, name: 'is_adhoc' })
  @Field()
  isAdhoc!: boolean;

  @Column('text', { name: 'adhoc_type', nullable: true })
  @Field(() => AdhocDirectiveTypeEnum, { nullable: true })
  adhocType!: AdhocDirectiveTypeEnum | null;

  @Column('uuid', { name: 'adhoc_origin_task_id', nullable: true })
  @Field(() => ID, { nullable: true })
  adhocOriginTaskId!: string | null;

  @Column('uuid', { name: 'adhoc_directive_id', nullable: true })
  @Field(() => ID, { nullable: true })
  adhocDirectiveId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  @Field()
  createdAt!: Date;

  @Column('timestamptz', { name: 'opened_at', nullable: true })
  @Field(() => Date, { nullable: true })
  openedAt!: Date | null;

  @Column('timestamptz', { name: 'completed_at', nullable: true })
  @Field(() => Date, { nullable: true })
  completedAt!: Date | null;

  @Field(() => String)
  get delegationChainJson(): string {
    return JSON.stringify(this.delegationChain);
  }

  @Field(() => String)
  get decisionPolicySnapshotJson(): string {
    return JSON.stringify(this.decisionPolicySnapshot);
  }

  @Field(() => [String])
  candidateMemberIds: readonly string[] = [];
}
