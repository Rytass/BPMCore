import type {
  MembershipRecord,
  OrgUnitRecord,
  PositionRecord,
} from '@rytass/bpm-core-client/organization';
import {
  readActivePositionIds,
  readOrgPositionPickerState,
  readOrgScopedPositions,
  readTodayDateOnlyString,
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

const TODAY = '2026-11-12';

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
    expect([...readActivePositionIds(MEMBERSHIPS, TODAY)]).toEqual([
      'pos_active',
    ]);
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
      date: TODAY,
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
      date: TODAY,
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

describe('readTodayDateOnlyString', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('reads today in the organization zone, not in UTC', () => {
    // 23:00 UTC on 11-11 is already 07:00 on 11-12 in Taipei.
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-11T23:00:00Z'));

    expect(readTodayDateOnlyString()).toBe('2026-11-12');
    expect(readTodayDateOnlyString(new Date(), 'UTC')).toBe('2026-11-11');
  });

  it('counts a membership starting on that day as active', () => {
    const starting = [
      membership({
        effectiveFrom: '2026-11-12',
        positionId: 'pos_starts_today',
      }),
    ];

    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-11T23:00:00Z'));

    expect([
      ...readActivePositionIds(starting, readTodayDateOnlyString()),
    ]).toEqual(['pos_starts_today']);
  });
});

describe('readOrgPositionPickerState', () => {
  const SCOPED = [POSITIONS[0]] as readonly PositionRecord[];

  it('flags a stored position with no effective holder in scope and keeps it selectable', () => {
    const state = readOrgPositionPickerState({
      orgUnitId: 'org_hq',
      positionId: 'pos_ended',
      positions: POSITIONS,
      scopedPositions: SCOPED,
    });

    expect(state.isInactive).toBe(true);
    expect(state.options.map((position) => position.id)).toEqual([
      'pos_active',
      'pos_ended',
    ]);
  });

  it('does not flag a position that is in scope', () => {
    const state = readOrgPositionPickerState({
      orgUnitId: 'org_hq',
      positionId: 'pos_active',
      positions: POSITIONS,
      scopedPositions: SCOPED,
    });

    expect(state.isInactive).toBe(false);
    expect(state.options).toBe(SCOPED);
  });

  it('does not flag an empty position or an unset organization', () => {
    expect(
      readOrgPositionPickerState({
        orgUnitId: 'org_hq',
        positionId: '',
        positions: POSITIONS,
        scopedPositions: [],
      }).isInactive,
    ).toBe(false);
    expect(
      readOrgPositionPickerState({
        orgUnitId: '',
        positionId: 'pos_ended',
        positions: POSITIONS,
        scopedPositions: [],
      }).isInactive,
    ).toBe(false);
  });
});
