import { DynamicModule, InjectionToken, Module, Provider } from '@nestjs/common';
import { BPM_ROOT_OPTIONS, BPMRootOptionsModule } from './bpm-root-options';
import { BPMRootModule } from './bpm-root.module';
import { PATH_METADATA } from '@nestjs/common/constants';
import { BPM_ATTACHMENT_OPTIONS } from '../attachment/attachment-options';
import { AttachmentController } from '../attachment/attachment.controller';
import { BPM_AUTH_MODULE_OPTIONS } from '../bpm-auth/bpm-auth-context';
import { BPM_IDENTITY_OPTIONS } from '../identity/identity-options';
import { defaultMemberResolverProvider } from '../identity/default-member-resolver';
import { BPM_NOTIFICATION_OPTIONS } from '../notification/notification-options';
import { BPM_SIGNATURE_OPTIONS } from '../signature/signature-options';
import {
  BPM_MEMBER_RESOLVER,
  BPMMemberResolver,
} from '../identity/member-resolver.interface';
import { ATTACHMENT_STORAGE, AttachmentStorage } from '../attachment';
import {
  BPM_BUSINESS_CALENDAR,
  BPMBusinessCalendar,
  CalendarModule,
  defaultBusinessCalendarProvider,
} from '../calendar';
import {
  BPM_WORKFLOW_SERVICE_TASK_DISPATCHER,
  BPMWorkflowWebhookDispatchInput,
  BPMWorkflowWebhookDispatchResult,
  BPMWorkflowServiceTaskDispatcher,
} from '../workflow-engine';
import {
  BPM_FORM_DATA_SOURCE_REGISTRY,
  BPMFormDataSourceRegistry,
  EmptyBPMFormDataSourceRegistry,
  FormDataSourceModule,
} from '../form-data-source';

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

  it('passes host imports to the calendar module so a host calendar can have dependencies', (): void => {
    const businessCalendarProvider: Provider<BPMBusinessCalendar> = {
      provide: BPM_BUSINESS_CALENDAR,
      useValue: {
        isBusinessDay: (): boolean => true,
        timeZone: 'Asia/Taipei',
      },
    };
    const findCalendarModule = (
      module: ReturnType<typeof BPMRootModule.forRoot>,
    ): DynamicModule | undefined =>
      (module.imports ?? []).find(
        (importedModule): importedModule is DynamicModule =>
          typeof importedModule === 'object' &&
          importedModule !== null &&
          'module' in importedModule &&
          importedModule.module === CalendarModule,
      );

    const staticModule = BPMRootModule.forRoot({
      businessCalendarProvider,
      imports: [HostProviderModule],
      memberResolverProvider: {
        provide: BPM_MEMBER_RESOLVER,
        useExisting: 'HOST_MEMBER_RESOLVER',
      },
    });
    const asyncModule = BPMRootModule.forRootAsync({
      businessCalendarProvider,
      imports: [HostProviderModule],
      memberResolverProvider: {
        provide: BPM_MEMBER_RESOLVER,
        useExisting: 'HOST_MEMBER_RESOLVER',
      },
      useFactory: (): Record<string, never> => ({}),
    });

    expect(findCalendarModule(staticModule)?.imports).toContain(
      HostProviderModule,
    );
    expect(findCalendarModule(asyncModule)?.imports).toContain(
      HostProviderModule,
    );
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

  it.each([
    {
      label: 'useClass',
      provider: {
        provide: BPM_FORM_DATA_SOURCE_REGISTRY,
        useClass: EmptyBPMFormDataSourceRegistry,
      } satisfies Provider<BPMFormDataSourceRegistry>,
    },
    {
      label: 'useFactory',
      provider: {
        provide: BPM_FORM_DATA_SOURCE_REGISTRY,
        useFactory: (): BPMFormDataSourceRegistry =>
          new EmptyBPMFormDataSourceRegistry(),
      } satisfies Provider<BPMFormDataSourceRegistry>,
    },
    {
      label: 'useExisting',
      provider: {
        provide: BPM_FORM_DATA_SOURCE_REGISTRY,
        useExisting: 'HOST_FORM_DATA_SOURCE_REGISTRY',
      } satisfies Provider<BPMFormDataSourceRegistry>,
    },
  ])(
    'forRoot forwards a DataSource registry provider using $label',
    ({ provider }): void => {
      const module = BPMRootModule.forRoot({
        formDataSourceRegistryProvider: provider,
        memberResolverProvider: {
          provide: BPM_MEMBER_RESOLVER,
          useExisting: 'HOST_MEMBER_RESOLVER',
        },
      });

      expect(findFormDataSourceModule(module)?.providers).toContain(provider);
    },
  );

  it('forRootAsync forwards the static DataSource registry provider', (): void => {
    const provider: Provider<BPMFormDataSourceRegistry> = {
      provide: BPM_FORM_DATA_SOURCE_REGISTRY,
      useExisting: 'HOST_FORM_DATA_SOURCE_REGISTRY',
    };
    const module = BPMRootModule.forRootAsync({
      formDataSourceRegistryProvider: provider,
      memberResolverProvider: {
        provide: BPM_MEMBER_RESOLVER,
        useExisting: 'HOST_MEMBER_RESOLVER',
      },
      useFactory: (): Record<string, never> => ({}),
    });

    expect(findFormDataSourceModule(module)?.providers).toContain(provider);
  });
});

