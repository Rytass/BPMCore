import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { ATTACHMENT_STORAGE } from '../attachment/attachment-storage.token';
import { BPM_BUSINESS_CALENDAR } from '../calendar/business-calendar.token';
import { BPM_FORM_DATA_SOURCE_REGISTRY } from '../form-data-source/form-data-source.types';
import { FormDataSourceValueResolverService } from '../form-data-source/form-data-source-value-resolver.service';
import { FormDataSourceService } from '../form-data-source/form-data-source.service';
import { ConditionService } from '../condition/condition.service';
import { BUILT_IN_EXPRESSION_FUNCTION_REGISTRY } from '../expression-function/expression-function.registry';
import {
  BPM_EXPRESSION_FUNCTION_REGISTRY,
  BPM_EXPRESSION_FUNCTIONS,
  BPMExpressionFunction,
  BPMExpressionFunctionRegistry,
} from '../expression-function/expression-function.types';
import { DefaultBPMMemberResolver } from '../identity/default-member-resolver';
import {
  BPM_MEMBER_RESOLVER,
  BPMMemberResolver,
} from '../identity/member-resolver.interface';
import { OrganizationService } from '../organization/organization.service';
import { BPMRootModule } from './bpm-root.module';
import { TemplateService } from '../template/template.service';
import {
  BPM_INITIATOR_CUSTOM_FIELDS_RESOLVER,
  BPMInitiatorCustomFieldsResolver,
} from '../workflow-engine/initiator-custom-fields-resolver.token';
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
    const useFactory = jest.fn(
      (): { readonly memberResolver: BPMMemberResolver } => ({
        memberResolver,
      }),
    );
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

  it('hands the organization time zone from the async factory to the engine and the organization service', async (): Promise<void> => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        FakeDataSourceModule,
        BPMRootModule.forRootAsync({
          useFactory: () => ({ organizationTimeZone: 'UTC' }),
        }),
      ],
    }).compile();

    try {
      expect(
        moduleRef.get(WorkflowEngineService, { strict: false }),
      ).toHaveProperty('organizationTimeZone', 'UTC');
      expect(
        moduleRef.get(OrganizationService, { strict: false }),
      ).toHaveProperty('organizationTimeZone', 'UTC');
    } finally {
      await moduleRef.close();
    }
  });

  it('reads organization dates in Asia/Taipei when the host sets no organization time zone', async (): Promise<void> => {
    const moduleRef = await Test.createTestingModule({
      imports: [FakeDataSourceModule, BPMRootModule.forRoot()],
    }).compile();

    try {
      expect(
        moduleRef.get(WorkflowEngineService, { strict: false }),
      ).toHaveProperty('organizationTimeZone', 'Asia/Taipei');
      expect(
        moduleRef.get(OrganizationService, { strict: false }),
      ).toHaveProperty('organizationTimeZone', 'Asia/Taipei');
    } finally {
      await moduleRef.close();
    }
  });

  it('fails at startup when forRoot is given an unknown organization time zone', (): void => {
    expect(() =>
      BPMRootModule.forRoot({ organizationTimeZone: 'Mars/Olympus_Mons' }),
    ).toThrow(
      'BPM option organizationTimeZone must be a valid IANA time zone, received "Mars/Olympus_Mons"',
    );
  });

  it('fails at startup when the async factory returns an unknown organization time zone', async (): Promise<void> => {
    await expect(
      Test.createTestingModule({
        imports: [
          FakeDataSourceModule,
          BPMRootModule.forRootAsync({
            useFactory: () => ({ organizationTimeZone: 'Mars/Olympus_Mons' }),
          }),
        ],
      }).compile(),
    ).rejects.toThrow(
      'BPM option organizationTimeZone must be a valid IANA time zone, received "Mars/Olympus_Mons"',
    );
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

  it('builds one WorkflowEngineService, and it holds the host initiator customFields resolver', async (): Promise<void> => {
    const resolver: BPMInitiatorCustomFieldsResolver = {
      resolveCustomFields: (): Promise<Readonly<Record<string, unknown>>> =>
        Promise.resolve({}),
    };
    const moduleRef = await Test.createTestingModule({
      imports: [
        FakeDataSourceModule,
        BPMRootModule.forRoot({
          initiatorCustomFieldsResolverProvider: {
            provide: BPM_INITIATOR_CUSTOM_FIELDS_RESOLVER,
            useValue: resolver,
          },
        }),
      ],
    }).compile();

    try {
      // FormDataSourceModule runs the launchable-template check through the
      // engine. A second engine built from the plain module class would not
      // see this resolver and would judge `customFields` as `{}`, so the list
      // and the form-data source would disagree about the same template.
      const container = (
        moduleRef as unknown as {
          readonly container: {
            getModules(): Map<
              string,
              {
                readonly providers: Map<
                  unknown,
                  { readonly instance: unknown }
                >;
              }
            >;
          };
        }
      ).container;
      const engines = [...container.getModules().values()].flatMap((module) => {
        const wrapper = module.providers.get(WorkflowEngineService);

        return wrapper?.instance ? [wrapper.instance] : [];
      });
      const formDataSourceService = moduleRef.get(FormDataSourceService, {
        strict: false,
      });
      const deliveryService = moduleRef.get(WorkflowWebhookDeliveryService, {
        strict: false,
      });

      expect(engines).toHaveLength(1);
      expect(
        Reflect.get(engines[0] as object, 'initiatorCustomFieldsResolver'),
      ).toBe(resolver);
      expect(Reflect.get(engines[0] as object, 'webhookDeliveryService')).toBe(
        deliveryService,
      );
      expect(
        Object.values(formDataSourceService as object).includes(engines[0]),
      ).toBe(true);
    } finally {
      await moduleRef.close();
    }
  });
});

