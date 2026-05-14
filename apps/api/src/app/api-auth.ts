import type { ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { BPMAuthContext } from '@rytass/bpm-core-nestjs-module';
import type { Request } from 'express';

interface ApiGraphQLContext {
  readonly bpmAuthContext?: BPMAuthContext | null;
  readonly req?: Request;
}

export function buildApiBPMAuthContextFromExecutionContext(
  context?: ExecutionContext,
): BPMAuthContext | null {
  if (!context) {
    return null;
  }

  const graphqlContext = GqlExecutionContext.create(context).getContext<
    ApiGraphQLContext | undefined
  >();

  if (graphqlContext?.bpmAuthContext) {
    return graphqlContext.bpmAuthContext;
  }

  return null;
}
