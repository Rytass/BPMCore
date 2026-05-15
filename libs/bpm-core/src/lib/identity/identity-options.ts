import { InjectionToken } from '@nestjs/common';

export interface BPMRootIdentityOptions {
  /**
   * Member metadata cache lifetime in milliseconds.
   */
  readonly identityMemberMetadataCacheTtlMs?: number;
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
