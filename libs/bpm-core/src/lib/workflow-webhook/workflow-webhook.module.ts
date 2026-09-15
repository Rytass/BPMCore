import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import { ModuleMetadata } from '@nestjs/common/interfaces';
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
      exports: [BPM_WORKFLOW_WEBHOOK_REGISTRY, WorkflowWebhookService],
      global: true,
      imports: [...(options.imports ?? [])],
      module: WorkflowWebhookModule,
      providers: [
        registryProvider,
        WorkflowWebhookQueries,
        WorkflowWebhookService,
      ],
    };
  }
}
