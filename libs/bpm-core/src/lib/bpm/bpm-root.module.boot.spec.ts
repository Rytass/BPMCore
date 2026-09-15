import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { ATTACHMENT_STORAGE } from '../attachment/attachment-storage.token';
import { BPM_BUSINESS_CALENDAR } from '../calendar/business-calendar.token';
import { BPM_FORM_DATA_SOURCE_REGISTRY } from '../form-data-source/form-data-source.types';
import { DefaultBPMMemberResolver } from '../identity/default-member-resolver';
import {
  BPM_MEMBER_RESOLVER,
  BPMMemberResolver,
} from '../identity/member-resolver.interface';
import { BPMRootModule } from './bpm-root.module';
import { WorkflowEngineService } from '../workflow-engine/workflow-engine.service';
import { WorkflowWebhookDeliveryService } from '../workflow-webhook/workflow-webhook-delivery.service';
import { WorkflowWebhookService } from '../workflow-webhook/workflow-webhook.service';
import {
  BPM_WORKFLOW_WEBHOOK_REGISTRY,
  StaticBPMWorkflowWebhookRegistry,
} from '../workflow-webhook/workflow-webhook.types';

// The built-in local storage fallback reaches `@rytass/storages-adapter-local`
// through `require`, which Jest cannot load as ESM.
jest.mock('@rytass/storages-adapter-local', () => ({
  LocalStorage: class {
    async write(): Promise<{ readonly key: string }> {
      return { key: 'file.bin' };
    }
  },
}));

/**
 * The smallest thing `TypeOrmModule.forFeature` needs to hand out repositories:
 * it looks up `entityMetadatas` to spot tree entities and then calls
 * `getRepository`. Standing this up is what lets the whole BPM module graph be
 * instantiated without a database.
 */
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
 * Wiring specs assert the shape of the returned `DynamicModule`; this one
 * asserts that Nest can actually *instantiate* it. A missing provider, an
 * unresolvable token, or a DI cycle only shows up here — typechecking and the
 * structural assertions both pass right through it.
 */
