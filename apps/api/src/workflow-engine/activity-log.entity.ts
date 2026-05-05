import { Field, ID, ObjectType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ActivityLogEventTypeEnum } from './workflow-engine.enums';

@Entity('activity_logs')
@ObjectType('ActivityLog')
export class ActivityLogEntity {
  @PrimaryGeneratedColumn('uuid')
  @Field(() => ID)
  id!: string;

  @Column('uuid', { name: 'instance_id' })
  @Field(() => ID)
  instanceId!: string;

  @Column('text', { name: 'event_type' })
  @Field(() => ActivityLogEventTypeEnum)
  eventType!: ActivityLogEventTypeEnum;

  @Column('text', { name: 'actor_member_id', nullable: true })
  @Field(() => String, { nullable: true })
  actorMemberId!: string | null;

  @Column('text', { name: 'node_id', nullable: true })
  @Field(() => String, { nullable: true })
  nodeId!: string | null;

  @Column('uuid', { name: 'task_id', nullable: true })
  @Field(() => ID, { nullable: true })
  taskId!: string | null;

  @Column('jsonb')
  payload!: Readonly<Record<string, unknown>>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  @Field()
  createdAt!: Date;

  @Field(() => String)
  get payloadJson(): string {
    return JSON.stringify(this.payload);
  }
}
