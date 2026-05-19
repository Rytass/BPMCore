import { Module, Provider } from '@nestjs/common';
import { BPMRootModule } from './bpm-root.module';
import {
  BPM_MEMBER_RESOLVER,
  BPMMemberResolver,
} from '../identity/member-resolver.interface';
import { ATTACHMENT_STORAGE, AttachmentStorage } from '../attachment';
import {
  BPM_WORKFLOW_SERVICE_TASK_DISPATCHER,
  BPMWorkflowServiceTaskDispatcher,
} from '../workflow-engine';

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
});
