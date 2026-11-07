import { Field, ID, ObjectType } from '@nestjs/graphql';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { ExpressionDialect } from '../condition/expression-dialect';
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

  /**
   * The engine `scopeConditionCel` is evaluated with (ADR 22 §3.3). Rows
   * written before the column existed are `cel-legacy` (migration
   * `DelegationScopeConditionDialect0000000030000`).
   */
  @Column('text', {
    default: 'cel-legacy',
    name: 'scope_condition_dialect',
  })
  @Field(() => String, {
    description:
      'Expression dialect of scopeConditionCel: cel-legacy or cel-v2.',
  })
  scopeConditionDialect!: ExpressionDialect;

  @Column('int', { default: 100 })
  @Field({
    description:
      'Higher wins when several active rules of one principal match; ties go to the rule created first.',
  })
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
