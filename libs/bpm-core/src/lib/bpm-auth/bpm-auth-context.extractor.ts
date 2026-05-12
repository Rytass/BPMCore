import { ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { BPMAuthContext } from './bpm-auth-context';

interface BPMContextCarrier {
  readonly bpmAuthContext?: unknown;
}

interface BPMRequestCarrier extends BPMContextCarrier {
  readonly req?: BPMContextCarrier;
}

export function extractBPMAuthContext(
  context?: ExecutionContext,
): BPMAuthContext | null {
  if (!context) {
    return null;
  }

  const graphqlContext = GqlExecutionContext.create(context).getContext<
    BPMRequestCarrier | undefined
  >();
  const graphqlAuthContext = readBPMAuthContext(graphqlContext?.bpmAuthContext);

  if (graphqlAuthContext) {
    return graphqlAuthContext;
  }

  const requestAuthContext = readBPMAuthContext(
    graphqlContext?.req?.bpmAuthContext,
  );

  if (requestAuthContext) {
    return requestAuthContext;
  }

  const httpRequest = context
    .switchToHttp()
    .getRequest<BPMContextCarrier | undefined>();

  return readBPMAuthContext(httpRequest?.bpmAuthContext);
}

function readBPMAuthContext(value: unknown): BPMAuthContext | null {
  if (!isRecord(value)) {
    return null;
  }

  const memberId = value.memberId;

  if (typeof memberId !== 'string') {
    return null;
  }

  return {
    memberId,
    metadata: readRecord(value.metadata),
    permissions: readStringArray(value.permissions),
    roles: readStringArray(value.roles),
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> {
  return isRecord(value) ? value : {};
}

function readStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
