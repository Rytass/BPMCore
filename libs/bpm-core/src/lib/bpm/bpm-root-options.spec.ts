import { Test } from '@nestjs/testing';

// The built-in local storage fallback loads `@rytass/storages-adapter-local`
// through `require`, which Jest cannot pull in as ESM. The adapter itself is
// covered by `attachment-storage.provider.spec.ts`; here it only needs to
// exist so the fallback branch can be resolved.
jest.mock('@rytass/storages-adapter-local', () => ({
  LocalStorage: class {
    async write(): Promise<{ readonly key: string }> {
      return { key: 'file.bin' };
    }
  },
}));

import {
  ATTACHMENT_STORAGE,
  AttachmentStorage,
} from '../attachment/attachment-storage.token';
import { attachmentStorageProvider } from '../attachment/attachment-storage.provider';
import {
  BPM_BUSINESS_CALENDAR,
  BPMBusinessCalendar,
} from '../calendar/business-calendar.token';
import { defaultBusinessCalendarProvider } from '../calendar/business-calendar.provider';
import { defaultFormDataSourceRegistryProvider } from '../form-data-source/form-data-source.provider';
import {
  BPM_FORM_DATA_SOURCE_REGISTRY,
  EmptyBPMFormDataSourceRegistry,
} from '../form-data-source/form-data-source.types';
import {
  DefaultBPMMemberResolver,
  defaultMemberResolverProvider,
} from '../identity/default-member-resolver';
import {
  BPM_MEMBER_RESOLVER,
  BPMMemberResolver,
} from '../identity/member-resolver.interface';
import { NotificationOptionsModule } from '../notification/notification-options.module';
import { defaultWorkflowServiceTaskDispatcherProvider } from '../workflow-engine/workflow-service-task-dispatcher.provider';
import {
  BPM_WORKFLOW_SERVICE_TASK_DISPATCHER,
  BPMWorkflowServiceTaskDispatcher,
  DefaultWorkflowServiceTaskDispatcher,
} from '../workflow-engine/workflow-service-task-dispatcher.token';
import {
  BPM_ROOT_OPTIONS,
  BPMRootOptionsModule,
  BPMRootRuntimeOptions,
} from './bpm-root-options';

const DEFAULT_PROVIDERS = [
  attachmentStorageProvider,
  defaultBusinessCalendarProvider,
  defaultFormDataSourceRegistryProvider,
  defaultMemberResolverProvider,
  defaultWorkflowServiceTaskDispatcherProvider,
];

function createHostRuntimeOptions(): BPMRootRuntimeOptions {
  return {
    attachmentStorage: { read: jest.fn(), write: jest.fn() } as unknown as AttachmentStorage,
    businessCalendar: {
      isBusinessDay: (): boolean => true,
      timeZone: 'Asia/Taipei',
    } as unknown as BPMBusinessCalendar,
    formDataSourceRegistry: new EmptyBPMFormDataSourceRegistry(),
    memberResolver: {
      resolve: jest.fn(),
      resolveMany: jest.fn(),
    } as unknown as BPMMemberResolver,
    workflowServiceTaskDispatcher: {
      dispatchWebhook: jest.fn(),
    } satisfies BPMWorkflowServiceTaskDispatcher,
  };
}

describe('BPMRootOptionsModule', (): void => {
  it('resolves the host factory exactly once for every consuming provider', async (): Promise<void> => {
    const useFactory = jest.fn(
      (): BPMRootRuntimeOptions => createHostRuntimeOptions(),
    );
    const testingModule = await Test.createTestingModule({
      imports: [
        NotificationOptionsModule.forRoot({}),
        BPMRootOptionsModule.forRootAsync({ useFactory }),
      ],
      providers: [...DEFAULT_PROVIDERS],
    }).compile();

    // Every default provider below injects BPM_ROOT_OPTIONS, so resolving all
    // five is what would have re-run a per-module factory five times.
    testingModule.get(ATTACHMENT_STORAGE);
    testingModule.get(BPM_BUSINESS_CALENDAR);
    testingModule.get(BPM_FORM_DATA_SOURCE_REGISTRY);
    testingModule.get(BPM_MEMBER_RESOLVER);
    testingModule.get(BPM_WORKFLOW_SERVICE_TASK_DISPATCHER);

    expect(useFactory).toHaveBeenCalledTimes(1);
  });

  it('hands every runtime instance from the factory to its injection token', async (): Promise<void> => {
    const hostOptions = createHostRuntimeOptions();
    const testingModule = await Test.createTestingModule({
      imports: [
        NotificationOptionsModule.forRoot({}),
        BPMRootOptionsModule.forRootAsync({
          useFactory: (): BPMRootRuntimeOptions => hostOptions,
        }),
      ],
      providers: [...DEFAULT_PROVIDERS],
    }).compile();

    expect(testingModule.get(ATTACHMENT_STORAGE)).toBe(
      hostOptions.attachmentStorage,
    );
    expect(testingModule.get(BPM_BUSINESS_CALENDAR)).toBe(
      hostOptions.businessCalendar,
    );
    expect(testingModule.get(BPM_FORM_DATA_SOURCE_REGISTRY)).toBe(
      hostOptions.formDataSourceRegistry,
    );
    expect(testingModule.get(BPM_MEMBER_RESOLVER)).toBe(
      hostOptions.memberResolver,
    );
    expect(testingModule.get(BPM_WORKFLOW_SERVICE_TASK_DISPATCHER)).toBe(
      hostOptions.workflowServiceTaskDispatcher,
    );
  });

  it('falls back to built-in defaults when the factory is omitted entirely', async (): Promise<void> => {
    const testingModule = await Test.createTestingModule({
      imports: [
        NotificationOptionsModule.forRoot({}),
        BPMRootOptionsModule.forRootAsync(),
      ],
      providers: [...DEFAULT_PROVIDERS],
    }).compile();

    expect(testingModule.get(BPM_ROOT_OPTIONS)).toEqual({});
    expect(testingModule.get(BPM_MEMBER_RESOLVER)).toBeInstanceOf(
      DefaultBPMMemberResolver,
    );
    expect(testingModule.get(BPM_WORKFLOW_SERVICE_TASK_DISPATCHER)).toBeInstanceOf(
      DefaultWorkflowServiceTaskDispatcher,
    );
    expect(testingModule.get(BPM_FORM_DATA_SOURCE_REGISTRY)).toBeInstanceOf(
      EmptyBPMFormDataSourceRegistry,
    );
    expect(
      (testingModule.get(BPM_BUSINESS_CALENDAR) as BPMBusinessCalendar).timeZone,
    ).toBe('UTC');
  });

  it('lets the default providers resolve without BPM_ROOT_OPTIONS at all', async (): Promise<void> => {
    // Sub-modules are usable on their own, outside BPMRootModule; the optional
    // injection is what keeps that true.
    const testingModule = await Test.createTestingModule({
      imports: [NotificationOptionsModule.forRoot({})],
      providers: [...DEFAULT_PROVIDERS],
    }).compile();

    expect(testingModule.get(BPM_MEMBER_RESOLVER)).toBeInstanceOf(
      DefaultBPMMemberResolver,
    );
  });
});
