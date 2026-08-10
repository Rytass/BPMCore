import { Module, Provider } from '@nestjs/common';
import { BPMRootModule } from './bpm-root.module';
import {
  BPM_MEMBER_RESOLVER,
  BPMMemberResolver,
} from '../identity/member-resolver.interface';
import { ATTACHMENT_STORAGE, AttachmentStorage } from '../attachment';
import {
  BPM_BUSINESS_CALENDAR,
  BPMBusinessCalendar,
  defaultBusinessCalendarProvider,
} from '../calendar';
import {
  BPM_WORKFLOW_SERVICE_TASK_DISPATCHER,
  BPMWorkflowWebhookDispatchInput,
  BPMWorkflowWebhookDispatchResult,
  BPMWorkflowServiceTaskDispatcher,
} from '../workflow-engine';

const HOST_INTEGRATION_BUS = Symbol('HOST_INTEGRATION_BUS');

interface HostIntegrationBus {
  enqueueWebhook(
    input: BPMWorkflowWebhookDispatchInput,
  ): Promise<BPMWorkflowWebhookDispatchResult>;
}

@Module({
  providers: [
    {
      provide: 'HOST_MEMBER_RESOLVER',
      useValue: {},
    },
    {
      provide: 'HOST_ATTACHMENT_STORAGE',
      useValue: {},
    },
  ],
  exports: ['HOST_MEMBER_RESOLVER', 'HOST_ATTACHMENT_STORAGE'],
})
class HostProviderModule {}

@Module({
  providers: [
    {
      provide: HOST_INTEGRATION_BUS,
      useValue: {
        enqueueWebhook: jest.fn(),
      } satisfies HostIntegrationBus,
    },
  ],
  exports: [HOST_INTEGRATION_BUS],
})
class HostWorkflowIntegrationModule {}

describe('BPMRootModule', () => {
  it('passes host imports to static child modules that resolve host providers', (): void => {
    const memberResolverProvider: Provider<BPMMemberResolver> = {
      provide: BPM_MEMBER_RESOLVER,
      useExisting: 'HOST_MEMBER_RESOLVER',
    };
    const attachmentStorageProvider: Provider<AttachmentStorage> = {
      provide: ATTACHMENT_STORAGE,
      useExisting: 'HOST_ATTACHMENT_STORAGE',
    };
    const workflowServiceTaskDispatcherProvider: Provider<BPMWorkflowServiceTaskDispatcher> =
      {
        provide: BPM_WORKFLOW_SERVICE_TASK_DISPATCHER,
        useValue: {
          dispatchWebhook: jest.fn(),
        },
      };

    const module = BPMRootModule.forRoot({
      attachmentStorageProvider,
      imports: [HostProviderModule],
      memberResolverProvider,
      workflowServiceTaskDispatcherProvider,
    });
    const importedModules = module.imports ?? [];

    expect(importedModules).toContain(HostProviderModule);
    expect(
      importedModules.some(
        (importedModule) =>
          typeof importedModule === 'object' &&
          importedModule !== null &&
          'imports' in importedModule &&
          importedModule.imports?.includes(HostProviderModule),
      ),
    ).toBe(true);
    expect(
      importedModules.some(
        (importedModule) =>
          typeof importedModule === 'object' &&
          importedModule !== null &&
          'providers' in importedModule &&
          importedModule.providers?.includes(
            workflowServiceTaskDispatcherProvider,
          ),
      ),
    ).toBe(true);
  });

  it('passes a host workflow service task dispatcher factory to workflow engine module', (): void => {
    const workflowServiceTaskDispatcherProvider: Provider<BPMWorkflowServiceTaskDispatcher> =
      {
        inject: [HOST_INTEGRATION_BUS],
        provide: BPM_WORKFLOW_SERVICE_TASK_DISPATCHER,
        useFactory: (
          integrationBus: HostIntegrationBus,
        ): BPMWorkflowServiceTaskDispatcher => ({
          dispatchWebhook: (
            input: BPMWorkflowWebhookDispatchInput,
          ): Promise<BPMWorkflowWebhookDispatchResult> =>
            integrationBus.enqueueWebhook(input),
        }),
      };

    const module = BPMRootModule.forRoot({
      imports: [HostWorkflowIntegrationModule],
      memberResolverProvider: {
        provide: BPM_MEMBER_RESOLVER,
        useExisting: 'HOST_MEMBER_RESOLVER',
      },
      workflowServiceTaskDispatcherProvider,
    });
    const importedModules = module.imports ?? [];

    expect(importedModules).toContain(HostWorkflowIntegrationModule);
    expect(
      importedModules.some(
        (importedModule) =>
          typeof importedModule === 'object' &&
          importedModule !== null &&
          'providers' in importedModule &&
          importedModule.providers?.includes(
            workflowServiceTaskDispatcherProvider,
          ),
      ),
    ).toBe(true);
  });

  it('passes a host business calendar provider to the calendar module in forRoot', (): void => {
    const businessCalendarProvider: Provider<BPMBusinessCalendar> = {
      provide: BPM_BUSINESS_CALENDAR,
      useValue: {
        isBusinessDay: (): boolean => true,
        timeZone: 'Asia/Taipei',
      },
    };

    const module = BPMRootModule.forRoot({
      businessCalendarProvider,
      memberResolverProvider: {
        provide: BPM_MEMBER_RESOLVER,
        useExisting: 'HOST_MEMBER_RESOLVER',
      },
    });

    expect(
      (module.imports ?? []).some(
        (importedModule) =>
          typeof importedModule === 'object' &&
          importedModule !== null &&
          'providers' in importedModule &&
          importedModule.providers?.includes(businessCalendarProvider),
      ),
    ).toBe(true);
  });

  it('passes a host business calendar provider to the calendar module in forRootAsync', (): void => {
    const businessCalendarProvider: Provider<BPMBusinessCalendar> = {
      provide: BPM_BUSINESS_CALENDAR,
      useValue: {
        isBusinessDay: (): boolean => true,
        timeZone: 'Asia/Taipei',
      },
    };

    const module = BPMRootModule.forRootAsync({
      businessCalendarProvider,
      memberResolverProvider: {
        provide: BPM_MEMBER_RESOLVER,
        useExisting: 'HOST_MEMBER_RESOLVER',
      },
      useFactory: (): Record<string, never> => ({}),
    });

    expect(
      (module.imports ?? []).some(
        (importedModule) =>
          typeof importedModule === 'object' &&
          importedModule !== null &&
          'providers' in importedModule &&
          importedModule.providers?.includes(businessCalendarProvider),
      ),
    ).toBe(true);
  });

  it('falls back to the built-in weekday calendar when the host provides none', (): void => {
    const module = BPMRootModule.forRoot({
      memberResolverProvider: {
        provide: BPM_MEMBER_RESOLVER,
        useExisting: 'HOST_MEMBER_RESOLVER',
      },
    });

    expect(
      (module.imports ?? []).some(
        (importedModule) =>
          typeof importedModule === 'object' &&
          importedModule !== null &&
          'providers' in importedModule &&
          importedModule.providers?.includes(defaultBusinessCalendarProvider),
      ),
    ).toBe(true);
  });
});
