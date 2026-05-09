import { Field, ID, ObjectType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import {
  NotificationChannelEnum,
  NotificationStatusEnum,
  NotificationTypeEnum,
} from './notification.enums';

@Entity('notifications')
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

  @Column('timestamptz', { name: 'sent_at', nullable: true })
  @Field(() => Date, { nullable: true })
  sentAt!: Date | null;

  @Column('timestamptz', { name: 'read_at', nullable: true })
  @Field(() => Date, { nullable: true })
  readAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  @Field()
  createdAt!: Date;

  @Field(() => String)
  get payloadJson(): string {
    return JSON.stringify(this.payload ?? {});
  }
}
