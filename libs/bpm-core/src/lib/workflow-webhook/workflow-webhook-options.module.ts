import {
  DynamicModule,
  Global,
  InjectionToken,
  Logger,
  Module,
} from '@nestjs/common';
import { ModuleMetadata } from '@nestjs/common/interfaces';
import {
  BPM_WORKFLOW_WEBHOOK_OPTIONS,
  BPMResolvedWorkflowWebhookOptions,
  BPMRootWorkflowWebhookOptions,
  readDisabledWorkflowWebhookSourceReason,
  resolveBPMWorkflowWebhookOptions,
} from './workflow-webhook-options';

const logger = new Logger('WorkflowWebhookOptions');

/**
 * Resolves the options and says why a requested `DATABASE` source was
 * dropped. The reason needs the raw input as well as the resolved result, so
 * this is the one place both exist; without it the source would vanish
 * silently and publish would only report that no source is configured.
 */
export function resolveAndReportWorkflowWebhookOptions(
  options: BPMRootWorkflowWebhookOptions,
): BPMResolvedWorkflowWebhookOptions {
  const resolved = resolveBPMWorkflowWebhookOptions(options);
  const reason = readDisabledWorkflowWebhookSourceReason(options, resolved);

  if (reason) {
    logger.warn(reason);
  }

  return resolved;
}

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
          useValue: resolveAndReportWorkflowWebhookOptions(options),
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
          ): Promise<BPMResolvedWorkflowWebhookOptions> =>
            resolveAndReportWorkflowWebhookOptions(
              await options.useFactory(...args),
            ),
        },
      ],
    };
  }
}
