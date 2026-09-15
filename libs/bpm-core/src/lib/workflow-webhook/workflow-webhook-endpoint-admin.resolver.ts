import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { BPMAdminOnly, BPMCurrentMemberId } from '../bpm-auth';
import {
  CreateWorkflowWebhookEndpointInput,
  UpdateWorkflowWebhookEndpointInput,
  WorkflowWebhookEndpointAuditObject,
  WorkflowWebhookEndpointManagementObject,
  WorkflowWebhookEndpointTestResultObject,
  WorkflowWebhookManagedEndpointObject,
} from './workflow-webhook-endpoint-admin.dto';
import {
  readWorkflowWebhookHeaderNames,
  WorkflowWebhookEndpointAdminService,
} from './workflow-webhook-endpoint-admin.service';
import {
  WorkflowWebhookEndpointAuditEntity,
  WorkflowWebhookEndpointEntity,
} from './workflow-webhook-endpoint.entity';
import { WorkflowWebhookParameterObject } from './workflow-webhook.queries';
import { WorkflowWebhookService } from './workflow-webhook.service';

/**
 * Database webhook endpoint management (ADR 18 §3.13), administrators only.
 * Every object is mapped field by field, so an encrypted column cannot ride
 * along into a response.
 */
@Resolver()
@BPMAdminOnly()
export class WorkflowWebhookEndpointAdminResolver {
  constructor(
    private readonly adminService: WorkflowWebhookEndpointAdminService,
    private readonly webhookService: WorkflowWebhookService,
  ) {}

  @Query(() => WorkflowWebhookEndpointManagementObject)
  workflowWebhookEndpointManagement(): WorkflowWebhookEndpointManagementObject {
    return Object.assign(new WorkflowWebhookEndpointManagementObject(), {
      allowedUrlPatterns: this.webhookService
        .readOptions()
        .allowedUrlPatterns.map((pattern) => pattern.source),
      enabled: this.adminService.isEnabled(),
    });
  }

  @Query(() => [WorkflowWebhookManagedEndpointObject])
  async workflowWebhookManagedEndpoints(): Promise<
    readonly WorkflowWebhookManagedEndpointObject[]
  > {
    return (await this.adminService.list()).map((row) => this.toObject(row));
  }

  @Query(() => [WorkflowWebhookEndpointAuditObject])
  async workflowWebhookEndpointAudits(
    @Args('endpointId', { type: () => ID }) endpointId: string,
  ): Promise<readonly WorkflowWebhookEndpointAuditObject[]> {
    return (await this.adminService.listAudits(endpointId)).map((row) =>
      toAuditObject(row),
    );
  }

  @Mutation(() => WorkflowWebhookManagedEndpointObject)
  async createWorkflowWebhookEndpoint(
    @Args('input') input: CreateWorkflowWebhookEndpointInput,
    @BPMCurrentMemberId() currentMemberId?: string | null,
  ): Promise<WorkflowWebhookManagedEndpointObject> {
    return this.toObject(
      await this.adminService.create(input, currentMemberId ?? null),
    );
  }

  @Mutation(() => WorkflowWebhookManagedEndpointObject)
  async updateWorkflowWebhookEndpoint(
    @Args('input') input: UpdateWorkflowWebhookEndpointInput,
    @BPMCurrentMemberId() currentMemberId?: string | null,
  ): Promise<WorkflowWebhookManagedEndpointObject> {
    const { id, ...data } = input;

    return this.toObject(
      await this.adminService.update(id, data, currentMemberId ?? null),
    );
  }

  @Mutation(() => WorkflowWebhookManagedEndpointObject)
  async setWorkflowWebhookEndpointActive(
    @Args('id', { type: () => ID }) id: string,
    @Args('active') active: boolean,
    @BPMCurrentMemberId() currentMemberId?: string | null,
  ): Promise<WorkflowWebhookManagedEndpointObject> {
    return this.toObject(
      await this.adminService.setActive(id, active, currentMemberId ?? null),
    );
  }

  /** `signingSecret: null` stops signing. The new value is never returned. */
  @Mutation(() => WorkflowWebhookManagedEndpointObject)
  async rotateWorkflowWebhookEndpointSecret(
    @Args('id', { type: () => ID }) id: string,
    @Args('signingSecret', { nullable: true, type: () => String })
    signingSecret: string | null,
    @BPMCurrentMemberId() currentMemberId?: string | null,
  ): Promise<WorkflowWebhookManagedEndpointObject> {
    return this.toObject(
      await this.adminService.rotateSecret(
        id,
        signingSecret,
        currentMemberId ?? null,
      ),
    );
  }

  @Mutation(() => WorkflowWebhookEndpointTestResultObject)
  async testWorkflowWebhookEndpoint(
    @Args('id', { type: () => ID }) id: string,
    @BPMCurrentMemberId() currentMemberId?: string | null,
  ): Promise<WorkflowWebhookEndpointTestResultObject> {
    return Object.assign(
      new WorkflowWebhookEndpointTestResultObject(),
      await this.adminService.testSend(id, currentMemberId ?? null),
    );
  }

  private toObject(
    row: WorkflowWebhookEndpointEntity,
  ): WorkflowWebhookManagedEndpointObject {
    return Object.assign(new WorkflowWebhookManagedEndpointObject(), {
      active: row.isActive,
      createdAt: row.createdAt,
      createdByMemberId: row.createdByMemberId,
      deprecated: row.deprecated,
      description: row.description,
      hasSigningSecret: Boolean(row.encryptedSigningSecret),
      headerNames: readWorkflowWebhookHeaderNames(
        row,
        this.webhookService.readOptions().secretEncryptionKey,
      ),
      id: row.id,
      key: row.key,
      label: row.label,
      method: row.method,
      parameters: row.parameters.map((parameter) =>
        Object.assign(new WorkflowWebhookParameterObject(), {
          description: parameter.description ?? null,
          key: parameter.key,
          label: parameter.label,
          required: parameter.required,
          type: parameter.type,
        }),
      ),
      secretRotatedAt: row.secretRotatedAt,
      timeoutMs: row.timeoutMs,
      updatedAt: row.updatedAt,
      updatedByMemberId: row.updatedByMemberId,
      url: row.url,
      version: row.version,
    });
  }
}

function toAuditObject(
  row: WorkflowWebhookEndpointAuditEntity,
): WorkflowWebhookEndpointAuditObject {
  return Object.assign(new WorkflowWebhookEndpointAuditObject(), {
    action: row.action,
    actorMemberId: row.actorMemberId,
    changedFields: row.changedFields,
    createdAt: row.createdAt,
    endpointId: row.endpointId,
    id: row.id,
  });
}
