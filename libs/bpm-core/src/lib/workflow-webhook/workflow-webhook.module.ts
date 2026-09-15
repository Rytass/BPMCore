import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import { ModuleMetadata } from '@nestjs/common/interfaces';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityLogEntity } from '../workflow-engine/activity-log.entity';
import { DatabaseWorkflowWebhookEndpointSource } from './workflow-webhook-database-source';
import { WorkflowWebhookDeliverySchedulerService } from './workflow-webhook-delivery-scheduler.service';
import { WorkflowWebhookDeliveryEntity } from './workflow-webhook-delivery.entity';
import { WorkflowWebhookDeliveryResolver } from './workflow-webhook-delivery.resolver';
import { WorkflowWebhookDeliveryService } from './workflow-webhook-delivery.service';
import { WorkflowWebhookDeliverySubscriber } from './workflow-webhook-delivery.subscriber';
import { WorkflowWebhookEndpointAdminResolver } from './workflow-webhook-endpoint-admin.resolver';
import { WorkflowWebhookEndpointAdminService } from './workflow-webhook-endpoint-admin.service';
import {
  WorkflowWebhookEndpointAuditEntity,
  WorkflowWebhookEndpointEntity,
} from './workflow-webhook-endpoint.entity';
import { defaultWorkflowWebhookRegistryProvider } from './workflow-webhook.provider';
import { WorkflowWebhookQueries } from './workflow-webhook.queries';
import { WorkflowWebhookService } from './workflow-webhook.service';
import {
  BPM_WORKFLOW_WEBHOOK_REGISTRY,
  BPMWorkflowWebhookRegistry,
} from './workflow-webhook.types';

export interface WorkflowWebhookModuleOptions extends Pick<
  ModuleMetadata,
  'imports'
> {
  readonly registryProvider?: Provider<BPMWorkflowWebhookRegistry>;
}

@Global()
@Module({})
export class WorkflowWebhookModule {
  static forRoot(options: WorkflowWebhookModuleOptions = {}): DynamicModule {
    const registryProvider: Provider<BPMWorkflowWebhookRegistry> =
      options.registryProvider ?? defaultWorkflowWebhookRegistryProvider;

    return {
      exports: [
        BPM_WORKFLOW_WEBHOOK_REGISTRY,
        WorkflowWebhookDeliveryService,
        WorkflowWebhookService,
      ],
      global: true,
      imports: [
        ...(options.imports ?? []),
        TypeOrmModule.forFeature([
          ActivityLogEntity,
          WorkflowWebhookDeliveryEntity,
          WorkflowWebhookEndpointAuditEntity,
          WorkflowWebhookEndpointEntity,
        ]),
      ],
      module: WorkflowWebhookModule,
      providers: [
        registryProvider,
        DatabaseWorkflowWebhookEndpointSource,
        WorkflowWebhookEndpointAdminResolver,
        WorkflowWebhookEndpointAdminService,
        WorkflowWebhookDeliveryResolver,
        WorkflowWebhookDeliverySchedulerService,
        WorkflowWebhookDeliveryService,
        WorkflowWebhookDeliverySubscriber,
        WorkflowWebhookQueries,
        WorkflowWebhookService,
      ],
    };
  }
}
