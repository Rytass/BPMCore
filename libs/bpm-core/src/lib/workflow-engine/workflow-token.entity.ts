import { Field, ID, ObjectType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { WorkflowTokenStatusEnum } from './workflow-engine.enums';

@Entity('workflow_tokens')
@ObjectType('WorkflowToken')
export class WorkflowTokenEntity {
  @PrimaryGeneratedColumn('uuid')
  @Field(() => ID)
  id!: string;

  @Column('uuid', { name: 'instance_id' })
  @Field(() => ID)
  instanceId!: string;

  @Column('text', { name: 'current_node_id' })
  @Field()
  currentNodeId!: string;

  @Column('text')
  @Field(() => WorkflowTokenStatusEnum)
  status!: WorkflowTokenStatusEnum;

  @Column('uuid', { name: 'parent_token_id', nullable: true })
  @Field(() => ID, { nullable: true })
  parentTokenId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  @Field()
  createdAt!: Date;

  @Column('timestamptz', { name: 'consumed_at', nullable: true })
  @Field(() => Date, { nullable: true })
  consumedAt!: Date | null;
}
