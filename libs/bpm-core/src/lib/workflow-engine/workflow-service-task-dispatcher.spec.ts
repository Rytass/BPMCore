import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { BPMRootModule } from '../bpm/bpm-root.module';
import { WorkflowEngineService } from './workflow-engine.service';
import {
  BPM_WORKFLOW_SERVICE_TASK_DISPATCHER,
  BPMWorkflowServiceTaskDispatcher,
  DefaultWorkflowServiceTaskDispatcher,
} from './workflow-service-task-dispatcher.token';

jest.mock('@rytass/storages-adapter-local', () => ({
  LocalStorage: class {
    async write(): Promise<{ readonly key: string }> {
      return { key: 'file.bin' };
    }
  },
}));

const hostGlobalDispatcher: BPMWorkflowServiceTaskDispatcher = {
  dispatchWebhook: jest.fn(),
};

@Global()
@Module({
  providers: [
    {
      provide: getDataSourceToken(),
      useValue: {
        entityMetadatas: [] as readonly unknown[],
        getRepository: (): unknown => ({}),
        options: { type: 'postgres' },
      },
    },
  ],
  exports: [getDataSourceToken()],
})
class FakeDataSourceModule {}

/**
 * A host that binds the dispatcher token from its own `@Global()` module,
 * rather than through `workflowServiceTaskDispatcherProvider`.
 */
@Global()
@Module({
  providers: [
    {
      provide: BPM_WORKFLOW_SERVICE_TASK_DISPATCHER,
      useValue: hostGlobalDispatcher,
    },
  ],
  exports: [BPM_WORKFLOW_SERVICE_TASK_DISPATCHER],
})
class HostGlobalDispatcherModule {}

/**
 * Reads the dispatcher held by **every** `WorkflowEngineService` Nest built.
 *
 * There is more than one: `FormDataSourceModule` imports the plain
 * `WorkflowEngineModule` class while `BPMRootModule` imports
 * `WorkflowEngineModule.forRoot(...)`, and Nest gives a dynamic module its own
 * instance. A provider registered on one of them therefore configures one copy;
 * asserting over all of them is what catches the difference.
 */
async function readDispatchers(
  rootModule: ReturnType<typeof BPMRootModule.forRoot>,
  hostModules: readonly unknown[] = [],
): Promise<readonly unknown[]> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      FakeDataSourceModule,
      ...(hostModules as never[]),
      rootModule,
    ],
  }).compile();

  const modules = [
    ...(
      moduleRef as unknown as {
        readonly container: { getModules(): Map<string, unknown> };
      }
    ).container
      .getModules()
      .values(),
  ];
  const dispatchers = modules.flatMap((module): readonly unknown[] => {
    const instance = (
      module as {
        readonly providers: Map<unknown, { readonly instance?: unknown }>;
      }
    ).providers.get(WorkflowEngineService)?.instance as
      | Record<string, unknown>
      | undefined;

    return instance ? [instance['serviceTaskDispatcher']] : [];
  });

  await moduleRef.close();

  return dispatchers;
}

describe('workflow service task dispatcher resolution', (): void => {
  it('keeps a host binding from its own global module', async (): Promise<void> => {
    // Registering a module-local default here would shadow this binding and
    // silently send WEBHOOK service tasks through the built-in `fetch`
    // dispatcher instead of the host's signing or queueing one.
    const dispatchers = await readDispatchers(BPMRootModule.forRoot(), [
      HostGlobalDispatcherModule,
    ]);

    expect(dispatchers).not.toHaveLength(0);
    dispatchers.forEach((dispatcher): void => {
      expect(dispatcher).toBe(hostGlobalDispatcher);
    });
  });

  it('uses the runtime instance from the async factory for every copy', async (): Promise<void> => {
    const runtimeDispatcher: BPMWorkflowServiceTaskDispatcher = {
      dispatchWebhook: jest.fn(),
    };
    const dispatchers = await readDispatchers(
      BPMRootModule.forRootAsync({
        useFactory: (): {
          readonly workflowServiceTaskDispatcher: BPMWorkflowServiceTaskDispatcher;
        } => ({ workflowServiceTaskDispatcher: runtimeDispatcher }),
      }),
    );

    expect(dispatchers).not.toHaveLength(0);
    dispatchers.forEach((dispatcher): void => {
      expect(dispatcher).toBe(runtimeDispatcher);
    });
  });

  it('honours workflowServiceTaskDispatcherProvider where it is registered', async (): Promise<void> => {
    const optionDispatcher: BPMWorkflowServiceTaskDispatcher = {
      dispatchWebhook: jest.fn(),
    };
    const dispatchers = await readDispatchers(
      BPMRootModule.forRoot({
        workflowServiceTaskDispatcherProvider: {
          provide: BPM_WORKFLOW_SERVICE_TASK_DISPATCHER,
          useValue: optionDispatcher,
        },
      }),
    );

    expect(dispatchers).toContain(optionDispatcher);
  });

  it('falls back to the built-in fetch dispatcher when nothing is configured', async (): Promise<void> => {
    const dispatchers = await readDispatchers(BPMRootModule.forRoot());

    expect(dispatchers).not.toHaveLength(0);
    dispatchers.forEach((dispatcher): void => {
      expect(dispatcher).toBeInstanceOf(DefaultWorkflowServiceTaskDispatcher);
    });
  });
});
