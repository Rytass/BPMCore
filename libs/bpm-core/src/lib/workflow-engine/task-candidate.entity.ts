import { Field, ID, ObjectType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TaskCandidateStatusEnum } from './workflow-engine.enums';

@Entity('task_candidates')
@ObjectType('TaskCandidate')
export class TaskCandidateEntity {
  @PrimaryGeneratedColumn('uuid')
  @Field(() => ID)
  id!: string;

  @Column('uuid', { name: 'task_id' })
  @Field(() => ID)
  taskId!: string;

  @Column('text', { name: 'member_id' })
  @Field()
  memberId!: string;

  @Column('text', { name: 'original_member_id' })
  @Field()
  originalMemberId!: string;

  @Column('text', { name: 'source_type' })
  @Field()
  sourceType!: string;

  @Column('jsonb', { name: 'delegation_chain' })
  delegationChain!: readonly Readonly<Record<string, unknown>>[];

  @Column('text')
  @Field(() => TaskCandidateStatusEnum)
  status!: TaskCandidateStatusEnum;

  @Column('timestamptz', { name: 'claimed_at', nullable: true })
  @Field(() => Date, { nullable: true })
  claimedAt!: Date | null;

  @Column('timestamptz', { name: 'decided_at', nullable: true })
  @Field(() => Date, { nullable: true })
  decidedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  @Field()
  createdAt!: Date;

  @Field(() => String)
  get delegationChainJson(): string {
    return JSON.stringify(this.delegationChain);
  }
}
