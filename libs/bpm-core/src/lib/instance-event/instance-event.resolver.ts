import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { BPMAdminOnly } from '../bpm-auth';
import { ApprovalInstanceEventEntity } from './approval-instance-event.entity';
import { InstanceEventDeliveryService } from './instance-event.delivery.service';
import {
  APPROVAL_INSTANCE_EVENT_ENUM_TO_STATUS,
  APPROVAL_INSTANCE_EVENT_STATUS_TO_ENUM,
  ApprovalInstanceEventStatusEnum,
} from './instance-event.enums';
import {
  ApprovalInstanceEventObject,
  ApprovalInstanceEventPageObject,
} from './instance-event.object';

/** Admin access to the outbox: triage failed deliveries and retry them. */
@Resolver()
@BPMAdminOnly()
export class InstanceEventResolver {
  constructor(private readonly deliveryService: InstanceEventDeliveryService) {}

  @Query(() => ApprovalInstanceEventPageObject)
  async approvalInstanceEvents(
    @Args('instanceId', { nullable: true, type: () => ID })
    instanceId?: string | null,
    @Args('status', {
      nullable: true,
      type: () => ApprovalInstanceEventStatusEnum,
    })
    status?: ApprovalInstanceEventStatusEnum | null,
    @Args('page', { defaultValue: 1, type: () => Int }) page = 1,
    @Args('pageSize', { defaultValue: 50, type: () => Int }) pageSize = 50,
  ): Promise<ApprovalInstanceEventPageObject> {
    const result = await this.deliveryService.listEvents({
      instanceId: instanceId ?? null,
      page,
      pageSize,
      status: status ? APPROVAL_INSTANCE_EVENT_ENUM_TO_STATUS[status] : null,
    });

    return Object.assign(new ApprovalInstanceEventPageObject(), {
      items: result.items.map((row) => toObject(row)),
      total: result.total,
    });
  }

  @Mutation(() => ApprovalInstanceEventObject)
  async retryApprovalInstanceEvent(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<ApprovalInstanceEventObject> {
    return toObject(await this.deliveryService.retryFailedEvent(id));
  }
}

/**
 * Field by field, so `payload` and `claimedAt` never reach the GraphQL
 * response even if the entity gains fields later.
 */
function toObject(
  row: ApprovalInstanceEventEntity,
): ApprovalInstanceEventObject {
  return Object.assign(new ApprovalInstanceEventObject(), {
    attemptCount: row.attemptCount,
    deliveredAt: row.deliveredAt,
    id: row.id,
    instanceId: row.instanceId,
    lastError: row.lastError,
    nextAttemptAt: row.nextAttemptAt,
    occurredAt: row.occurredAt,
    seq: row.seq,
    status: APPROVAL_INSTANCE_EVENT_STATUS_TO_ENUM[row.status],
    type: row.type,
  });
}