describe('BPMRootModule bootstrap', (): void => {
  it('instantiates the whole BPM graph with zero configuration', async (): Promise<void> => {
    const moduleRef = await Test.createTestingModule({
      imports: [FakeDataSourceModule, BPMRootModule.forRoot()],
    }).compile();

    try {
      expect(moduleRef.get(BPM_MEMBER_RESOLVER)).toBeInstanceOf(
        DefaultBPMMemberResolver,
      );
      expect(moduleRef.get(BPM_BUSINESS_CALENDAR)).toBeDefined();
      expect(moduleRef.get(ATTACHMENT_STORAGE)).toBeDefined();
      expect(moduleRef.get(BPM_FORM_DATA_SOURCE_REGISTRY)).toBeDefined();
      expect(moduleRef.get(BPM_WORKFLOW_WEBHOOK_REGISTRY)).toBeDefined();
      // An empty catalog is still a source: publish refuses an unknown
      // endpoint rather than "no webhooks configured at all".
      expect(moduleRef.get(WorkflowWebhookService).hasEndpointSources()).toBe(
        true,
      );
    } finally {
      await moduleRef.close();
    }
  });

  it('instantiates the whole BPM graph from an async factory resolved once', async (): Promise<void> => {
    const memberResolver: BPMMemberResolver = {
      resolve: jest.fn(),
      resolveMany: jest.fn(),
    };
    const useFactory = jest.fn((): { readonly memberResolver: BPMMemberResolver } => ({
      memberResolver,
    }));
    const moduleRef = await Test.createTestingModule({
      imports: [
        FakeDataSourceModule,
        BPMRootModule.forRootAsync({ useFactory }),
      ],
    }).compile();

    try {
      expect(moduleRef.get(BPM_MEMBER_RESOLVER)).toBe(memberResolver);
      expect(useFactory).toHaveBeenCalledTimes(1);
    } finally {
      await moduleRef.close();
    }
  });

  it('takes a webhook endpoint registry from the async factory', async (): Promise<void> => {
    const registry = new StaticBPMWorkflowWebhookRegistry([
      {
        buildRequest: async () => ({
          url: 'https://erp.example.com/hooks/bpm',
        }),
        descriptor: {
          key: 'erp.purchase-approved',
          label: 'ERP purchase order',
          parameters: [],
          version: 1,
        },
      },
    ]);
    const moduleRef = await Test.createTestingModule({
      imports: [
        FakeDataSourceModule,
        BPMRootModule.forRootAsync({
          useFactory: () => ({
            workflowWebhookAllowedUrlPatterns: [
              'https://*.example.com/hooks/*',
            ],
            workflowWebhookRegistry: registry,
          }),
        }),
      ],
    }).compile();

    try {
      const service = moduleRef.get(WorkflowWebhookService);

      expect(moduleRef.get(BPM_WORKFLOW_WEBHOOK_REGISTRY)).toBe(registry);
      expect(
        (await service.listEndpoints()).map(
          (entry) => entry.endpoint.descriptor.key,
        ),
      ).toEqual(['erp.purchase-approved']);
      expect(service.readOptions().allowedUrlPatterns).toHaveLength(1);
    } finally {
      await moduleRef.close();
    }
  });

  it('lets the wiring-time registry provider win over the runtime instance', async (): Promise<void> => {
    const endpointFor = (key: string) => ({
      buildRequest: async () => ({ url: 'https://erp.example.com/hooks/bpm' }),
      descriptor: { key, label: key, parameters: [], version: 1 },
    });
    const fromProvider = new StaticBPMWorkflowWebhookRegistry([
      endpointFor('from-provider'),
    ]);
    const moduleRef = await Test.createTestingModule({
      imports: [
        FakeDataSourceModule,
        BPMRootModule.forRoot({
          workflowWebhookRegistry: new StaticBPMWorkflowWebhookRegistry([
            endpointFor('from-runtime'),
          ]),
          workflowWebhookRegistryProvider: {
            provide: BPM_WORKFLOW_WEBHOOK_REGISTRY,
            useValue: fromProvider,
          },
        }),
      ],
    }).compile();

    try {
      expect(
        (await moduleRef.get(WorkflowWebhookService).listEndpoints()).map(
          (entry) => entry.endpoint.descriptor.key,
        ),
      ).toEqual(['from-provider']);
    } finally {
      await moduleRef.close();
    }
  });

  it('refuses to boot with a webhook registry that contradicts itself', async (): Promise<void> => {
    const duplicate = {
      buildRequest: async () => ({ url: 'https://erp.example.com/hooks/bpm' }),
      descriptor: { key: 'erp.po', label: 'PO', parameters: [], version: 1 },
    };
    const moduleRef = await Test.createTestingModule({
      imports: [
        FakeDataSourceModule,
        BPMRootModule.forRoot({
          workflowWebhookRegistry: new StaticBPMWorkflowWebhookRegistry([
            duplicate,
            duplicate,
          ]),
        }),
      ],
    }).compile();

    try {
      await expect(moduleRef.init()).rejects.toThrow(
        /erp\.po@1 is registered more than once/u,
      );
    } finally {
      // Closing a context whose init failed re-runs the failing hook.
      await moduleRef.close().catch((): void => undefined);
    }
  });

  it('hands every WorkflowEngineService copy the same webhook delivery service', async (): Promise<void> => {
    const moduleRef = await Test.createTestingModule({
      imports: [FakeDataSourceModule, BPMRootModule.forRoot()],
    }).compile();

    try {
      // Nest builds more than one engine (FormDataSourceModule imports the
      // plain class, BPMRootModule the dynamic module). Each must enqueue into
      // the one delivery service, or a NOTIFY node reached through the other
      // copy would silently queue nothing.
      const container = (
        moduleRef as unknown as {
          readonly container: {
            getModules(): Map<
              string,
              { readonly providers: Map<unknown, { readonly instance: unknown }> }
            >;
          };
        }
      ).container;
      const engines = [...container.getModules().values()].flatMap((module) => {
        const wrapper = module.providers.get(WorkflowEngineService);

        return wrapper?.instance ? [wrapper.instance] : [];
      });
      const deliveryService = moduleRef.get(WorkflowWebhookDeliveryService, {
        strict: false,
      });

      expect(engines.length).toBeGreaterThanOrEqual(2);
      engines.forEach((engine) => {
        expect(Reflect.get(engine as object, 'webhookDeliveryService')).toBe(
          deliveryService,
        );
      });
    } finally {
      await moduleRef.close();
    }
  });
});

