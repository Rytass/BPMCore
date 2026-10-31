import {
  ApproverResolver,
  ApproverResolverFallback,
} from '@rytass/bpm-core-shared/workflow';
import {
  OrgUnitRecord,
  PositionRecord,
} from '@rytass/bpm-core-client/organization';
import { FormDefinitionSchema } from '@rytass/bpm-core-shared/form';
import {
  APPROVER_RESOLVER_MODE_OPTIONS,
  FORM_MEMBER_SUBJECT_OPTIONS,
  MemberSelectOption,
  NODE_ACTOR_SUBJECT_OPTIONS,
  ORG_UNIT_SOURCE_OPTIONS,
  buildApproverResolver,
  UNSUPPORTED_APPROVER_SOURCE_OPTION_ID,
  isApproverSourceReadOnly,
  readApproverSourceChoice,
  readApproverManagerRule,
  readApproverResolverDetail,
  readApproverResolverEditorState,
  readApproverSourcePick,
  readApproverSourceReadOnlyText,
  readApproverSubjectChoice,
  readApproverSubjectOption,
  readApproverSubjectPick,
  readStoredManagerLevelOption,
  withApproverSubject,
  withPreferClosestOrgUnit,
  withOrgUnitSource,
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

// ---------------------------------------------------------------------------
// The form-field and prior-node sources (SPEC 5.2, names per section 9).
// ---------------------------------------------------------------------------

const FORM_SCHEMA: FormDefinitionSchema = {
  fields: [
    { fieldKey: 'owner', label: '負責人', required: true, type: 'member' },
    {
      fieldKey: 'reviewers',
      label: '審閱者',
      multiple: true,
      required: true,
      type: 'member',
    },
    { fieldKey: 'dept', label: '申請部門', required: true, type: 'org_unit' },
    { fieldKey: 'reason', label: '事由', required: true, type: 'text' },
  ],
  schemaVersion: 1,
};
const GONE_FALLBACK: ApproverResolverFallback = {
  memberId: 'm9',
  type: 'DIRECT',
};

const FORM_MEMBER_MANAGER: ApproverResolver = {
  fallback: { positionId: 'pos-head', type: 'POSITION' },
  formPath: 'owner',
  levelsUp: 2,
  preferClosestOrgUnit: true,
  type: 'FORM_MEMBER_MANAGER',
};
const FORM_ORG_UNIT_MANAGER: ApproverResolver = {
  fallback: GONE_FALLBACK,
  formPath: 'dept',
  preferClosestOrgUnit: true,
  type: 'FORM_ORG_UNIT_MANAGER',
};
const NODE_ACTOR: ApproverResolver = {
  nodeIds: ['a', 'b'],
  type: 'NODE_ACTOR',
};
const NODE_ACTOR_MANAGER: ApproverResolver = {
  fallback: { type: 'NONE' },
  levelsUp: 3,
  nodeIds: ['a'],
  preferClosestOrgUnit: false,
  type: 'NODE_ACTOR_MANAGER',
};
const FUTURE_RESOLVER = {
  extra: { keep: ['me'] },
  type: 'FUTURE_TYPE',
} as unknown as ApproverResolver;
const EXISTING_RESOLVERS: readonly ApproverResolver[] = [
  { memberIds: ['m1'], type: 'DIRECT' },
  { positionId: 'pos-lead', type: 'POSITION' },
  { includeDescendants: true, orgUnitId: 'org-sales', type: 'ORG_UNIT_MEMBER' },
  {
    includeDescendants: false,
    orgUnitId: 'org-sales',
    positionId: 'pos-lead',
    type: 'ORG_UNIT_POSITION',
  },
  {
    baseFromInitiator: true,
    fallback: GONE_FALLBACK,
    levelsUp: 2,
    preferClosestOrgUnit: true,
    type: 'ORG_MANAGER',
  },
  { fallback: GONE_FALLBACK, orgUnitId: 'org-sales', type: 'ORG_UNIT_MANAGER' },
  { minPositionLevel: 5, type: 'ORG_MANAGER_CHAIN' },
  { formPath: 'owner', type: 'DYNAMIC_FORM' },
  { expression: 'x', type: 'EXPRESSION' },
];

describe('screen options for the new sources', () => {
  it('offers 依前面關卡的簽核者 as a 簽核來源 option and keeps the existing ones', () => {
    expect(APPROVER_RESOLVER_MODE_OPTIONS.map((option) => option.id)).toEqual([
      'DIRECT',
      'DYNAMIC_FORM',
      'NODE_ACTOR',
      'ORG_MANAGER',
      'ORG_MANAGER_CHAIN',
      'ORG_UNIT_MANAGER',
      'ORG_UNIT_MEMBER',
      'ORG_UNIT_POSITION',
      'POSITION',
    ]);
    expect(
      APPROVER_RESOLVER_MODE_OPTIONS.find(
        (option) => option.id === 'NODE_ACTOR',
      )?.name,
    ).toBe('依前面關卡的簽核者');
    expect(
      APPROVER_RESOLVER_MODE_OPTIONS.find((option) => option.id === 'DIRECT')
        ?.name,
    ).toBe('指定會員');
  });

  it('names the 簽核人 choices of each source and the 組織 choices', () => {
    expect(FORM_MEMBER_SUBJECT_OPTIONS.map((option) => option.name)).toEqual([
      '欄位裡的人',
      '直屬主管',
      '第二層主管',
      '第三層主管',
    ]);
    expect(NODE_ACTOR_SUBJECT_OPTIONS.map((option) => option.name)).toEqual([
      '關卡的簽核者',
      '直屬主管',
      '第二層主管',
      '第三層主管',
    ]);
    expect(FORM_MEMBER_SUBJECT_OPTIONS.map((option) => option.value)).toEqual([
      0, 1, 2, 3,
    ]);
    expect(ORG_UNIT_SOURCE_OPTIONS.map((option) => option.name)).toEqual([
      '固定組織',
      '表單欄位',
    ]);
  });

  it('reads the option for a stored level, and shows a level it has no option for', () => {
    expect(readApproverSubjectOption(FORM_MEMBER_SUBJECT_OPTIONS, 0).name).toBe(
      '欄位裡的人',
    );
    expect(readApproverSubjectOption(NODE_ACTOR_SUBJECT_OPTIONS, 2).name).toBe(
      '第二層主管',
    );
    expect(readApproverSubjectOption(NODE_ACTOR_SUBJECT_OPTIONS, 5)).toEqual({
      id: '5',
      name: '第 5 層主管',
      value: 5,
    });
  });
});

describe('readApproverResolverMode (new types)', () => {
  it.each([
    ['FORM_MEMBER_MANAGER', 'DYNAMIC_FORM'],
    ['FORM_ORG_UNIT_MANAGER', 'ORG_UNIT_MANAGER'],
    ['NODE_ACTOR', 'NODE_ACTOR'],
    ['NODE_ACTOR_MANAGER', 'NODE_ACTOR'],
  ] as const)('shows %s under the screen option %s', (type, mode) => {
    expect(readApproverResolverMode(type)).toBe(mode);
  });

  it('starts 依前面關卡的簽核者 with no stage picked', () => {
    expect(readDefaultApproverResolver('NODE_ACTOR', POSITIONS)).toStrictEqual({
      nodeIds: [],
      type: 'NODE_ACTOR',
    });
  });

  it('starts a switched-to existing mode clean of the previous source fields', () => {
    expect(readDefaultApproverResolver('POSITION', POSITIONS)).toStrictEqual({
      positionId: '',
      type: 'POSITION',
    });
    expect(
      readDefaultApproverResolver('DYNAMIC_FORM', POSITIONS),
    ).toStrictEqual({ formPath: '', type: 'DYNAMIC_FORM' });
  });
});

describe('readApproverResolverEditorState / buildApproverResolver', () => {
  it('reads ② 本人 as the existing DYNAMIC_FORM, with no manager level', () => {
    expect(
      readApproverResolverEditorState({
        formPath: 'owner',
        type: 'DYNAMIC_FORM',
      }),
    ).toStrictEqual({
      formPath: 'owner',
      levelsUp: null,
      mode: 'DYNAMIC_FORM',
    });
    expect(
      buildApproverResolver({
        formPath: 'owner',
        levelsUp: null,
        mode: 'DYNAMIC_FORM',
      }),
    ).toStrictEqual({ formPath: 'owner', type: 'DYNAMIC_FORM' });
  });

  it('reads ② 主管 as FORM_MEMBER_MANAGER and writes it back verbatim', () => {
    const state = readApproverResolverEditorState(FORM_MEMBER_MANAGER);

    expect(state).toStrictEqual({
      fallback: { positionId: 'pos-head', type: 'POSITION' },
      formPath: 'owner',
      levelsUp: 2,
      mode: 'DYNAMIC_FORM',
      preferClosestOrgUnit: true,
    });
    expect(buildApproverResolver(state)).toStrictEqual(FORM_MEMBER_MANAGER);
  });

  it('reads ① with a fixed org as the existing ORG_UNIT_MANAGER', () => {
    const resolver: ApproverResolver = {
      fallback: GONE_FALLBACK,
      orgUnitId: 'org-sales',
      preferClosestOrgUnit: false,
      type: 'ORG_UNIT_MANAGER',
    };
    const state = readApproverResolverEditorState(resolver);

    expect(state).toStrictEqual({
      fallback: GONE_FALLBACK,
      formPath: '',
      mode: 'ORG_UNIT_MANAGER',
      orgSource: 'FIXED',
      orgUnitId: 'org-sales',
      preferClosestOrgUnit: false,
    });
    expect(buildApproverResolver(state)).toStrictEqual(resolver);
  });

  it('reads ① from a form field as FORM_ORG_UNIT_MANAGER and writes it back verbatim', () => {
    const state = readApproverResolverEditorState(FORM_ORG_UNIT_MANAGER);

    expect(state).toStrictEqual({
      fallback: GONE_FALLBACK,
      formPath: 'dept',
      mode: 'ORG_UNIT_MANAGER',
      orgSource: 'FORM_FIELD',
      orgUnitId: '',
      preferClosestOrgUnit: true,
    });
    expect(buildApproverResolver(state)).toStrictEqual(FORM_ORG_UNIT_MANAGER);
  });

  it('reads ③ 本人 as NODE_ACTOR and ③ 主管 as NODE_ACTOR_MANAGER, both verbatim', () => {
    expect(readApproverResolverEditorState(NODE_ACTOR)).toStrictEqual({
      levelsUp: null,
      mode: 'NODE_ACTOR',
      nodeIds: ['a', 'b'],
    });
    expect(
      buildApproverResolver(readApproverResolverEditorState(NODE_ACTOR)),
    ).toStrictEqual(NODE_ACTOR);
    expect(readApproverResolverEditorState(NODE_ACTOR_MANAGER)).toStrictEqual({
      fallback: { type: 'NONE' },
      levelsUp: 3,
      mode: 'NODE_ACTOR',
      nodeIds: ['a'],
      preferClosestOrgUnit: false,
    });
    expect(
      buildApproverResolver(
        readApproverResolverEditorState(NODE_ACTOR_MANAGER),
      ),
    ).toStrictEqual(NODE_ACTOR_MANAGER);
  });

  it('switching ② to 欄位裡的人 drops the manager-only fields', () => {
    const next = buildApproverResolver(
      withApproverSubject(
        readApproverResolverEditorState(FORM_MEMBER_MANAGER),
        0,
      ),
    );

    expect(next).toStrictEqual({ formPath: 'owner', type: 'DYNAMIC_FORM' });
    expect('fallback' in next).toBe(false);
    expect('levelsUp' in next).toBe(false);
    expect('preferClosestOrgUnit' in next).toBe(false);
  });

  it('switching ② to a manager level builds FORM_MEMBER_MANAGER at that level', () => {
    expect(
      buildApproverResolver(
        withApproverSubject(
          readApproverResolverEditorState({
            formPath: 'owner',
            type: 'DYNAMIC_FORM',
          }),
          3,
        ),
      ),
    ).toStrictEqual({
      formPath: 'owner',
      levelsUp: 3,
      type: 'FORM_MEMBER_MANAGER',
    });
  });

  it('changing the manager level keeps the 無主管時 setting', () => {
    expect(
      buildApproverResolver(
        withApproverSubject(
          readApproverResolverEditorState(FORM_MEMBER_MANAGER),
          1,
        ),
      ),
    ).toStrictEqual({ ...FORM_MEMBER_MANAGER, levelsUp: 1 });
  });

  it('switching ③ to 關卡的簽核者 drops level, fallback and closest-unit', () => {
    const next = buildApproverResolver(
      withApproverSubject(
        readApproverResolverEditorState(NODE_ACTOR_MANAGER),
        0,
      ),
    );

    expect(next).toStrictEqual({ nodeIds: ['a'], type: 'NODE_ACTOR' });
    expect('levelsUp' in next).toBe(false);
    expect('fallback' in next).toBe(false);
    expect('preferClosestOrgUnit' in next).toBe(false);
  });

  it('switching ① from a form field to a fixed org drops the formPath, keeps 無主管時', () => {
    const next = buildApproverResolver(
      withOrgUnitSource(
        readApproverResolverEditorState(FORM_ORG_UNIT_MANAGER),
        'FIXED',
      ),
    );

    expect(next).toStrictEqual({
      fallback: GONE_FALLBACK,
      orgUnitId: '',
      preferClosestOrgUnit: true,
      type: 'ORG_UNIT_MANAGER',
    });
    expect('formPath' in next).toBe(false);
  });

  it('switching ① from a fixed org to a form field drops the orgUnitId and ticks 只取最近一層主管 for a new one', () => {
    const next = buildApproverResolver(
      withOrgUnitSource(
        readApproverResolverEditorState({
          orgUnitId: 'org-sales',
          type: 'ORG_UNIT_MANAGER',
        }),
        'FORM_FIELD',
      ),
    );

    expect(next).toStrictEqual({
      formPath: '',
      preferClosestOrgUnit: true,
      type: 'FORM_ORG_UNIT_MANAGER',
    });
    expect('orgUnitId' in next).toBe(false);
  });

  it('does not override a 只取最近一層主管 choice already made when switching to a form field', () => {
    expect(
      buildApproverResolver(
        withOrgUnitSource(
          readApproverResolverEditorState({
            orgUnitId: 'org-sales',
            preferClosestOrgUnit: false,
            type: 'ORG_UNIT_MANAGER',
          }),
          'FORM_FIELD',
        ),
      ),
    ).toStrictEqual({
      formPath: '',
      preferClosestOrgUnit: false,
      type: 'FORM_ORG_UNIT_MANAGER',
    });
  });

  it('ignores subject / org-source changes on a source that has none', () => {
    const state = readApproverResolverEditorState({
      memberIds: ['m1'],
      type: 'DIRECT',
    });

    expect(withApproverSubject(state, 2)).toBe(state);
    expect(withOrgUnitSource(state, 'FORM_FIELD')).toBe(state);
  });

  it.each(EXISTING_RESOLVERS.map((resolver) => [resolver.type, resolver]))(
    'leaves the existing %s JSON untouched (反向控制)',
    (_type, resolver) => {
      expect(
        buildApproverResolver(readApproverResolverEditorState(resolver)),
      ).toStrictEqual(resolver);
    },
  );

  it('keeps a type this build does not know exactly as saved (read-only)', () => {
    const state = readApproverResolverEditorState(FUTURE_RESOLVER);

    expect(state).toMatchObject({ mode: 'UNSUPPORTED', type: 'FUTURE_TYPE' });
    expect(buildApproverResolver(state)).toBe(FUTURE_RESOLVER);
    expect(JSON.stringify(buildApproverResolver(state))).toBe(
      '{"extra":{"keep":["me"]},"type":"FUTURE_TYPE"}',
    );
    expect(withApproverSubject(state, 2)).toBe(state);
    expect(withOrgUnitSource(state, 'FIXED')).toBe(state);
  });
});

describe('updateApproverResolverFallback (new types)', () => {
  const fallback: ApproverResolverFallback = {
    positionId: 'pos-head',
    type: 'POSITION',
  };

  it.each([FORM_MEMBER_MANAGER, FORM_ORG_UNIT_MANAGER, NODE_ACTOR_MANAGER])(
    'writes the fallback onto $type',
    (resolver) => {
      expect(updateApproverResolverFallback(resolver, fallback)).toStrictEqual({
        ...resolver,
        fallback,
      });
    },
  );

  it('has no fallback to write on NODE_ACTOR or a type it does not know', () => {
    expect(updateApproverResolverFallback(NODE_ACTOR, fallback)).toBe(
      NODE_ACTOR,
    );
    expect(updateApproverResolverFallback(FUTURE_RESOLVER, fallback)).toBe(
      FUTURE_RESOLVER,
    );
  });
});

describe('readApproverResolverMemberIds (new types)', () => {
  it('reads the 固定改派 member of the three manager sources', () => {
    expect(
      readApproverResolverMemberIds({
        fallback: GONE_FALLBACK,
        formPath: 'owner',
        levelsUp: 1,
        type: 'FORM_MEMBER_MANAGER',
      }),
    ).toEqual(['m9']);
    expect(readApproverResolverMemberIds(FORM_ORG_UNIT_MANAGER)).toEqual([
      'm9',
    ]);
    expect(
      readApproverResolverMemberIds({
        fallback: GONE_FALLBACK,
        levelsUp: 1,
        nodeIds: ['a'],
        type: 'NODE_ACTOR_MANAGER',
      }),
    ).toEqual(['m9']);
  });

  it('is empty without a member fallback, and for NODE_ACTOR / unknown types', () => {
    expect(readApproverResolverMemberIds(FORM_MEMBER_MANAGER)).toEqual([]);
    expect(readApproverResolverMemberIds(NODE_ACTOR_MANAGER)).toEqual([]);
    expect(readApproverResolverMemberIds(NODE_ACTOR)).toEqual([]);
    expect(readApproverResolverMemberIds(FUTURE_RESOLVER)).toEqual([]);
  });
});

describe('readApproverResolverSummary (new types)', () => {
  const nodes = [
    { id: 'a', name: '主管審核' },
    { id: 'b', name: '財務審核' },
    { id: 'c', name: '法務審核' },
  ];
  const summarizeWith = (resolver: ApproverResolver): string =>
    readApproverResolverSummary(
      resolver,
      MEMBERS,
      ORG_UNITS,
      POSITIONS,
      FORM_SCHEMA,
      nodes,
    );

  it('describes 表單欄位的人的主管 with the field label and level', () => {
    expect(summarizeWith(FORM_MEMBER_MANAGER)).toBe(
      '依表單欄位：負責人的第二層主管',
    );
    expect(
      summarizeWith({ formPath: '', levelsUp: 1, type: 'FORM_MEMBER_MANAGER' }),
    ).toBe('依表單欄位：未設定');
  });

  it('flags a manager source pointed at a multi-select or non-member field', () => {
    expect(
      summarizeWith({
        formPath: 'reviewers',
        levelsUp: 1,
        type: 'FORM_MEMBER_MANAGER',
      }),
    ).toBe('依表單欄位：審閱者（需為單選人員欄位）');
    expect(
      summarizeWith({
        formPath: 'reason',
        levelsUp: 1,
        type: 'FORM_MEMBER_MANAGER',
      }),
    ).toBe('依表單欄位：事由（非人員選擇欄位）');
  });

  it('describes 表單欄位的組織主管', () => {
    expect(summarizeWith(FORM_ORG_UNIT_MANAGER)).toBe(
      '依表單欄位：申請部門所選組織的主管',
    );
    expect(
      summarizeWith({ formPath: 'owner', type: 'FORM_ORG_UNIT_MANAGER' }),
    ).toBe('依表單欄位：負責人（非組織選擇欄位）');
    expect(summarizeWith({ formPath: '', type: 'FORM_ORG_UNIT_MANAGER' })).toBe(
      '依表單欄位：未設定',
    );
  });

  it('describes 依前面關卡的簽核者 by stage name, abbreviating past two', () => {
    expect(summarizeWith(NODE_ACTOR)).toBe(
      '前面關卡的簽核者：主管審核、財務審核',
    );
    expect(
      summarizeWith({ nodeIds: ['a', 'b', 'c'], type: 'NODE_ACTOR' }),
    ).toBe('前面關卡的簽核者：主管審核、財務審核 等 3 關');
    expect(summarizeWith(NODE_ACTOR_MANAGER)).toBe(
      '前面關卡簽核者的第三層主管：主管審核',
    );
    expect(summarizeWith({ nodeIds: [], type: 'NODE_ACTOR' })).toBe(
      '前面關卡的簽核者：未指定關卡',
    );
  });

  it('keeps a deleted stage visible by id, and counts stages when no names are given', () => {
    expect(summarizeWith({ nodeIds: ['gone'], type: 'NODE_ACTOR' })).toBe(
      '前面關卡的簽核者：gone（已不存在）',
    );
    expect(
      readApproverResolverSummary(
        NODE_ACTOR,
        MEMBERS,
        ORG_UNITS,
        POSITIONS,
        null,
      ),
    ).toBe('前面關卡的簽核者：2 個關卡');
  });

  it('never calls one of the four new types 自訂表達式', () => {
    [
      FORM_MEMBER_MANAGER,
      FORM_ORG_UNIT_MANAGER,
      NODE_ACTOR,
      NODE_ACTOR_MANAGER,
    ].forEach((resolver) => {
      expect(summarizeWith(resolver)).not.toBe('自訂表達式');
    });
  });

  it('names a type it does not know instead of calling it an expression', () => {
    expect(summarizeWith(FUTURE_RESOLVER)).toBe(
      '不支援的簽核來源（FUTURE_TYPE）',
    );
  });

  it('leaves the existing summaries as they were (反向控制)', () => {
    expect(summarizeWith({ formPath: 'owner', type: 'DYNAMIC_FORM' })).toBe(
      '依表單欄位：負責人',
    );
    expect(
      summarizeWith({ orgUnitId: 'org-sales', type: 'ORG_UNIT_MANAGER' }),
    ).toBe('組織主管：業務部 · SALES');
    expect(
      summarizeWith({
        baseFromInitiator: true,
        levelsUp: 1,
        type: 'ORG_MANAGER',
      }),
    ).toBe('直屬主管');
    expect(summarizeWith({ expression: 'x', type: 'EXPRESSION' })).toBe(
      '自訂表達式',
    );
  });
});

describe('readApproverResolverDetail (new types)', () => {
  it.each([
    [FORM_MEMBER_MANAGER, '表單欄位人員的主管'],
    [FORM_ORG_UNIT_MANAGER, '表單欄位組織的主管'],
    [NODE_ACTOR, '前面關卡的簽核者'],
    [NODE_ACTOR_MANAGER, '前面關卡簽核者的主管'],
    [FUTURE_RESOLVER, '簽核人'],
  ] as const)('labels %j as %s', (resolver, label) => {
    expect(readApproverResolverDetail(resolver)).toBe(label);
  });
});

describe('approver source gating (6b)', () => {
  const stateOf = readApproverResolverEditorState;

  it('treats only an unknown type as read-only, and says which type', () => {
    expect(isApproverSourceReadOnly(stateOf(FUTURE_RESOLVER))).toBe(true);
    expect(readApproverSourceReadOnlyText(stateOf(FUTURE_RESOLVER))).toBe(
      '不支援的簽核來源（FUTURE_TYPE）',
    );
    [
      ...EXISTING_RESOLVERS,
      FORM_MEMBER_MANAGER,
      FORM_ORG_UNIT_MANAGER,
      NODE_ACTOR,
      NODE_ACTOR_MANAGER,
    ].forEach((resolver) => {
      expect(isApproverSourceReadOnly(stateOf(resolver))).toBe(false);
      expect(readApproverSourceReadOnlyText(stateOf(resolver))).toBeNull();
    });
  });

  it('shows an unknown type as its own read-only 簽核來源 entry, not as 指定會員', () => {
    const choice = readApproverSourceChoice(stateOf(FUTURE_RESOLVER));

    expect(choice.selected).toStrictEqual({
      id: UNSUPPORTED_APPROVER_SOURCE_OPTION_ID,
      name: '不支援的簽核來源（FUTURE_TYPE）',
    });
    expect(choice.options.map((option) => option.id)).toStrictEqual([
      ...APPROVER_RESOLVER_MODE_OPTIONS.map((option) => option.id),
      UNSUPPORTED_APPROVER_SOURCE_OPTION_ID,
    ]);
    expect(choice.hint).toBe(
      '此引擎版本不支援這種簽核來源；這裡選擇其他簽核來源會覆寫原設定',
    );
    // Control: a known source offers the plain list and no hint.
    const known = readApproverSourceChoice(stateOf(FORM_MEMBER_MANAGER));

    expect(known.options).toStrictEqual(APPROVER_RESOLVER_MODE_OPTIONS);
    expect(known.selected).toStrictEqual({
      id: 'DYNAMIC_FORM',
      name: '依表單欄位指定',
    });
    expect(known.hint).toBeNull();
    expect(
      readApproverSourceChoice(stateOf(NODE_ACTOR_MANAGER)).selected.id,
    ).toBe('NODE_ACTOR');
    expect(
      readApproverSourceChoice(stateOf(FORM_ORG_UNIT_MANAGER)).selected.id,
    ).toBe('ORG_UNIT_MANAGER');
  });

  it('picking the read-only entry changes nothing; picking another source replaces it with that default', () => {
    expect(
      readApproverSourcePick(
        FUTURE_RESOLVER,
        UNSUPPORTED_APPROVER_SOURCE_OPTION_ID,
        POSITIONS,
      ),
    ).toBeNull();
    expect(readApproverSourcePick(FUTURE_RESOLVER, null, POSITIONS)).toBeNull();
    expect(
      readApproverSourcePick(FUTURE_RESOLVER, 'not-an-option', POSITIONS),
    ).toBeNull();
    expect(
      readApproverSourcePick(FUTURE_RESOLVER, 'DIRECT', POSITIONS),
    ).toStrictEqual({
      memberIds: [],
      type: 'DIRECT',
    });
    expect(
      readApproverSourcePick(FUTURE_RESOLVER, 'NODE_ACTOR', POSITIONS),
    ).toStrictEqual({
      nodeIds: [],
      type: 'NODE_ACTOR',
    });
  });

  it('lets an EXPRESSION resolver be switched to 指定會員, but re-picking a real shown source stays a no-op', () => {
    const expression: ApproverResolver = {
      expression: 'x',
      type: 'EXPRESSION',
    };

    expect(
      readApproverSourcePick(expression, 'DIRECT', POSITIONS),
    ).toStrictEqual({
      memberIds: [],
      type: 'DIRECT',
    });
    expect(
      readApproverSourcePick(expression, 'POSITION', POSITIONS),
    ).toStrictEqual({
      positionId: '',
      type: 'POSITION',
    });
    expect(
      readApproverSourcePick(
        { positionId: 'pos-lead', type: 'POSITION' },
        'POSITION',
        POSITIONS,
      ),
    ).toBeNull();
    expect(
      readApproverSourcePick(
        { levelsUp: 1, baseFromInitiator: true, type: 'ORG_MANAGER' },
        'ORG_MANAGER',
        POSITIONS,
      ),
    ).toBeNull();
  });

  it('re-picking the shown 簽核來源 is a no-op for every shared option', () => {
    expect(
      readApproverSourcePick(FORM_MEMBER_MANAGER, 'DYNAMIC_FORM', POSITIONS),
    ).toBeNull();
    expect(
      readApproverSourcePick(
        FORM_ORG_UNIT_MANAGER,
        'ORG_UNIT_MANAGER',
        POSITIONS,
      ),
    ).toBeNull();
    expect(
      readApproverSourcePick(NODE_ACTOR_MANAGER, 'NODE_ACTOR', POSITIONS),
    ).toBeNull();
    expect(
      readApproverSourcePick(
        { memberIds: ['m1'], type: 'DIRECT' },
        'DIRECT',
        POSITIONS,
      ),
    ).toBeNull();
  });

  it('picking another 簽核來源 starts it clean, an id that is not an option is ignored', () => {
    expect(
      readApproverSourcePick(FORM_MEMBER_MANAGER, 'NODE_ACTOR', POSITIONS),
    ).toStrictEqual({
      nodeIds: [],
      type: 'NODE_ACTOR',
    });
    expect(
      readApproverSourcePick(NODE_ACTOR_MANAGER, 'DYNAMIC_FORM', POSITIONS),
    ).toStrictEqual({
      formPath: '',
      type: 'DYNAMIC_FORM',
    });
    expect(
      readApproverSourcePick(NODE_ACTOR, 'not-an-option', POSITIONS),
    ).toBeNull();
    expect(readApproverSourcePick(NODE_ACTOR, null, POSITIONS)).toBeNull();
  });

  it('shows a stored manager level below 1 as invalid, never as 本人 (M3)', () => {
    const zero: ApproverResolver = {
      formPath: 'owner',
      levelsUp: 0,
      type: 'FORM_MEMBER_MANAGER',
    };
    const negative: ApproverResolver = {
      levelsUp: -1,
      nodeIds: ['a'],
      type: 'NODE_ACTOR_MANAGER',
    };
    const zeroChoice = readApproverSubjectChoice(stateOf(zero));
    const negativeChoice = readApproverSubjectChoice(stateOf(negative));

    expect(zeroChoice?.invalid).toBe(true);
    expect(zeroChoice?.selected.name).toBe('第 0 層主管（無效）');
    expect(zeroChoice?.selected.name).not.toBe('欄位裡的人');
    expect(
      zeroChoice?.options.some((o) => o.id === zeroChoice.selected.id),
    ).toBe(true);
    expect(negativeChoice?.invalid).toBe(true);
    expect(negativeChoice?.selected.name).toBe('第 -1 層主管（無效）');
    expect(negativeChoice?.selected.name).not.toBe('關卡的簽核者');
    // The stored JSON is untouched by showing it.
    expect(buildApproverResolver(stateOf(zero))).toStrictEqual(zero);
    expect(buildApproverResolver(stateOf(negative))).toStrictEqual(negative);
    // Control: a real 本人 and a real level are not flagged.
    expect(
      readApproverSubjectChoice(
        stateOf({ formPath: 'owner', type: 'DYNAMIC_FORM' }),
      ),
    ).toMatchObject({
      invalid: false,
      selected: { name: '欄位裡的人', value: 0 },
    });
    expect(
      readApproverSubjectChoice(stateOf(NODE_ACTOR_MANAGER)),
    ).toMatchObject({
      invalid: false,
      selected: { name: '第三層主管', value: 3 },
    });
  });

  it('describes a broken stored level as invalid in the canvas summary too', () => {
    const nodes = [{ id: 'a', name: '主管審核' }];

    expect(
      readApproverResolverSummary(
        { levelsUp: 0, nodeIds: ['a'], type: 'NODE_ACTOR_MANAGER' },
        MEMBERS,
        ORG_UNITS,
        POSITIONS,
        null,
        nodes,
      ),
    ).toBe('前面關卡簽核者的第 0 層主管（無效）：主管審核');
    expect(
      readApproverResolverSummary(
        { formPath: 'owner', levelsUp: 0, type: 'FORM_MEMBER_MANAGER' },
        MEMBERS,
        ORG_UNITS,
        POSITIONS,
        FORM_SCHEMA,
      ),
    ).toBe('依表單欄位：負責人的第 0 層主管（無效）');
    expect(
      readStoredManagerLevelOption(FORM_MEMBER_SUBJECT_OPTIONS, 1).name,
    ).toBe('直屬主管');
    expect(
      readStoredManagerLevelOption(FORM_MEMBER_SUBJECT_OPTIONS, 1.5).name,
    ).toBe('第 1.5 層主管（無效）');
  });

  it('keeps a level above 3 visible and re-picking an invalid level is a no-op', () => {
    const five = stateOf({
      levelsUp: 5,
      nodeIds: ['a'],
      type: 'NODE_ACTOR_MANAGER',
    });
    const zero = stateOf({
      formPath: 'owner',
      levelsUp: 0,
      type: 'FORM_MEMBER_MANAGER',
    });

    expect(readApproverSubjectChoice(five)?.selected.name).toBe('第 5 層主管');
    expect(readApproverSubjectChoice(five)?.invalid).toBe(false);
    expect(readApproverSubjectPick(zero, 'invalid:0')).toBeNull();
    expect(readApproverSubjectPick(five, '5')).toBeNull();
  });

  it('a 簽核人 pick applies the level, and the shown choice or a non-option is a no-op', () => {
    const state = stateOf(NODE_ACTOR_MANAGER);

    expect(readApproverSubjectPick(state, '3')).toBeNull();
    expect(readApproverSubjectPick(state, 'x')).toBeNull();
    expect(readApproverSubjectPick(state, null)).toBeNull();
    const toSelf = readApproverSubjectPick(state, '0');

    expect(toSelf).not.toBeNull();
    expect(
      buildApproverResolver(toSelf as ReturnType<typeof stateOf>),
    ).toStrictEqual({
      nodeIds: ['a'],
      type: 'NODE_ACTOR',
    });
    const fromSelf = readApproverSubjectPick(stateOf(NODE_ACTOR), '2');

    expect(
      buildApproverResolver(fromSelf as ReturnType<typeof stateOf>),
    ).toStrictEqual({
      levelsUp: 2,
      nodeIds: ['a', 'b'],
      type: 'NODE_ACTOR_MANAGER',
    });
    // 本人 shown, 本人 picked again.
    expect(readApproverSubjectPick(stateOf(NODE_ACTOR), '0')).toBeNull();
    // A source without a 簽核人 choice has none.
    expect(
      readApproverSubjectChoice(stateOf({ memberIds: [], type: 'DIRECT' })),
    ).toBeNull();
    expect(
      readApproverSubjectPick(stateOf({ memberIds: [], type: 'DIRECT' }), '1'),
    ).toBeNull();
  });

  it('offers 只取最近一層主管 / 無主管時 only on a resolver that looks a manager up', () => {
    expect(
      readApproverManagerRule({ formPath: 'owner', type: 'DYNAMIC_FORM' }),
    ).toBeNull();
    expect(readApproverManagerRule(NODE_ACTOR)).toBeNull();
    expect(readApproverManagerRule(FUTURE_RESOLVER)).toBeNull();
    expect(
      readApproverManagerRule({ memberIds: [], type: 'DIRECT' }),
    ).toBeNull();
    expect(readApproverManagerRule(FORM_MEMBER_MANAGER)).toStrictEqual({
      fallback: { positionId: 'pos-head', type: 'POSITION' },
      preferClosestOrgUnit: true,
      showPreferClosestOrgUnit: true,
    });
    expect(
      readApproverManagerRule({
        levelsUp: 1,
        nodeIds: ['a'],
        type: 'NODE_ACTOR_MANAGER',
      }),
    ).toStrictEqual({
      fallback: { type: 'NONE' },
      preferClosestOrgUnit: false,
      showPreferClosestOrgUnit: true,
    });
    expect(
      readApproverManagerRule({
        minPositionLevel: 3,
        type: 'ORG_MANAGER_CHAIN',
      })?.showPreferClosestOrgUnit,
    ).toBe(false);
  });

  it('toggles 只取最近一層主管 on the new manager types and leaves the others alone', () => {
    expect(withPreferClosestOrgUnit(NODE_ACTOR_MANAGER, true)).toStrictEqual({
      ...NODE_ACTOR_MANAGER,
      preferClosestOrgUnit: true,
    });
    expect(
      withPreferClosestOrgUnit(FORM_ORG_UNIT_MANAGER, false),
    ).toStrictEqual({
      ...FORM_ORG_UNIT_MANAGER,
      preferClosestOrgUnit: false,
    });
    const chain: ApproverResolver = {
      minPositionLevel: 3,
      type: 'ORG_MANAGER_CHAIN',
    };

    expect(withPreferClosestOrgUnit(chain, true)).toBe(chain);
    expect(withPreferClosestOrgUnit(NODE_ACTOR, true)).toBe(NODE_ACTOR);
    expect(withPreferClosestOrgUnit(FUTURE_RESOLVER, true)).toBe(
      FUTURE_RESOLVER,
    );
  });
});
