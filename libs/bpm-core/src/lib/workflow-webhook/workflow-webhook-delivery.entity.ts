import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { WorkflowWebhookDeliveryStatusEnum } from './workflow-webhook-delivery.enums';

/**
 * The part of a webhook event that is decided when the NOTIFY node runs and
 * must not change between attempts. `deliveryId` and `attempt` are added at
 * send time.
 */
export interface WorkflowWebhookFrozenEvent {
  readonly endpoint: {
    readonly key: string;
    readonly version: number;
  };
  readonly initiator: {
    readonly memberId: string;
  };
  readonly instance: {
    readonly id: string;
    readonly templateId: string;
    readonly templateVersionId: string;
    readonly title: string;
  };
  readonly node: {
    readonly id: string;
    readonly label: string;
  };
  readonly occurredAt: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

/**
 * One queued NOTIFY webhook delivery (ADR 18 §3.5). Not a GraphQL type: the
 * admin-facing view arrives in P3 and deliberately omits
 * `lastErrorDetail` from anyone who is not an administrator.
 */
@Entity('workflow_webhook_deliveries')
@Index('IDX_workflow_webhook_deliveries_pending', [
  'status',
  'nextRetryAt',
  'createdAt',
])
@Index('IDX_workflow_webhook_deliveries_instance', ['instanceId', 'createdAt'])
@Unique('UQ_workflow_webhook_deliveries_token_target', ['tokenId', 'targetId'])
export class WorkflowWebhookDeliveryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid', { name: 'instance_id' })
  instanceId!: string;

  @Column('text', { name: 'node_id' })
  nodeId!: string;

  @Column('uuid', { name: 'token_id' })
  tokenId!: string;

  @Column('text', { name: 'target_id' })
  targetId!: string;

  @Column('text', { name: 'endpoint_key' })
  endpointKey!: string;

  @Column('integer', { name: 'endpoint_version' })
  endpointVersion!: number;

  @Column('jsonb')
  event!: WorkflowWebhookFrozenEvent;

  @Column('text')
  status!: WorkflowWebhookDeliveryStatusEnum;

  @Column('integer', { default: 0, name: 'attempt_count' })
  attemptCount!: number;

  @Column('timestamptz', { name: 'next_retry_at', nullable: true })
  nextRetryAt!: Date | null;

  @Column('timestamptz', { name: 'last_attempt_at', nullable: true })
  lastAttemptAt!: Date | null;

  @Column('integer', { name: 'last_response_status', nullable: true })
  lastResponseStatus!: number | null;

  @Column('text', { name: 'last_error_code', nullable: true })
  lastErrorCode!: string | null;

  /** Up to 500 characters of the response body. Administrators only. */
  @Column('text', { name: 'last_error_detail', nullable: true })
  lastErrorDetail!: string | null;

  @Column('timestamptz', { name: 'sent_at', nullable: true })
  sentAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
