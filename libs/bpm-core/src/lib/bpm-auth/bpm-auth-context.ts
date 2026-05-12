import { ExecutionContext, UnauthorizedException } from '@nestjs/common';

export interface BPMAuthContext {
  readonly memberId: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly permissions: readonly string[];
  readonly roles: readonly string[];
}

export interface BPMAuthContextAccessor {
  assertAuthenticated(context?: ExecutionContext): Promise<BPMAuthContext>;
  getCurrentContext(context?: ExecutionContext): Promise<BPMAuthContext | null>;
  getCurrentMemberId(context?: ExecutionContext): Promise<string>;
}

export const BPM_AUTH_CONTEXT_ACCESSOR = Symbol('BPM_AUTH_CONTEXT_ACCESSOR');

export const BPM_AUTH_MODULE_OPTIONS = Symbol('BPM_AUTH_MODULE_OPTIONS');

export async function readAuthenticatedBPMContext(
  accessor: BPMAuthContextAccessor,
  context?: ExecutionContext,
): Promise<BPMAuthContext> {
  const authContext = await accessor.assertAuthenticated(context);

  if (!authContext.memberId.trim()) {
    throw new UnauthorizedException('BPM member id is required');
  }

  return authContext;
}