describe('BPMRootModule expression functions', (): void => {
  const expressionFunction = (name: string): BPMExpressionFunction => ({
    description: name,
    handler: (): string => 'LOW',
    label: name,
    name,
    parameters: [{ name: 'amount', type: 'double' }],
    returnType: 'string',
  });
  const hostNames = (
    registry: BPMExpressionFunctionRegistry,
  ): readonly string[] =>
    registry
      .list()
      .filter((descriptor) => !descriptor.builtIn)
      .map((descriptor) => descriptor.name);

  it('offers only the built-ins when the host registers none', async (): Promise<void> => {
    const moduleRef = await Test.createTestingModule({
      imports: [FakeDataSourceModule, BPMRootModule.forRoot()],
    }).compile();

    try {
      const registry = moduleRef.get<BPMExpressionFunctionRegistry>(
        BPM_EXPRESSION_FUNCTION_REGISTRY,
      );

      expect(registry.list()).toHaveLength(9);
      expect(hostNames(registry)).toEqual([]);
      expect(registry).toBe(BUILT_IN_EXPRESSION_FUNCTION_REGISTRY);
    } finally {
      await moduleRef.close();
    }
  });

  it('combines the async factory list and the provider list', async (): Promise<void> => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        FakeDataSourceModule,
        BPMRootModule.forRootAsync({
          expressionFunctionsProvider: {
            provide: BPM_EXPRESSION_FUNCTIONS,
            useValue: [expressionFunction('erp_fromProvider_v1')],
          },
          useFactory: () => ({
            expressionFunctions: [expressionFunction('erp_fromFactory_v1')],
          }),
        }),
      ],
    }).compile();

    try {
      expect(
        hostNames(
          moduleRef.get<BPMExpressionFunctionRegistry>(
            BPM_EXPRESSION_FUNCTION_REGISTRY,
          ),
        ),
      ).toEqual(['erp_fromFactory_v1', 'erp_fromProvider_v1']);
    } finally {
      await moduleRef.close();
    }
  });

  it.each([
    [
      'forRoot',
      (): ReturnType<typeof BPMRootModule.forRoot> =>
        BPMRootModule.forRoot({
          expressionFunctions: [expressionFunction('noVersion')],
        }),
      '"noVersion" has an invalid name',
    ],
    [
      'forRootAsync',
      (): ReturnType<typeof BPMRootModule.forRootAsync> =>
        BPMRootModule.forRootAsync({
          useFactory: () => ({
            expressionFunctions: [
              {
                ...expressionFunction('erp_async_v1'),
                handler: async (): Promise<string> => 'LOW',
              } as unknown as BPMExpressionFunction,
            ],
          }),
        }),
      '"erp_async_v1" has an async or generator handler',
    ],
  ])(
    'fails the %s boot on an invalid function',
    async (_case: string, createModule, message: string): Promise<void> => {
      await expect(
        Test.createTestingModule({
          imports: [FakeDataSourceModule, createModule()],
        }).compile(),
      ).rejects.toThrow(message);
    },
  );

  // Phase 23 integration (2026-11-07): `ConditionService` injects the
  // registry optionally, so a token it cannot see would still boot, silently
  // with the built-ins only. Every copy Nest builds must hold the registry
  // and call the host function with it.
  it.each([
    [
      'forRoot',
      (): ReturnType<typeof BPMRootModule.forRoot> =>
        BPMRootModule.forRoot({
          expressionFunctions: [expressionFunction('erp_band_v1')],
        }),
    ],
    [
      'forRootAsync',
      (): ReturnType<typeof BPMRootModule.forRootAsync> =>
        BPMRootModule.forRootAsync({
          useFactory: () => ({
            expressionFunctions: [expressionFunction('erp_band_v1')],
          }),
        }),
    ],
  ])(
    'hands the registry to every ConditionService copy (%s)',
    async (_case: string, createModule): Promise<void> => {
      const moduleRef = await Test.createTestingModule({
        imports: [FakeDataSourceModule, createModule()],
      }).compile();

      try {
        const registry = moduleRef.get<BPMExpressionFunctionRegistry>(
          BPM_EXPRESSION_FUNCTION_REGISTRY,
        );
        const container = (
          moduleRef as unknown as {
            readonly container: {
              getModules(): Map<
                string,
                {
                  readonly providers: Map<
                    unknown,
                    { readonly instance: unknown }
                  >;
                }
              >;
            };
          }
        ).container;
        const services = [...container.getModules().values()].flatMap(
          (module) => {
            const wrapper = module.providers.get(ConditionService);

            return wrapper?.instance instanceof ConditionService
              ? [wrapper.instance]
              : [];
          },
        );

        expect(services.length).toBeGreaterThanOrEqual(1);
        services.forEach((service): void => {
          expect(Reflect.get(service, 'functionRegistry')).toBe(registry);
          expect(
            service.evaluateValue(
              'erp_band_v1(form.amount)',
              { form: { amount: 1 } },
              'entry',
              { allowedRootIdentifiers: ['form'], dialect: 'cel-v2' },
            ),
          ).toBe('LOW');
        });
      } finally {
        await moduleRef.close();
      }
    },
  );

  // Phase 23 P4／P5 integration: `EXPRESSION` bindings are linted by
  // `TemplateService` / `FormDataSourceService` and evaluated by the webhook
  // delivery service and the DataSource services. Those inject
  // `ConditionService` optionally, so one they could not see would boot and
  // fail every such binding closed (found by this test: without an explicit
  // token the `| null` union reached Nest as `Object`).
  it('hands the publish lint and every binding evaluator the same registry', async (): Promise<void> => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        FakeDataSourceModule,
        BPMRootModule.forRoot({
          expressionFunctions: [expressionFunction('erp_band_v1')],
        }),
      ],
    }).compile();

    try {
      const registry = moduleRef.get<BPMExpressionFunctionRegistry>(
        BPM_EXPRESSION_FUNCTION_REGISTRY,
      );
      const readRegistry = (owner: object): unknown => {
        const service: unknown = Reflect.get(owner, 'conditionService');

        return service instanceof ConditionService
          ? Reflect.get(service, 'functionRegistry')
          : null;
      };

      expect(
        readRegistry(moduleRef.get(TemplateService, { strict: false })),
      ).toBe(registry);
      expect(
        readRegistry(
          moduleRef.get(WorkflowWebhookDeliveryService, { strict: false }),
        ),
      ).toBe(registry);
      // DataSource `EXPRESSION` bindings: search, resolve (FormDataSource
      // service) and submit (the value resolver) inject it the same way.
      expect(
        readRegistry(moduleRef.get(FormDataSourceService, { strict: false })),
      ).toBe(registry);
      expect(
        readRegistry(
          moduleRef.get(FormDataSourceValueResolverService, { strict: false }),
        ),
      ).toBe(registry);
    } finally {
      await moduleRef.close();
    }
  });

  it('fails the boot when the same name comes from both sources', async (): Promise<void> => {
    await expect(
      Test.createTestingModule({
        imports: [
          FakeDataSourceModule,
          BPMRootModule.forRoot({
            expressionFunctions: [expressionFunction('erp_same_v1')],
            expressionFunctionsProvider: {
              provide: BPM_EXPRESSION_FUNCTIONS,
              useValue: [expressionFunction('erp_same_v1')],
            },
          }),
        ],
      }).compile(),
    ).rejects.toThrow('"erp_same_v1" is registered more than once');
  });
});
