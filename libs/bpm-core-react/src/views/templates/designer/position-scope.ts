import {
  MembershipRecord,
  OrgUnitRecord,
  PositionRecord,
} from '@rytass/bpm-core-client/organization';
import { DEFAULT_BPM_ORGANIZATION_TIME_ZONE } from '@rytass/bpm-core-shared';
import { useBPMOrganizationTimeZone } from '../../../lib/organization-time-zone-provider';

/**
 * Today as `YYYY-MM-DD` in the organization zone, the clock the designer's
 * pickers and dry run share. Mirrors the engine's `formatDateOnlyInTimeZone`;
 * a UTC date is one day behind Taipei between 00:00 and 08:00. `timeZone`
 * must already be resolved (see `useBPMOrganizationTimeZone`).
 */
export function readTodayDateOnlyString(
  now: Date = new Date(),
  timeZone: string = DEFAULT_BPM_ORGANIZATION_TIME_ZONE,
): string {
  const byType = new Map(
    new Intl.DateTimeFormat('en-CA', {
      day: '2-digit',
      month: '2-digit',
      timeZone,
      year: 'numeric',
    })
      .formatToParts(now)
      .map((part): readonly [string, string] => [part.type, part.value]),
  );

  return `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}`;
}

/**
 * Today in the host's organization zone (`organizationTimeZone` on the BPM
 * providers, the value the engine's `BPMRootModule` is given), read on every
 * render, so the designer judges effective dates on the engine's day.
 */
export function useOrganizationTodayDateOnlyString(): string {
  return readTodayDateOnlyString(new Date(), useBPMOrganizationTimeZone());
}

export function isMembershipActiveOn(
  membership: Pick<MembershipRecord, 'effectiveFrom' | 'effectiveTo'>,
  date: string,
): boolean {
  return (
    membership.effectiveFrom <= date &&
    (!membership.effectiveTo || membership.effectiveTo >= date)
  );
}

/**
 * The positions at least one member holds through a membership that is in
 * effect on `date`. The engine resolves a position or an organization position
 * only through such members, so a position outside this set has nobody to
 * notify or assign.
 */
export function readActivePositionIds(
  memberships: readonly MembershipRecord[],
  date: string,
): ReadonlySet<string> {
  return new Set(
    memberships
      .filter((membership) => isMembershipActiveOn(membership, date))
      .map((membership) => membership.positionId)
      .filter((positionId): positionId is string => Boolean(positionId)),
  );
}

/**
 * The positions an organization-scoped picker offers: those held by a member
 * effective on `date` inside the organization scope. Memberships that have
 * ended or not started yet do not count, the same rule the engine applies.
 */
export function readOrgScopedPositions({
  date,
  includeDescendants,
  memberships,
  orgUnitId,
  orgUnits,
  positions,
}: {
  readonly date: string;
  readonly includeDescendants: boolean;
  readonly memberships: readonly MembershipRecord[];
  readonly orgUnitId: string;
  readonly orgUnits: readonly OrgUnitRecord[];
  readonly positions: readonly PositionRecord[];
}): readonly PositionRecord[] {
  const orgUnitIds = new Set(
    readOrgUnitScopeIds(orgUnits, orgUnitId, includeDescendants),
  );
  const positionIds = readActivePositionIds(
    memberships.filter((membership) => orgUnitIds.has(membership.orgUnitId)),
    date,
  );

  return positions.filter((position) => positionIds.has(position.id));
}

/**
 * Options for an organization-scoped position picker, and whether the stored
 * position has no effective holder in that scope. A stored position outside
 * the scope stays in the options (and so selected), as the POSITION picker
 * keeps an inactive one, so the author sees what the engine will not resolve.
 */
export function readOrgPositionPickerState({
  orgUnitId,
  positionId,
  positions,
  scopedPositions,
}: {
  readonly orgUnitId: string;
  readonly positionId: string;
  readonly positions: readonly PositionRecord[];
  readonly scopedPositions: readonly PositionRecord[];
}): {
  readonly isInactive: boolean;
  readonly options: readonly PositionRecord[];
} {
  const isInactive =
    Boolean(orgUnitId.trim()) &&
    Boolean(positionId) &&
    !scopedPositions.some((position) => position.id === positionId);

  return {
    isInactive,
    options: isInactive
      ? [
          ...scopedPositions,
          ...positions.filter((position) => position.id === positionId),
        ]
      : scopedPositions,
  };
}

export function readOrgUnitScopeIds(
  orgUnits: readonly OrgUnitRecord[],
  orgUnitId: string,
  includeDescendants: boolean,
): readonly string[] {
  const orgUnit = orgUnits.find((candidate) => candidate.id === orgUnitId);

  if (!orgUnit) {
    return orgUnitId.trim() ? [orgUnitId] : [];
  }

  if (!includeDescendants) {
    return [orgUnit.id];
  }

  return orgUnits
    .filter(
      (candidate) =>
        candidate.id === orgUnit.id ||
        candidate.path.startsWith(`${orgUnit.path}.`),
    )
    .map((candidate) => candidate.id);
}
