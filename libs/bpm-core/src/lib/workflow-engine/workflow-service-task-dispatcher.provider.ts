import { Provider } from '@nestjs/common';
import {
  BPM_ROOT_OPTIONS,
  BPMRootRuntimeOptions,
} from '../bpm/bpm-root-options';
import {
  BPM_WORKFLOW_SERVICE_TASK_DISPATCHER,
  BPMWorkflowServiceTaskDispatcher,
  DefaultWorkflowServiceTaskDispatcher,
} from './workflow-service-task-dispatcher.token';

/**
 * Default dispatcher for executable workflow service tasks.
 *
 * Prefers a dispatcher handed to `BPMRootModule` as a runtime value
 * (`workflowServiceTaskDispatcher`, which a `forRootAsync` factory can build
 * once its signing keys are in hand) and otherwise sends WEBHOOK service tasks
 * with the built-in `fetch` dispatcher.
 *
 * `BPM_ROOT_OPTIONS` is injected optionally so `WorkflowEngineModule` still
 * resolves when it is used on its own, outside `BPMRootModule`.
 */
export const defaultWorkflowServiceTaskDispatcherProvider: Provider<BPMWorkflowServiceTaskDispatcher> =
  {
    inject: [{ optional: true, token: BPM_ROOT_OPTIONS }],
    provide: BPM_WORKFLOW_SERVICE_TASK_DISPATCHER,
    useFactory: (
      rootOptions: BPMRootRuntimeOptions | undefined,
    ): BPMWorkflowServiceTaskDispatcher =>
      rootOptions?.workflowServiceTaskDispatcher ??
      new DefaultWorkflowServiceTaskDispatcher(),
  };
