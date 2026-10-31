import {
  ApproverResolver,
  ApproverResolverFallback,
} from '@rytass/bpm-core-shared/workflow';
import {
  OrgUnitRecord,
  PositionRecord,
} from '@rytass/bpm-core-client/organization';
import {
  MemberSelectOption,
  readApproverResolverDetail,
  readApproverResolverMemberIds,
  readApproverResolverMode,
  readApproverResolverSummary,
  readDefaultApproverResolver,
  readManagerLevelOption,
  readManagerLevelOptionById,
  readMemberEmailSummary,
  readMemberSelectOption,
  updateApproverResolverFallback,
} from './approver-resolver-model';

const ORG_UNITS = [
  { code: 'SALES', id: 'org-sales', name: '業務部' },
] as unknown as readonly OrgUnitRecord[];
const POSITIONS = [
  { code: 'LEAD', id: 'pos-lead', level: 3, name: '組長' },
  { code: 'HEAD', id: 'pos-head', level: 5, name: '部長' },
] as unknown as readonly PositionRecord[];
const MEMBERS: readonly MemberSelectOption[] = [
  {
    displayName: '王小明',
    email: 'ming@example.com',
    id: 'm1',
    memberId: 'm1',
    name: '王小明 <ming@example.com>',
  },
  {
    displayName: '李小華',
    email: 'hua@example.com',
    id: 'm2',
    memberId: 'm2',
    name: '李小華 <hua@example.com>',
  },
  {
    displayName: '陳大文',
    email: 'wen@example.com',
    id: 'm3',
    memberId: 'm3',
    name: '陳大文 <wen@example.com>',
  },
];

function summarize(resolver: ApproverResolver): string {
  return readApproverResolverSummary(
    resolver,
    MEMBERS,
    ORG_UNITS,
    POSITIONS,
    null,
  );
}

describe('readApproverResolverMode', () => {
  it.each([
    'DYNAMIC_FORM',
    'ORG_MANAGER',
    'ORG_MANAGER_CHAIN',
    'ORG_UNIT_MANAGER',
    'ORG_UNIT_MEMBER',
    'ORG_UNIT_POSITION',
    'POSITION',
  ] as const)('keeps the existing type %s as its own mode', (type) => {
    expect(readApproverResolverMode(type)).toBe(type);
  });

  it('maps DIRECT, and any type it has no mode for, to DIRECT', () => {
    expect(readApproverResolverMode('DIRECT')).toBe('DIRECT');
    expect(readApproverResolverMode('SOMETHING_ELSE')).toBe('DIRECT');
  });
});

describe('readDefaultApproverResolver', () => {
  it.each([
    ['DIRECT', { memberIds: [], type: 'DIRECT' }],
    [null, { memberIds: [], type: 'DIRECT' }],
    ['DYNAMIC_FORM', { formPath: '', type: 'DYNAMIC_FORM' }],
    [
      'ORG_MANAGER',
      { baseFromInitiator: true, levelsUp: 1, type: 'ORG_MANAGER' },
    ],
    ['ORG_MANAGER_CHAIN', { minPositionLevel: 5, type: 'ORG_MANAGER_CHAIN' }],
    ['ORG_UNIT_MANAGER', { orgUnitId: '', type: 'ORG_UNIT_MANAGER' }],
    [
      'ORG_UNIT_MEMBER',
      { includeDescendants: false, orgUnitId: '', type: 'ORG_UNIT_MEMBER' },
    ],
    [
      'ORG_UNIT_POSITION',
      {
        includeDescendants: false,
        orgUnitId: '',
        positionId: '',
        type: 'ORG_UNIT_POSITION',
      },
    ],
    ['POSITION', { positionId: '', type: 'POSITION' }],
  ] as const)('starts %s as the documented empty draft', (mode, expected) => {
    expect(readDefaultApproverResolver(mode, POSITIONS)).toStrictEqual(
      expected,
    );
  });
});

describe('updateApproverResolverFallback', () => {
  const fallback: ApproverResolverFallback = {
    memberId: 'm1',
    type: 'DIRECT',
  };

  it.each([
    { baseFromInitiator: true, levelsUp: 1, type: 'ORG_MANAGER' },
    { minPositionLevel: 5, type: 'ORG_MANAGER_CHAIN' },
    { orgUnitId: 'org-sales', type: 'ORG_UNIT_MANAGER' },
  ] as const)('writes the fallback onto $type', (resolver) => {
    expect(updateApproverResolverFallback(resolver, fallback)).toStrictEqual({
      ...resolver,
      fallback,
    });
  });

  it.each([
    { memberIds: ['m1'], type: 'DIRECT' },
    { positionId: 'pos-lead', type: 'POSITION' },
    { formPath: 'owner', type: 'DYNAMIC_FORM' },
  ] as const)('leaves %j untouched (no fallback concept)', (resolver) => {
    expect(updateApproverResolverFallback(resolver, fallback)).toBe(resolver);
  });
});