function findFormDataSourceModule(
  module: ReturnType<typeof BPMRootModule.forRoot>,
): DynamicModule | undefined {
  return (module.imports ?? []).find(
    (importedModule): importedModule is DynamicModule =>
      typeof importedModule === 'object' &&
      importedModule !== null &&
      'module' in importedModule &&
      importedModule.module === FormDataSourceModule,
  );
}

describe('BPMRootModule zero-configuration wiring', (): void => {
  const OPTION_TOKENS: readonly InjectionToken[] = [
    BPM_ATTACHMENT_OPTIONS,
    BPM_AUTH_MODULE_OPTIONS,
    BPM_IDENTITY_OPTIONS,
    BPM_NOTIFICATION_OPTIONS,
    BPM_SIGNATURE_OPTIONS,
  ];

  it.each([
    { build: (): DynamicModule => BPMRootModule.forRoot(), label: 'forRoot' },
    {
      build: (): DynamicModule => BPMRootModule.forRootAsync(),
      label: 'forRootAsync',
    },
  ])('$label boots with no options at all', ({ build }): void => {
    const module = build();

    expect(findDynamicModule(module, BPMRootOptionsModule)).toBeDefined();
    expect(collectProviders(module)).toContain(defaultMemberResolverProvider);
  });

  it.each([
    { build: (): DynamicModule => BPMRootModule.forRoot(), label: 'forRoot' },
    {
      build: (): DynamicModule =>
        BPMRootModule.forRootAsync({
          useFactory: (): Record<string, never> => ({}),
        }),
      label: 'forRootAsync',
    },
  ])(
    '$label resolves every option token from the single BPM_ROOT_OPTIONS token',
    ({ build }): void => {
      // Each of these used to call the host factory itself, so a factory that
      // constructed a member resolver handed a different instance to each
      // consumer. Injecting one shared token is what makes it resolve once.
      const optionProviders = collectProviders(build()).filter(
        (provider): provider is Extract<Provider, { provide: unknown }> =>
          typeof provider === 'object' &&
          provider !== null &&
          'provide' in provider &&
          OPTION_TOKENS.includes(provider.provide as InjectionToken),
      );

      expect(optionProviders).toHaveLength(OPTION_TOKENS.length);
      optionProviders.forEach((provider): void => {
        expect((provider as { readonly inject?: unknown }).inject).toEqual([
          BPM_ROOT_OPTIONS,
        ]);
      });
    },
  );
});

function collectProviders(module: DynamicModule): readonly Provider[] {
  return (module.imports ?? []).flatMap((importedModule): readonly Provider[] =>
    typeof importedModule === 'object' &&
    importedModule !== null &&
    'providers' in importedModule
      ? [...(importedModule.providers ?? [])]
      : [],
  );
}

function findDynamicModule(
  module: DynamicModule,
  target: unknown,
): DynamicModule | undefined {
  return (module.imports ?? []).find(
    (importedModule): importedModule is DynamicModule =>
      typeof importedModule === 'object' &&
      importedModule !== null &&
      'module' in importedModule &&
      importedModule.module === target,
  );
}

describe('BPMRootModule attachment route prefix', (): void => {
  afterEach((): void => {
    // The prefix is process-wide controller metadata, so leave the default
    // behind for whatever spec runs next.
    BPMRootModule.forRoot();
  });

  it.each([
    {
      build: (): void => {
        BPMRootModule.forRoot({ attachmentRoutePrefix: '/api/attachments' });
      },
      label: 'forRoot',
    },
    {
      build: (): void => {
        BPMRootModule.forRootAsync({
          attachmentRoutePrefix: '/api/attachments',
        });
      },
      label: 'forRootAsync',
    },
  ])('$label mounts the attachment controller at the host prefix', ({
    build,
  }): void => {
    build();

    expect(
      Reflect.getMetadata(PATH_METADATA, AttachmentController),
    ).toBe('api/attachments');
  });

  it('falls back to the default prefix when the host sets none', (): void => {
    BPMRootModule.forRoot();

    expect(
      Reflect.getMetadata(PATH_METADATA, AttachmentController),
    ).toBe('attachments');
  });
});
