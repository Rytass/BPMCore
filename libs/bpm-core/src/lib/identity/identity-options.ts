import { InjectionToken } from '@nestjs/common';

export interface BPMRootIdentityOptions {
  /**
   * Member metadata cache lifetime in milliseconds.
   */
  readonly identityMemberMetadataCacheTtlMs?: number;

  /**
   * Whether BPM registers `IdentityQueries` — the `member`, `members`,
   * `memberCount`, `searchMembers`, and `cachedMembers` GraphQL queries.
   * Defaults to `true`.
   *
   * Those are common names. A host that already publishes its own member API
   * gets `MultipleFieldsWithSameNameError` from `@nestjs/graphql` the moment
   * `BPMRootModule` is mounted, and the application never starts. Set this to
   * `false` to keep `IdentityService` (and everything in BPM that depends on
   * it) while leaving the GraphQL surface entirely to the host.
   *
   * Read at module wiring time, not from a `forRootAsync` factory: Nest
   * collects resolver providers while building the schema, before any async
   * factory has run.
   */
  readonly identityRegisterResolvers?: boolean;
}

export interface BPMResolvedIdentityOptions {
  readonly memberMetadataCacheTtlMs: number;
}

export const BPM_IDENTITY_OPTIONS: InjectionToken<BPMResolvedIdentityOptions> =
  Symbol('BPM_IDENTITY_OPTIONS');

export const DEFAULT_BPM_IDENTITY_OPTIONS: BPMResolvedIdentityOptions = {
  memberMetadataCacheTtlMs: 5 * 60 * 1000,
};

export function resolveBPMIdentityOptions(
  options: BPMRootIdentityOptions = {},
): BPMResolvedIdentityOptions {
  return {
    memberMetadataCacheTtlMs: normalizePositiveInteger(
      options.identityMemberMetadataCacheTtlMs,
      DEFAULT_BPM_IDENTITY_OPTIONS.memberMetadataCacheTtlMs,
    ),
  };
}

function normalizePositiveInteger(
  value: number | undefined,
  fallback: number,
): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return fallback;
  }

  return value;
}
