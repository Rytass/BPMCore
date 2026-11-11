import { DEFAULT_BPM_ORGANIZATION_TIME_ZONE } from '@rytass/bpm-core-shared';

const warnedTimeZones = new Set<string>();

/**
 * Applies the default to a host's `organizationTimeZone`, as the engine's
 * `resolveBPMOrganizationTimeZone` does: blank or missing reads as
 * `DEFAULT_BPM_ORGANIZATION_TIME_ZONE`. Where the engine refuses to start on a
 * zone `Intl` does not know, the browser falls back to the default and warns
 * once per value, so a typo cannot blank the designer.
 */
export function resolveOrganizationTimeZone(
  value: string | null | undefined,
): string {
  const trimmedValue = value?.trim() ?? '';

  if (!trimmedValue) {
    return DEFAULT_BPM_ORGANIZATION_TIME_ZONE;
  }

  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: trimmedValue });

    return trimmedValue;
  } catch (error: unknown) {
    if (!(error instanceof RangeError)) {
      throw error;
    }

    if (!warnedTimeZones.has(trimmedValue)) {
      warnedTimeZones.add(trimmedValue);
      console.warn(
        `[BPM] organizationTimeZone "${trimmedValue}" is not a valid IANA time zone; using "${DEFAULT_BPM_ORGANIZATION_TIME_ZONE}".`,
      );
    }

    return DEFAULT_BPM_ORGANIZATION_TIME_ZONE;
  }
}
