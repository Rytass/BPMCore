import {
  MembershipRecord,
  OrgUnitRecord,
  PositionRecord,
} from '@rytass/bpm-core-client/organization';

/** Today as `YYYY-MM-DD`, the clock the designer's pickers and dry run share. */
export function readTodayDateOnlyString(): string {
  return new Date().toISOString().slice(0, 10);
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
  date: string = readTodayDateOnlyString(),
): ReadonlySet<string> {
  return new Set(
    memberships
      .filter((membership) => isMembershipActiveOn(membership, date))
      .map((membership) => membership.positionId)
      .filter((positionId): positionId is string => Boolean(positionId)),
  );
}

/**
 * The positions an organization-scoped picker offers: those held by an
 * effective member inside the organization scope. Memberships that have
 * ended or not started yet do not count, the same rule the engine applies.
 */
export function readOrgScopedPositions({
  includeDescendants,
  memberships,
  orgUnitId,
  orgUnits,
  positions,
}: {
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
  );

  return positions.filter((position) => positionIds.has(position.id));
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
