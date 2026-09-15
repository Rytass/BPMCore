import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import { WorkflowWebhookDeliveryStatusEnum } from './workflow-webhook-delivery.enums';

/**
 * An administrator's view of one NOTIFY webhook delivery (ADR 18 §3.10).
 *
 * Carries the outcome and nothing that reaches the receiver: no URL, no
 * headers, no parameters. `lastErrorDetail` (at most 500 characters of a
 * failing response, or an error's kind) is why this is admin-only.
 */
@ObjectType('BPMWorkflowWebhookDelivery')
export class WorkflowWebhookDeliveryObject {
  @Field(() => Int)
  attemptCount!: number;

  @Field()
  createdAt!: Date;

  @Field()
  endpointKey!: string;

  /** `null` when the endpoint is no longer registered. */
  @Field(() => String, { nullable: true })
  endpointLabel!: string | null;

  @Field(() => Int)
  endpointVersion!: number;

  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  instanceId!: string;

  @Field(() => Date, { nullable: true })
  lastAttemptAt!: Date | null;

  @Field(() => String, { nullable: true })
  lastErrorCode!: string | null;

  @Field(() => String, { nullable: true })
  lastErrorDetail!: string | null;

  @Field(() => Int, { nullable: true })
  lastResponseStatus!: number | null;

  @Field(() => Date, { nullable: true })
  nextRetryAt!: Date | null;

  @Field()
  nodeId!: string;

  @Field(() => Date, { nullable: true })
  sentAt!: Date | null;

  @Field(() => WorkflowWebhookDeliveryStatusEnum)
  status!: WorkflowWebhookDeliveryStatusEnum;

  @Field()
  targetId!: string;

  @Field()
  updatedAt!: Date;
}
