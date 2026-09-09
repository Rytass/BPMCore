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
import { BPM_WORKFLOW_SERVICE_TASK_DISPATCHER } from '../workflow-engine/workflow-service-task-dispatcher.token';
import { BPMRootModule } from './bpm-root.module';

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
      expect(moduleRef.get(BPM_WORKFLOW_SERVICE_TASK_DISPATCHER)).toBeDefined();
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
});
