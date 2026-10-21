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

  /**
   * When the current SLA window began. Set when a SEQUENTIAL candidate is
   * activated; NULL means the window began at `createdAt`.
   */
  @Column('timestamptz', { name: 'sla_started_at', nullable: true })
  @Field(() => Date, { nullable: true })
  slaStartedAt!: Date | null;

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

  /**
   * Display name of the workflow node (`node.data.label`), read from the
   * instance's `workflow_snapshot` — never stored on the task row. `null`
   * when the snapshot has no node with this `nodeId` (or the task came from a
   * path that does not resolve it). An ad-hoc task keeps the label of the
   * node it was spawned on; clients add their own 臨時加簽／會簽 marker from
   * `isAdhoc` / `adhocType`.
   */
  @Field(() => String, { nullable: true })
  nodeLabel: string | null = null;

  /**
   * Whether acting on this task means filling in form fields: a non-ad-hoc
   * task on a user task whose `fieldAccess` lets its approver fill at least
   * one field (ADR 20), read from the instance's `workflow_snapshot` like
   * `nodeLabel`. Lists use it to send the approver to the instance instead of
   * offering a one-click approval the server would refuse.
   */
  @Field(() => Boolean)
  hasFillableFields = false;

  @Field(() => [String])
  candidateMemberIds: readonly string[] = [];

  /**
   * The candidates who can act on the task right now (`PENDING` or
   * `CLAIMED`), in candidate order. Equals `candidateMemberIds` except for a
   * SEQUENTIAL task, where candidates whose turn has not come are left out.
   */
  @Field(() => [String])
  openCandidateMemberIds: readonly string[] = [];
}
