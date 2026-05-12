import { Field, ID, ObjectType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TaskStatusEnum } from './workflow-engine.enums';

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

  @Column('text', { name: 'original_assignee_member_id' })
  @Field()
  originalAssigneeMemberId!: string;

  @Column('text', { name: 'assignee_member_id' })
  @Field()
  assigneeMemberId!: string;

  @Column('jsonb', { name: 'delegation_chain' })
  delegationChain!: readonly Readonly<Record<string, unknown>>[];

  @Column('text')
  @Field(() => TaskStatusEnum)
  status!: TaskStatusEnum;

  @Column('timestamptz', { name: 'sla_due_at', nullable: true })
  @Field(() => Date, { nullable: true })
  slaDueAt!: Date | null;

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
}
