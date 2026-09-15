import { Provider } from '@nestjs/common';
import {
  BPM_ROOT_OPTIONS,
  BPMRootRuntimeOptions,
} from '../bpm/bpm-root-options';
import {
  BPM_WORKFLOW_WEBHOOK_REGISTRY,
  BPMWorkflowWebhookRegistry,
  EmptyBPMWorkflowWebhookRegistry,
} from './workflow-webhook.types';

/**
 * Endpoint catalog used when the host registers none: empty, so a template
 * cannot reference an endpoint and publish still refuses one that tries.
 *
 * Mirrors `defaultFormDataSourceRegistryProvider`: prefer a registry handed to
 * `BPMRootModule` as a runtime value, which a `forRootAsync` factory can build
 * once Vault is available. `BPM_ROOT_OPTIONS` is optional so this module also
 * resolves when used on its own.
 */
export const defaultWorkflowWebhookRegistryProvider: Provider<BPMWorkflowWebhookRegistry> =
  {
    inject: [{ optional: true, token: BPM_ROOT_OPTIONS }],
    provide: BPM_WORKFLOW_WEBHOOK_REGISTRY,
    useFactory: (
      rootOptions: BPMRootRuntimeOptions | undefined,
    ): BPMWorkflowWebhookRegistry =>
      rootOptions?.workflowWebhookRegistry ??
      new EmptyBPMWorkflowWebhookRegistry(),
  };