describe('readApproverResolverMemberIds', () => {
  it('lists the members a DIRECT resolver names', () => {
    expect(
      readApproverResolverMemberIds({
        memberIds: ['m1', 'm2'],
        type: 'DIRECT',
      }),
    ).toEqual(['m1', 'm2']);
  });

  it.each([
    { baseFromInitiator: true, levelsUp: 1, type: 'ORG_MANAGER' },
    { minPositionLevel: 5, type: 'ORG_MANAGER_CHAIN' },
    { orgUnitId: 'org-sales', type: 'ORG_UNIT_MANAGER' },
  ] as const)('counts the 固定改派 member of $type', (resolver) => {
    expect(
      readApproverResolverMemberIds({
        ...resolver,
        fallback: { memberId: 'm9', type: 'DIRECT' },
      }),
    ).toEqual(['m9']);
  });

  it('ignores an unpicked or non-member fallback', () => {
    const resolver = {
      orgUnitId: 'org-sales',
      type: 'ORG_UNIT_MANAGER',
    } as const;

    expect(readApproverResolverMemberIds(resolver)).toEqual([]);
    expect(
      readApproverResolverMemberIds({
        ...resolver,
        fallback: { memberId: '', type: 'DIRECT' },
      }),
    ).toEqual([]);
    expect(
      readApproverResolverMemberIds({
        ...resolver,
        fallback: { positionId: 'pos-lead', type: 'POSITION' },
      }),
    ).toEqual([]);
  });

  it('is empty for resolvers that name no member outright', () => {
    expect(
      readApproverResolverMemberIds({
        positionId: 'pos-lead',
        type: 'POSITION',
      }),
    ).toEqual([]);
  });
});

describe('readApproverResolverSummary (existing types)', () => {
  it('names the picked members, abbreviating past two', () => {
    expect(summarize({ memberIds: ['m1'], type: 'DIRECT' })).toBe(
      '王小明 <ming@example.com>',
    );
    expect(summarize({ memberIds: ['m1', 'm2', 'm3'], type: 'DIRECT' })).toBe(
      '王小明 <ming@example.com>、李小華 <hua@example.com> 等 3 人',
    );
    expect(summarize({ memberIds: [], type: 'DIRECT' })).toBe('未指定簽核者');
  });

  it('names manager levels, chains, organisations and positions', () => {
    expect(
      summarize({ baseFromInitiator: true, levelsUp: 2, type: 'ORG_MANAGER' }),
    ).toBe('第二層主管');
    expect(summarize({ minPositionLevel: 5, type: 'ORG_MANAGER_CHAIN' })).toBe(
      '主管鏈：簽到職等 5',
    );
    expect(
      summarize({ orgUnitId: 'org-sales', type: 'ORG_UNIT_MANAGER' }),
    ).toBe('組織主管：業務部 · SALES');
    expect(summarize({ orgUnitId: 'org-gone', type: 'ORG_UNIT_MANAGER' })).toBe(
      '組織主管：未指定組織',
    );
    expect(summarize({ orgUnitId: 'org-sales', type: 'ORG_UNIT_MEMBER' })).toBe(
      '組織任一人：業務部 · SALES',
    );
    expect(
      summarize({
        orgUnitId: 'org-sales',
        positionId: 'pos-lead',
        type: 'ORG_UNIT_POSITION',
      }),
    ).toBe('組織職位：業務部 · SALES / 組長 · LEAD');
    expect(summarize({ positionId: 'pos-head', type: 'POSITION' })).toBe(
      '職位：部長 · HEAD',
    );
  });

  it('summarises the form-field and expression sources', () => {
    expect(summarize({ formPath: '', type: 'DYNAMIC_FORM' })).toBe(
      '依表單欄位：未設定',
    );
    expect(summarize({ formPath: 'owner', type: 'DYNAMIC_FORM' })).toBe(
      '依表單欄位：owner',
    );
    expect(summarize({ expression: 'x', type: 'EXPRESSION' })).toBe(
      '自訂表達式',
    );
  });
});

describe('manager level and member helpers', () => {
  it('reads a level by value or id and defaults to 直屬主管', () => {
    expect(readManagerLevelOption(3).name).toBe('第三層主管');
    expect(readManagerLevelOption(9).name).toBe('直屬主管');
    expect(readManagerLevelOptionById('2').value).toBe(2);
    expect(readManagerLevelOptionById(null).value).toBe(1);
  });

  it('finds a member option or returns the 未知會員 sentinel', () => {
    expect(readMemberSelectOption(MEMBERS, 'm2').displayName).toBe('李小華');
    expect(readMemberSelectOption(MEMBERS, 'gone')).toMatchObject({
      id: 'gone',
      name: '未知會員',
      unresolved: true,
    });
    expect(readMemberEmailSummary([], MEMBERS, '空')).toBe('空');
  });
});

describe('readApproverResolverDetail (existing types)', () => {
  it.each([
    [{ memberIds: [], type: 'DIRECT' }, '指定成員'],
    [{ positionId: 'p', type: 'POSITION' }, '指定職位'],
    [{ orgUnitId: 'o', type: 'ORG_UNIT_MEMBER' }, '單位成員'],
    [
      { orgUnitId: 'o', positionId: 'p', type: 'ORG_UNIT_POSITION' },
      '單位職位',
    ],
    [{ baseFromInitiator: true, levelsUp: 1, type: 'ORG_MANAGER' }, '主管'],
    [{ minPositionLevel: 1, type: 'ORG_MANAGER_CHAIN' }, '主管鏈'],
    [{ orgUnitId: 'o', type: 'ORG_UNIT_MANAGER' }, '單位主管'],
    [{ formPath: 'f', type: 'DYNAMIC_FORM' }, '依表單欄位指定'],
    [{ expression: 'x', type: 'EXPRESSION' }, '運算式'],
  ] as const)('labels %j as %s', (resolver, label) => {
    expect(readApproverResolverDetail(resolver)).toBe(label);
  });
});
