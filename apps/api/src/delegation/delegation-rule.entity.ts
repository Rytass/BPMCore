import { Field, ID, ObjectType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  DelegationRuleStatusEnum,
  DelegationScopeTypeEnum,
} from './delegation.enums';

@Entity('delegation_rules')
@ObjectType('DelegationRule')
export class DelegationRuleEntity {
  @PrimaryGeneratedColumn('uuid')
  @Field(() => ID)
  id!: string;

  @Column('text', { name: 'principal_member_id' })
  @Field()
  principalMemberId!: string;

  @Column('text', { name: 'agent_member_id' })
  @Field()
  agentMemberId!: string;

  @Column('text', { name: 'scope_type' })
  @Field(() => DelegationScopeTypeEnum)
  scopeType!: DelegationScopeTypeEnum;

  @Column('uuid', {
    array: true,
    default: () => "'{}'::uuid[]",
    name: 'scope_template_ids',
  })
  @Field(() => [String])
  scopeTemplateIds!: readonly string[];

  @Column('text', { name: 'scope_condition_cel', nullable: true })
  @Field(() => String, { nullable: true })
  scopeConditionCel!: string | null;

  @Column('int', { default: 100 })
  @Field()
  priority!: number;

  @Column('timestamptz', { name: 'start_at' })
  @Field()
  startAt!: Date;

  @Column('timestamptz', { name: 'end_at', nullable: true })
  @Field(() => Date, { nullable: true })
  endAt!: Date | null;

  @Column('boolean', { default: false, name: 'requires_confirmation' })
  @Field()
  requiresConfirmation!: boolean;

  @Column('text')
  @Field(() => DelegationRuleStatusEnum)
  status!: DelegationRuleStatusEnum;

  @Column('text', { name: 'created_by_member_id', nullable: true })
  @Field(() => String, { nullable: true })
  createdByMemberId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  @Field()
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  @Field()
  updatedAt!: Date;

  @Column('timestamptz', { name: 'revoked_at', nullable: true })
  @Field(() => Date, { nullable: true })
  revokedAt!: Date | null;

  @Column('text', { name: 'revoked_by_member_id', nullable: true })
  @Field(() => String, { nullable: true })
  revokedByMemberId!: string | null;
}
