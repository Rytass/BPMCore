import { Field, ID, ObjectType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import {
  NotificationChannelEnum,
  NotificationResolutionEnum,
  NotificationStatusEnum,
  NotificationTypeEnum,
} from './notification.enums';

const ACTIONABLE_NOTIFICATION_TYPES: ReadonlySet<NotificationTypeEnum> =
  new Set([
    NotificationTypeEnum.TASK_ASSIGNED,
    NotificationTypeEnum.TASK_TRANSFERRED,
  ]);

@Entity('notifications')
@Index('IDX_notifications_pending_delivery', [
  'status',
  'nextRetryAt',
  'createdAt',
])
@ObjectType('Notification')
export class NotificationEntity {
  @PrimaryGeneratedColumn('uuid')
  @Field(() => ID)
  id!: string;

  @Column('text', { name: 'recipient_member_id' })
  @Field()
  recipientMemberId!: string;

  @Column('text')
  @Field(() => NotificationChannelEnum)
  channel!: NotificationChannelEnum;

  @Column('text')
  @Field(() => NotificationTypeEnum)
  type!: NotificationTypeEnum;

  @Column('uuid', { name: 'instance_id', nullable: true })
  @Field(() => ID, { nullable: true })
  instanceId!: string | null;

  @Column('uuid', { name: 'task_id', nullable: true })
  @Field(() => ID, { nullable: true })
  taskId!: string | null;

  @Column('text')
  @Field()
  title!: string;

  @Column('text')
  @Field()
  body!: string;

  @Column('jsonb')
  payload!: Readonly<Record<string, unknown>>;

  @Column('text')
  @Field(() => NotificationStatusEnum)
  status!: NotificationStatusEnum;

  @Column('text', { name: 'resolution', nullable: true })
  @Field(() => NotificationResolutionEnum, { nullable: true })
  resolution!: NotificationResolutionEnum | null;

  @Column('timestamptz', { name: 'resolved_at', nullable: true })
  @Field(() => Date, { nullable: true })
  resolvedAt!: Date | null;

  @Column('timestamptz', { name: 'sent_at', nullable: true })
  @Field(() => Date, { nullable: true })
  sentAt!: Date | null;

  @Column('timestamptz', { name: 'read_at', nullable: true })
  @Field(() => Date, { nullable: true })
  readAt!: Date | null;

  /**
   * When the recipient archived this notification. Archiving hides it from the
   * default list without deleting the record, so statistics and audits keep it.
   */
  @Column('timestamptz', { name: 'archived_at', nullable: true })
  @Field(() => Date, { nullable: true })
  archivedAt!: Date | null;

  @Column('integer', { name: 'attempt_count', default: 0 })
  @Field(() => Number)
  attemptCount!: number;

  @Column('timestamptz', { name: 'last_attempt_at', nullable: true })
  @Field(() => Date, { nullable: true })
  lastAttemptAt!: Date | null;

  @Column('timestamptz', { name: 'next_retry_at', nullable: true })
  @Field(() => Date, { nullable: true })
  nextRetryAt!: Date | null;

  @Column('text', { name: 'delivery_error', nullable: true })
  @Field(() => String, { nullable: true })
  deliveryError!: string | null;

  @Column('timestamptz', { name: 'delivered_at', nullable: true })
  @Field(() => Date, { nullable: true })
  deliveredAt!: Date | null;

  @Column('text', { name: 'delivery_target', nullable: true })
  @Field(() => String, { nullable: true })
  deliveryTarget!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  @Field()
  createdAt!: Date;

  @Field(() => String)
  get payloadJson(): string {
    return JSON.stringify(this.payload ?? {});
  }

  /**
   * Resolved task policy for clients rendering historical notifications.
   * New notifications also carry this value in `payload`; the nullable field
   * lets the service distinguish an old notification with no task context.
   */
  @Field(() => Boolean, { nullable: true })
  allowReject: boolean | null = null;

  /**
   * Whether the recipient can still act on this notification (i.e. it is an
   * unresolved task-assignment). Drives the inline 同意/拒絕 actions on the
   * client so they are never offered for an already-decided task.
   */
  @Field(() => Boolean)
  get actionable(): boolean {
    return (
      ACTIONABLE_NOTIFICATION_TYPES.has(this.type) && this.resolution == null
    );
  }
}
