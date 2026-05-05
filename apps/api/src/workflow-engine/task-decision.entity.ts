import { Field, ID, ObjectType } from '@nestjs/graphql';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { TaskDecisionActionEnum } from './workflow-engine.enums';

@Entity('task_decisions')
@ObjectType('TaskDecision')
export class TaskDecisionEntity {
  @PrimaryGeneratedColumn('uuid')
  @Field(() => ID)
  id!: string;

  @Column('uuid', { name: 'task_id' })
  @Field(() => ID)
  taskId!: string;

  @Column('text', { name: 'decided_by_member_id' })
  @Field()
  decidedByMemberId!: string;

  @Column('text')
  @Field(() => TaskDecisionActionEnum)
  action!: TaskDecisionActionEnum;

  @Column('text', { nullable: true })
  @Field(() => String, { nullable: true })
  comment!: string | null;

  @Column('text', { name: 'return_to_node_id', nullable: true })
  @Field(() => String, { nullable: true })
  returnToNodeId!: string | null;

  @Column('text', { name: 'transfer_to_member_id', nullable: true })
  @Field(() => String, { nullable: true })
  transferToMemberId!: string | null;

  @Column('uuid', { name: 'signature_id', nullable: true })
  @Field(() => ID, { nullable: true })
  signatureId!: string | null;

  @Column('timestamptz', { name: 'decided_at' })
  @Field()
  decidedAt!: Date;
}
