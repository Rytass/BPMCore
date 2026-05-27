import { ExecutionContext, UnauthorizedException } from '@nestjs/common';

/**
 * The minimum authentication context BPM needs to make authorization
 * decisions. Hosts construct this from their own session / JWT / RBAC
 * source and surface it through `BPMRootModuleOptions.authContextFactory`.
 *
 * `roles` and `permissions` are matched against the string sets defined in
 * `BPMAdminGuard` and `BPMDesignerGuard` — see the role / permission table
 * in `libs/bpm-core/README.md` for the exact strings.
 */
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
