import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import { ApprovalInstanceEventStatusEnum } from './instance-event.enums';

/**
 * An administrator's view of one outbox row (ADR 27 §1). `payload` is left
 * out on purpose: it is the observer's input and is not needed to triage a
 * failed delivery. `claimedAt` is an internal lock stamp and is left out too.
 */
@ObjectType('BPMApprovalInstanceEvent')
export class ApprovalInstanceEventObject {
  @Field(() => Int)
  attemptCount!: number;

  @Field(() => Date, { nullable: true })
  deliveredAt!: Date | null;

  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  instanceId!: string;

  @Field(() => String, { nullable: true })
  lastError!: string | null;

  @Field(() => Date)
  nextAttemptAt!: Date;

  @Field(() => Date)
  occurredAt!: Date;

  /** Write order. A string, because the database column is `bigint`. */
  @Field(() => String)
  seq!: string;

  @Field(() => ApprovalInstanceEventStatusEnum)
  status!: ApprovalInstanceEventStatusEnum;

  @Field(() => String)
  type!: string;
}

/** One page of outbox rows, newest first. */
@ObjectType('BPMApprovalInstanceEventPage')
export class ApprovalInstanceEventPageObject {
  @Field(() => [ApprovalInstanceEventObject])
  items!: readonly ApprovalInstanceEventObject[];

  @Field(() => Int)
  total!: number;
}
