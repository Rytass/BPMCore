import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { BPMRootModule } from '../bpm/bpm-root.module';
import {
  BPM_INITIATOR_CUSTOM_FIELDS_RESOLVER,
  BPMInitiatorCustomFieldsResolver,
} from './initiator-custom-fields-resolver.token';
import { WorkflowEngineService } from './workflow-engine.service';

jest.mock('@rytass/storages-adapter-local', () => ({
  LocalStorage: class {
    async write(): Promise<{ readonly key: string }> {
      return { key: 'file.bin' };
    }
  },
}));

function createResolver(): BPMInitiatorCustomFieldsResolver {
  return { resolveCustomFields: jest.fn() };
}

const hostGlobalResolver = createResolver();

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
 * A host that binds the resolver token from its own `@Global()` module, rather
 * than through `initiatorCustomFieldsResolverProvider`.
 */
@Global()
@Module({
  providers: [
    {
      provide: BPM_INITIATOR_CUSTOM_FIELDS_RESOLVER,
      useValue: hostGlobalResolver,
    },
  ],
  exports: [BPM_INITIATOR_CUSTOM_FIELDS_RESOLVER],
})
class HostGlobalResolverModule {}

/**
 * Reads the resolver held by **every** `WorkflowEngineService` Nest built.
 *
 * There is more than one: `FormDataSourceModule` imports the plain
 * `WorkflowEngineModule` class while `BPMRootModule` imports
 * `WorkflowEngineModule.forRoot(...)`, and Nest gives a dynamic module its own
 * instance. A provider registered on one of them configures one copy, so
 * asserting over all of them is what tells the three ways of registering apart.
 */
async function readResolvers(
  rootModule: ReturnType<typeof BPMRootModule.forRoot>,
  hostModules: readonly unknown[] = [],
): Promise<readonly unknown[]> {
  const moduleRef = await Test.createTestingModule({
    imports: [FakeDataSourceModule, ...(hostModules as never[]), rootModule],
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
  const resolvers = modules.flatMap((module): readonly unknown[] => {
    const instance = (
      module as {
        readonly providers: Map<unknown, { readonly instance?: unknown }>;
      }
    ).providers.get(WorkflowEngineService)?.instance as
      | Record<string, unknown>
      | undefined;

    return instance ? [instance['initiatorCustomFieldsResolver']] : [];
  });

  await moduleRef.close();

  return resolvers;
}

describe('initiator customFields resolver resolution', (): void => {
  it('has none when nothing is configured', async (): Promise<void> => {
    const resolvers = await readResolvers(BPMRootModule.forRoot());

    expect(resolvers).not.toHaveLength(0);
    resolvers.forEach((resolver): void => {
      expect(resolver).toBeNull();
    });
  });

  it('uses the runtime instance from the async factory for every copy', async (): Promise<void> => {
    const runtimeResolver = createResolver();
    const resolvers = await readResolvers(
      BPMRootModule.forRootAsync({
        useFactory: (): {
          readonly initiatorCustomFieldsResolver: BPMInitiatorCustomFieldsResolver;
        } => ({ initiatorCustomFieldsResolver: runtimeResolver }),
      }),
    );

    expect(resolvers).not.toHaveLength(0);
    resolvers.forEach((resolver): void => {
      expect(resolver).toBe(runtimeResolver);
    });
  });

  it('keeps a host binding from its own global module for every copy', async (): Promise<void> => {
    const resolvers = await readResolvers(BPMRootModule.forRoot(), [
      HostGlobalResolverModule,
    ]);

    expect(resolvers).not.toHaveLength(0);
    resolvers.forEach((resolver): void => {
      expect(resolver).toBe(hostGlobalResolver);
    });
  });

  it('honours initiatorCustomFieldsResolverProvider where it is registered', async (): Promise<void> => {
    const optionResolver = createResolver();
    const resolvers = await readResolvers(
      BPMRootModule.forRoot({
        initiatorCustomFieldsResolverProvider: {
          provide: BPM_INITIATOR_CUSTOM_FIELDS_RESOLVER,
          useValue: optionResolver,
        },
      }),
    );

    expect(resolvers).toContain(optionResolver);
  });
});
