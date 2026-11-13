import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ApprovalInstanceEntity } from '../workflow-engine/approval-instance.entity';
import {
  BPM_INSTANCE_EVENT_STATUSES,
  BPMInstanceEventPayload,
  BPMInstanceEventStatus,
  BPMInstanceEventType,
} from './instance-event.types';

/**
 * One outbox row per instance lifecycle event (ADR 27 §1.2). Written in the
 * same transaction as the state change, delivered after commit. Mirrors
 * migration `0000000032000-host-integration-round`; `synchronize` stays off.
 */
@Entity('approval_instance_events')
@Check(
  'CHK_approval_instance_events_status',
  `"status" IN (${BPM_INSTANCE_EVENT_STATUSES.map((status: string): string => `'${status}'`).join(', ')})`,
)
@Index('IDX_approval_instance_events_due', ['status', 'nextAttemptAt'])
@Index('IDX_approval_instance_events_instance_seq', ['instanceId', 'seq'])
export class ApprovalInstanceEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * Write order, assigned by the database (migration
   * `0000000032000-host-integration-round`). Sort by this, not by `id` or
   * `occurredAt`. `bigint`, so the driver returns a string.
   */
  @Column({
    generated: 'identity',
    generatedIdentity: 'ALWAYS',
    name: 'seq',
    type: 'bigint',
    update: false,
  })
  seq!: string;

  @Column('uuid', { name: 'instance_id' })
  instanceId!: string;

  @ManyToOne(() => ApprovalInstanceEntity, {
    createForeignKeyConstraints: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    foreignKeyConstraintName: 'FK_approval_instance_events_instance',
    name: 'instance_id',
  })
  instance?: ApprovalInstanceEntity;

  @Column('text')
  type!: BPMInstanceEventType;

  @Column('jsonb')
  payload!: BPMInstanceEventPayload;

  @Column('text', { default: 'PENDING' })
  status!: BPMInstanceEventStatus;

  @Column('integer', { default: 0, name: 'attempt_count' })
  attemptCount!: number;

  @Column('timestamptz', {
    default: (): string => 'now()',
    name: 'next_attempt_at',
  })
  nextAttemptAt!: Date;

  @Column('timestamptz', { name: 'claimed_at', nullable: true })
  claimedAt!: Date | null;

  @Column('timestamptz', { name: 'delivered_at', nullable: true })
  deliveredAt!: Date | null;

  @Column('text', { name: 'last_error', nullable: true })
  lastError!: string | null;

  @Column('timestamptz', {
    default: (): string => 'now()',
    name: 'occurred_at',
  })
  occurredAt!: Date;
}
