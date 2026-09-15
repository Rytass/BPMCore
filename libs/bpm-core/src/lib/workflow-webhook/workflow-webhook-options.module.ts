import { DynamicModule, Global, InjectionToken, Module } from '@nestjs/common';
import { ModuleMetadata } from '@nestjs/common/interfaces';
import {
  BPM_WORKFLOW_WEBHOOK_OPTIONS,
  BPMRootWorkflowWebhookOptions,
  resolveBPMWorkflowWebhookOptions,
} from './workflow-webhook-options';

export interface WorkflowWebhookOptionsModuleAsyncOptions extends Pick<
  ModuleMetadata,
  'imports'
> {
  readonly inject?: readonly InjectionToken[];
  readonly useFactory: (
    ...args: readonly unknown[]
  ) => BPMRootWorkflowWebhookOptions | Promise<BPMRootWorkflowWebhookOptions>;
}

@Global()
@Module({})
export class WorkflowWebhookOptionsModule {
  static forRoot(options: BPMRootWorkflowWebhookOptions = {}): DynamicModule {
    return {
      exports: [BPM_WORKFLOW_WEBHOOK_OPTIONS],
      module: WorkflowWebhookOptionsModule,
      providers: [
        {
          provide: BPM_WORKFLOW_WEBHOOK_OPTIONS,
          useValue: resolveBPMWorkflowWebhookOptions(options),
        },
      ],
    };
  }

  static forRootAsync(
    options: WorkflowWebhookOptionsModuleAsyncOptions,
  ): DynamicModule {
    return {
      exports: [BPM_WORKFLOW_WEBHOOK_OPTIONS],
      imports: options.imports,
      module: WorkflowWebhookOptionsModule,
      providers: [
        {
          inject: [...(options.inject ?? [])],
          provide: BPM_WORKFLOW_WEBHOOK_OPTIONS,
          useFactory: async (
            ...args: readonly unknown[]
          ): Promise<ReturnType<typeof resolveBPMWorkflowWebhookOptions>> =>
            resolveBPMWorkflowWebhookOptions(await options.useFactory(...args)),
        },
      ],
    };
  }
}
