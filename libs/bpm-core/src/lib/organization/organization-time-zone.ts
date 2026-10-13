/**
 * Zone in which organization effective dates are read when the host does not
 * set `organizationTimeZone`: the product's business time zone.
 */
export const DEFAULT_BPM_ORGANIZATION_TIME_ZONE = 'Asia/Taipei';

/**
 * Root option for how BPM decides what "today" is when it compares against the
 * date-only `effectiveFrom` / `effectiveTo` of memberships and manager
 * resolutions.
 */
export interface BPMRootOrganizationOptions {
  /**
   * IANA time zone (for example `'Asia/Taipei'`) in which "today" is read when
   * BPM compares against a membership's or manager resolution's date-only
   * `effectiveFrom` / `effectiveTo`: manager chains, direct managers, position
   * and org-unit candidates, the default initiator snapshot, SLA escalation,
   * and the "active only" organization views.
   *
   * Defaults to `'Asia/Taipei'`, BPM's business time zone. Organization data
   * is kept in local dates, and between local midnight and the zone's UTC
   * offset the UTC date is still yesterday, so reading it in UTC would not
   * apply a rule effective from today yet. A host that keeps its dates in UTC
   * sets `'UTC'`. An unknown zone makes BPM fail at startup.
   *
   * Independent of `notificationSlaBusinessCalendarTimeZone`, which decides
   * business days for SLA clocks; a host may set both to the same value.
   * Effective dates are stored as given and `startAt` / `endAt` / `createdAt`
   * timestamps are compared as instants, so neither is affected.
   */
  readonly organizationTimeZone?: string;
}

/**
 * Validates `organizationTimeZone` and applies the default.
 *
 * Unlike the notification zones, which quietly fall back, an unreadable zone
 * throws: silently reading organization dates in the wrong zone would pick the
 * wrong approver with no symptom to trace it by.
 */
export function resolveBPMOrganizationTimeZone(
  value: string | null | undefined,
): string {
  const trimmedValue = value?.trim() ?? '';

  if (!trimmedValue) {
    return DEFAULT_BPM_ORGANIZATION_TIME_ZONE;
  }

  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: trimmedValue });
  } catch {
    throw new Error(
      `BPM option organizationTimeZone must be a valid IANA time zone, received "${trimmedValue}"`,
    );
  }

  return trimmedValue;
}

/**
 * Formats an instant as the `YYYY-MM-DD` calendar date it falls on in
 * `timeZone`, the shape of the date-only `effectiveFrom` / `effectiveTo`
 * columns. `timeZone` must already be validated by
 * {@link resolveBPMOrganizationTimeZone}.
 */
export function formatDateOnlyInTimeZone(
  value: Date,
  timeZone: string,
): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(value);
  const byType = new Map(
    parts.map((part): readonly [string, string] => [part.type, part.value]),
  );

  return `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}`;
}
