import 'reflect-metadata';
import { ExecutionContext, ForbiddenException, Type } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import {
  BPMAuthContext,
  BPMAuthenticatedGuard,
  BPMDesignerGuard,
  listBPMResolverHandlers,
} from '../bpm-auth';
import { ExpressionDesignerQueries } from './expression-designer.queries';

/**
 * Phase 23 P4 gate: `previewExpression` and `expressionCatalog` (and the two
 * draft-wide reads beside them) answer 403 to a member who is not a designer
 * (ADR 22 §3.8). Runs the guards Nest would attach, as
 * `organization.access.spec.ts` does.
 */

const PRINCIPALS: Readonly<Record<'admin' | 'designer' | 'user', BPMAuthContext>> = {
  admin: { memberId: 'member-admin', metadata: {}, permissions: [], roles: ['BPM_ADMIN'] },
  designer: {
    memberId: 'member-designer',
    metadata: {},
    permissions: ['bpm:template:design'],
    roles: [],
  },
  user: { memberId: 'member-user', metadata: {}, permissions: [], roles: [] },
};

const METHODS = [
  'previewExpression',
  'expressionCatalog',
  'analyzeWorkflowExpressions',
  'previewWorkflowDialectUpgrade',
] as const;

function readGuards(methodName: string): readonly Type<unknown>[] {
  const handler = (
    ExpressionDesignerQueries.prototype as unknown as Record<string, object>
  )[methodName];

  return [
    ...((Reflect.getMetadata(GUARDS_METADATA, ExpressionDesignerQueries) as
      readonly Type<unknown>[] | undefined) ?? []),
    ...((Reflect.getMetadata(GUARDS_METADATA, handler) as
      readonly Type<unknown>[] | undefined) ?? []),
  ];
}

function createContext(authContext: BPMAuthContext): ExecutionContext {
  const args = [undefined, {}, { bpmAuthContext: authContext }, undefined];

  return {
    getArgByIndex: <T = unknown>(index: number): T => args[index] as T,
    getArgs: <T extends readonly unknown[] = readonly unknown[]>(): T =>
      args as unknown as T,
    getClass: <T = unknown>(): Type<T> => Object as unknown as Type<T>,
    getHandler: (): ReturnType<ExecutionContext['getHandler']> => Object,
    getType: <TContext extends string = string>(): TContext =>
      'graphql' as TContext,
  } as unknown as ExecutionContext;
}

/** The HTTP status the designer guard answers with, or 200 when it lets through. */
function readStatus(methodName: string, principal: BPMAuthContext): number {
  try {
    readGuards(methodName)
      .filter((guard) => guard === BPMDesignerGuard)
      .forEach((): void => {
        new BPMDesignerGuard().canActivate(createContext(principal));
      });

    return 200;
  } catch (error: unknown) {
    if (error instanceof ForbiddenException) {
      return error.getStatus();
    }

    throw error;
  }
}

describe('designer expression reads (Phase 23 P4 gate)', (): void => {
  it.each(METHODS)('%s needs a signed-in designer', (method): void => {
    const guards = readGuards(method);

    expect(guards).toEqual(
      expect.arrayContaining([BPMAuthenticatedGuard, BPMDesignerGuard]),
    );
    expect(
      listBPMResolverHandlers().find(
        (handler) =>
          handler.resolverName === 'ExpressionDesignerQueries' &&
          handler.methodName === method,
      )?.access,
    ).toBe('designer');
  });

  it.each(METHODS)('%s answers 403 to a member who is not a designer', (method): void => {
    expect(readStatus(method, PRINCIPALS.user)).toBe(403);
    expect(readStatus(method, PRINCIPALS.designer)).toBe(200);
    expect(readStatus(method, PRINCIPALS.admin)).toBe(200);
  });
});
