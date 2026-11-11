import type {
  MembershipRecord,
  OrgUnitRecord,
  PositionRecord,
} from '@rytass/bpm-core-client/organization';
import {
  readActivePositionIds,
  readOrgScopedPositions,
} from './position-scope';

const ORG_UNITS = [
  { id: 'org_hq', name: '總部', path: 'hq' },
  { id: 'org_ops', name: '營運', path: 'hq.ops' },
] as unknown as readonly OrgUnitRecord[];

const POSITIONS = [
  { id: 'pos_active', name: '主任' },
  { id: 'pos_ended', name: '離職職位' },
  { id: 'pos_future', name: '未來職位' },
] as unknown as readonly PositionRecord[];

function membership(
  overrides: Partial<MembershipRecord> & Pick<MembershipRecord, 'positionId'>,
): MembershipRecord {
  return {
    effectiveFrom: '2000-01-01',
    effectiveTo: null,
    isPrimary: false,
    memberId: 'member_a',
    orgUnitId: 'org_hq',
    ...overrides,
  } as MembershipRecord;
}

const MEMBERSHIPS: readonly MembershipRecord[] = [
  membership({ positionId: 'pos_active' }),
  membership({
    effectiveTo: '2000-12-31',
    memberId: 'member_b',
    positionId: 'pos_ended',
  }),
  membership({
    effectiveFrom: '2999-01-01',
    memberId: 'member_c',
    positionId: 'pos_future',
  }),
];

describe('readActivePositionIds', () => {
  it('keeps only positions held through a membership in effect today', () => {
    expect([...readActivePositionIds(MEMBERSHIPS)]).toEqual(['pos_active']);
  });

  it('judges the given date when one is passed', () => {
    expect(
      [...readActivePositionIds(MEMBERSHIPS, '2000-06-01')].sort(),
    ).toEqual(['pos_active', 'pos_ended']);
  });
});

describe('readOrgScopedPositions', () => {
  it('offers no position whose only holder has left', () => {
    const offered = readOrgScopedPositions({
      includeDescendants: false,
      memberships: MEMBERSHIPS,
      orgUnitId: 'org_hq',
      orgUnits: ORG_UNITS,
      positions: POSITIONS,
    });

    expect(offered.map((position) => position.id)).toEqual(['pos_active']);
  });

  it('counts descendant organizations only when included', () => {
    const base = {
      memberships: [
        membership({ orgUnitId: 'org_ops', positionId: 'pos_active' }),
      ],
      orgUnitId: 'org_hq',
      orgUnits: ORG_UNITS,
      positions: POSITIONS,
    };

    expect(
      readOrgScopedPositions({ ...base, includeDescendants: false }),
    ).toEqual([]);
    expect(
      readOrgScopedPositions({ ...base, includeDescendants: true }).map(
        (position) => position.id,
      ),
    ).toEqual(['pos_active']);
  });
});
