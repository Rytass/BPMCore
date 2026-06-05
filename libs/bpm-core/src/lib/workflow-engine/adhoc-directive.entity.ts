import { Field, ID, ObjectType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { NotificationChannelEnum } from '../notification/notification.enums';
import {
  AdhocDirectiveStatusEnum,
  AdhocDirectiveTypeEnum,
  AdhocPreApprovalRejectBehaviorEnum,
  AdhocTargetKindEnum,
} from './adhoc.enums';

/**
 * Instance-scoped ad-hoc directive recorded by a stage approver. Directives
 * never touch the workflow template — they only affect the single approval
 * instance they were created on:
 *
 * - COUNTERSIGN: spawn a parallel ad-hoc task next to the next user task.
 * - PRE_APPROVAL: spawn a parallel ad-hoc task on the current node that must
 *   complete before the token may advance.
 * - STAGE_NOTIFY: notify targets once the origin node's stage ends.
 * - COMPLETION_NOTIFY: notify targets once the instance reaches a terminal
 *   state (APPROVED / REJECTED / CANCELLED).
 */
@Entity('task_adhoc_directives')
@ObjectType('AdhocDirective')
export class AdhocDirectiveEntity {
  @PrimaryGeneratedColumn('uuid')
  @Field(() => ID)
  id!: string;

  @Column('uuid', { name: 'instance_id' })
  @Field(() => ID)
  instanceId!: string;

  @Column('uuid', { name: 'origin_task_id' })
  @Field(() => ID)
  originTaskId!: string;

  @Column('text', { name: 'origin_node_id' })
  @Field()
  originNodeId!: string;

  @Column('text', { name: 'created_by_member_id' })
  @Field()
  createdByMemberId!: string;

  @Column('text')
  @Field(() => AdhocDirectiveTypeEnum)
  type!: AdhocDirectiveTypeEnum;

  @Column('text', { name: 'target_kind' })
  @Field(() => AdhocTargetKindEnum)
  targetKind!: AdhocTargetKindEnum;

  @Column('jsonb', { name: 'target_value' })
  targetValue!: Readonly<Record<string, unknown>>;

  @Column('text', { name: 'on_reject', nullable: true })
  @Field(() => AdhocPreApprovalRejectBehaviorEnum, { nullable: true })
  onReject!: AdhocPreApprovalRejectBehaviorEnum | null;

  @Column('jsonb', { nullable: true })
  @Field(() => [NotificationChannelEnum], { nullable: true })
  channels!: readonly NotificationChannelEnum[] | null;

  @Column('text', { nullable: true })
  @Field(() => String, { nullable: true })
  comment!: string | null;

  @Column('text', { default: AdhocDirectiveStatusEnum.PENDING })
  @Field(() => AdhocDirectiveStatusEnum)
  status!: AdhocDirectiveStatusEnum;

  @Column('timestamptz', { name: 'consumed_at', nullable: true })
  @Field(() => Date, { nullable: true })
  consumedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  @Field()
  createdAt!: Date;

  @Field(() => String)
  get targetValueJson(): string {
    return JSON.stringify(this.targetValue);
  }
}
