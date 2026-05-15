import { Injectable, Module, Type } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BPM_AUTH_CONTEXT_ACCESSOR } from './bpm-auth-context';
import { BPMAuthenticatedGuard } from './bpm-auth.guard';
import { BPMAuthModule } from './bpm-auth.module';
import { extractBPMAuthContext } from './bpm-auth-context.extractor';

@Injectable()
class FeatureConsumer {
  constructor(readonly guard: BPMAuthenticatedGuard) {}
}

@Module({
  providers: [FeatureConsumer],
})
class FeatureModule {}

describe('BPMAuthModule', () => {
  it('makes BPMAuthenticatedGuard injectable from feature module contexts', async (): Promise<void> => {
    const moduleRef = await Test.createTestingModule({
      imports: [BPMAuthModule.forRoot(), FeatureModule],
    }).compile();

    try {
      const consumer = moduleRef.get(FeatureConsumer);

      expect(consumer.guard).toBeInstanceOf(BPMAuthenticatedGuard);
    } finally {
      await moduleRef.close();
    }
  });

  it('makes factory auth context visible to current member decorators after guard activation', async (): Promise<void> => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        BPMAuthModule.forRoot({
          contextFactory: () => ({
            memberId: 'member-from-factory',
            metadata: {},
            permissions: [],
            roles: [],
          }),
        }),
      ],
    }).compile();

    try {
      const guard = moduleRef.get(BPMAuthenticatedGuard);
      const graphqlContext: Record<string, unknown> = {};
      const executionContext = createGraphQLExecutionContext(graphqlContext);

      await expect(guard.canActivate(executionContext)).resolves.toBe(true);
      expect(extractBPMAuthContext(executionContext)?.memberId).toBe(
        'member-from-factory',
      );
      expect(graphqlContext.bpmAuthContext).toMatchObject({
        memberId: 'member-from-factory',
      });
    } finally {
      await moduleRef.close();
    }
  });

  it('keeps the auth context accessor injectable for direct host integrations', async (): Promise<void> => {
    const moduleRef = await Test.createTestingModule({
      imports: [BPMAuthModule.forRoot()],
    }).compile();

    try {
      expect(moduleRef.get(BPM_AUTH_CONTEXT_ACCESSOR)).toBeDefined();
    } finally {
      await moduleRef.close();
    }
  });
});

function createGraphQLExecutionContext(
  graphqlContext: Record<string, unknown>,
): ExecutionContext {
  const args = [undefined, {}, graphqlContext, undefined];
  const readUndefined = <T = unknown>(): T => undefined as T;

  return {
    getArgByIndex: <T = unknown>(index: number): T => args[index] as T,
    getArgs: <T extends readonly unknown[] = readonly unknown[]>(): T =>
      args as unknown as T,
    getClass: <T = unknown>(): Type<T> => FeatureConsumer as Type<T>,
    getHandler: () => FeatureConsumer.prototype.constructor,
    getType: () => 'graphql' as never,
    switchToHttp: () => ({
      getNext: readUndefined,
      getRequest: readUndefined,
      getResponse: readUndefined,
    }),
    switchToRpc: () => ({
      getContext: readUndefined,
      getData: readUndefined,
    }),
    switchToWs: () => ({
      getClient: readUndefined,
      getData: readUndefined,
      getPattern: () => '',
    }),
  };
}
