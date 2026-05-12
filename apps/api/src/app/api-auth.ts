import type { ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { BPMAuthContext } from '@bpm/core';
import type { Request } from 'express';

interface ApiGraphQLContext {
  readonly bpmAuthContext?: BPMAuthContext | null;
  readonly req?: Request;
}

export function buildApiBPMAuthContextFromRequest(
  request: Request | undefined,
): BPMAuthContext | null {
  const memberId = readHeaderValue(request, 'x-bpm-member-id');

  if (!memberId) {
    return null;
  }

  return {
    memberId,
    metadata: {
      email:
        readHeaderValue(request, 'x-bpm-member-email') ??
        `${memberId}@example.internal`,
      memberId,
      name: readHeaderValue(request, 'x-bpm-member-name') ?? memberId,
    },
    permissions: readCsvHeaderValue(request, 'x-bpm-permissions'),
    roles: readCsvHeaderValue(request, 'x-bpm-roles'),
  };
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

  return buildApiBPMAuthContextFromRequest(graphqlContext?.req);
}

function readHeaderValue(
  request: Request | undefined,
  headerName: string,
): string | null {
  const value = request?.headers[headerName];

  if (Array.isArray(value)) {
    return value[0]?.trim() || null;
  }

  return typeof value === 'string' ? value.trim() || null : null;
}

function readCsvHeaderValue(
  request: Request | undefined,
  headerName: string,
): readonly string[] {
  const value = readHeaderValue(request, headerName);

  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
