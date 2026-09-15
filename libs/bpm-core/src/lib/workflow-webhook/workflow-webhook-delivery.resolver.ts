import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { BPMAdminOnly, BPMCurrentMemberId } from '../bpm-auth';
import { WorkflowWebhookDeliveryEntity } from './workflow-webhook-delivery.entity';
import { WorkflowWebhookDeliveryObject } from './workflow-webhook-delivery.object';
import { WorkflowWebhookDeliveryService } from './workflow-webhook-delivery.service';

@Resolver()
@BPMAdminOnly()
export class WorkflowWebhookDeliveryResolver {
  constructor(
    private readonly deliveryService: WorkflowWebhookDeliveryService,
  ) {}

  @Query(() => [WorkflowWebhookDeliveryObject])
  async workflowWebhookDeliveries(
    @Args('instanceId', { type: () => ID }) instanceId: string,
  ): Promise<readonly WorkflowWebhookDeliveryObject[]> {
    const rows = await this.deliveryService.listInstanceDeliveries(instanceId);

    return Promise.all(rows.map((row) => this.toObject(row)));
  }

  @Mutation(() => WorkflowWebhookDeliveryObject)
  async retryWorkflowWebhookDelivery(
    @Args('id', { type: () => ID }) id: string,
    @BPMCurrentMemberId() currentMemberId?: string | null,
  ): Promise<WorkflowWebhookDeliveryObject> {
    return this.toObject(
      await this.deliveryService.retryFailedDelivery(
        id,
        currentMemberId ?? null,
      ),
    );
  }

  private async toObject(
    row: WorkflowWebhookDeliveryEntity,
  ): Promise<WorkflowWebhookDeliveryObject> {
    const endpointLabel = await this.deliveryService.readEndpointLabel(row);

    // Field by field, so nothing on the entity that is not meant for this
    // view — the frozen event with its parameters — can ride along.
    return Object.assign(new WorkflowWebhookDeliveryObject(), {
      attemptCount: row.attemptCount,
      createdAt: row.createdAt,
      endpointKey: row.endpointKey,
      endpointLabel,
      endpointVersion: row.endpointVersion,
      id: row.id,
      instanceId: row.instanceId,
      lastAttemptAt: row.lastAttemptAt,
      lastErrorCode: row.lastErrorCode,
      lastErrorDetail: row.lastErrorDetail,
      lastResponseStatus: row.lastResponseStatus,
      nextRetryAt: row.nextRetryAt,
      nodeId: row.nodeId,
      sentAt: row.sentAt,
      status: row.status,
      targetId: row.targetId,
      updatedAt: row.updatedAt,
    });
  }
}
