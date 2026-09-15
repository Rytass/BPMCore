import { NotifyWebhookParameterType } from '@rytass/bpm-core-shared/workflow';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

/** A parameter as stored on a database endpoint; same shape as the registry's. */
export interface WorkflowWebhookStoredParameter {
  readonly description: string | null;
  readonly key: string;
  readonly label: string;
  readonly required: boolean;
  readonly type: NotifyWebhookParameterType;
}

/**
 * A NOTIFY webhook endpoint maintained by a BPM administrator (ADR 18
 * §3.13). Not a GraphQL type: the admin view masks every header value and
 * the signing secret, and only says whether they are set.
 */
@Entity('workflow_webhook_endpoints')
@Index('IDX_workflow_webhook_endpoints_active', ['isActive'])
@Unique('UQ_workflow_webhook_endpoints_key_version', ['key', 'version'])
export class WorkflowWebhookEndpointEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('text')
  key!: string;

  @Column('integer')
  version!: number;

  @Column('text')
  label!: string;

  @Column('text', { nullable: true })
  description!: string | null;

  @Column('jsonb', { default: () => "'[]'::jsonb" })
  parameters!: readonly WorkflowWebhookStoredParameter[];

  @Column('text')
  url!: string;

  @Column('text', { default: 'POST' })
  method!: string;

  /** Envelope of a JSON `{ name: value }` object; `null` for no headers. */
  @Column('text', { name: 'encrypted_headers', nullable: true })
  encryptedHeaders!: string | null;

  @Column('text', { name: 'encrypted_signing_secret', nullable: true })
  encryptedSigningSecret!: string | null;

  @Column('integer', { name: 'timeout_ms', nullable: true })
  timeoutMs!: number | null;

  @Column('boolean', { default: true, name: 'is_active' })
  isActive!: boolean;

  @Column('boolean', { default: false })
  deprecated!: boolean;

  @Column('timestamptz', { name: 'secret_rotated_at', nullable: true })
  secretRotatedAt!: Date | null;

  @Column('text', { name: 'created_by_member_id', nullable: true })
  createdByMemberId!: string | null;

  @Column('text', { name: 'updated_by_member_id', nullable: true })
  updatedByMemberId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

export enum WorkflowWebhookEndpointAuditActionEnum {
  CREATED = 'CREATED',
  DISABLED = 'DISABLED',
  ENABLED = 'ENABLED',
  SECRET_ROTATED = 'SECRET_ROTATED',
  TEST_SENT = 'TEST_SENT',
  UPDATED = 'UPDATED',
}

/** Who changed which fields of an endpoint, and when. Never a value. */
@Entity('workflow_webhook_endpoint_audits')
@Index('IDX_workflow_webhook_endpoint_audits_endpoint', [
  'endpointId',
  'createdAt',
])
export class WorkflowWebhookEndpointAuditEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid', { name: 'endpoint_id' })
  endpointId!: string;

  @Column('text')
  action!: WorkflowWebhookEndpointAuditActionEnum;

  @Column('jsonb', { default: () => "'[]'::jsonb", name: 'changed_fields' })
  changedFields!: readonly string[];

  @Column('text', { name: 'actor_member_id', nullable: true })
  actorMemberId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
