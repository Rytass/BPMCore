import {
  type ApproverResolver,
  type ApproverResolverFallback,
  formatOrgManagerChainPlaceholder,
  isFallbackCapableApproverResolverType,
  isNotifyRecipientResolverType,
  isOrgManagerChainStartedFromInitiator,
  parseOrgManagerChainPlaceholder,
  readOrgManagerChainStartPositionLevel,
  readUnsupportedApproverFallbackType,
  readUnsupportedApproverResolverType,
  readUnsupportedOrgManagerChainStartType,
} from './workflow';

describe('readUnsupportedApproverFallbackType', () => {
  it('returns null for every fallback type this build knows', () => {
    const known: readonly ApproverResolverFallback[] = [
      { type: 'NONE' },
      { memberId: 'm-1', type: 'DIRECT' },
      { positionId: 'p-1', type: 'POSITION' },
    ];

    expect(known.map(readUnsupportedApproverFallbackType)).toEqual([
      null,
      null,
      null,
    ]);
  });

  it('returns the type name for a fallback saved by a newer version', () => {
    expect(readUnsupportedApproverFallbackType({ type: 'FUTURE_KIND' })).toBe(
      'FUTURE_KIND',
    );
  });

  it('does not treat inherited object keys as known types', () => {
    expect(readUnsupportedApproverFallbackType({ type: 'toString' })).toBe(
      'toString',
    );
  });
});

const KNOWN_RESOLVERS: readonly ApproverResolver[] = [
  { memberIds: ['m-1'], type: 'DIRECT' },
  { positionId: 'p-1', type: 'POSITION' },
  { orgUnitId: 'o-1', type: 'ORG_UNIT_MEMBER' },
  { orgUnitId: 'o-1', positionId: 'p-1', type: 'ORG_UNIT_POSITION' },
  { baseFromInitiator: true, levelsUp: 1, type: 'ORG_MANAGER' },
  { orgUnitId: 'o-1', type: 'ORG_UNIT_MANAGER' },
  { minPositionLevel: 2, type: 'ORG_MANAGER_CHAIN' },
  { formPath: 'a', type: 'DYNAMIC_FORM' },
  { expression: 'x', type: 'EXPRESSION' },
  { formPath: 'a', levelsUp: 1, type: 'FORM_MEMBER_MANAGER' },
  { formPath: 'a', type: 'FORM_ORG_UNIT_MANAGER' },
  { nodeIds: ['n-1'], type: 'NODE_ACTOR' },
  { levelsUp: 1, nodeIds: ['n-1'], type: 'NODE_ACTOR_MANAGER' },
];

describe('readUnsupportedApproverResolverType', () => {
  it('returns null for every resolver type this build knows', () => {
    expect(KNOWN_RESOLVERS.map(readUnsupportedApproverResolverType)).toEqual(
      KNOWN_RESOLVERS.map(() => null),
    );
  });

  it('returns the type name for a resolver saved by a newer version', () => {
    expect(readUnsupportedApproverResolverType({ type: 'FUTURE_TYPE' })).toBe(
      'FUTURE_TYPE',
    );
  });

  it('does not treat inherited object keys as known types', () => {
    expect(readUnsupportedApproverResolverType({ type: 'toString' })).toBe(
      'toString',
    );
  });
});

describe('isNotifyRecipientResolverType', () => {
  it('accepts the nine original types and refuses the four new ones', () => {
    expect(isNotifyRecipientResolverType('DYNAMIC_FORM')).toBe(true);
    expect(isNotifyRecipientResolverType('ORG_MANAGER')).toBe(true);
    expect(isNotifyRecipientResolverType('NODE_ACTOR')).toBe(false);
    expect(isNotifyRecipientResolverType('NODE_ACTOR_MANAGER')).toBe(false);
    expect(isNotifyRecipientResolverType('FORM_MEMBER_MANAGER')).toBe(false);
    expect(isNotifyRecipientResolverType('FORM_ORG_UNIT_MANAGER')).toBe(false);
    expect(isNotifyRecipientResolverType('FUTURE_TYPE')).toBe(false);
  });
});

describe('isFallbackCapableApproverResolverType', () => {
  it('accepts the six manager-style types', () => {
    const capable = [
      'ORG_MANAGER',
      'ORG_UNIT_MANAGER',
      'ORG_MANAGER_CHAIN',
      'FORM_MEMBER_MANAGER',
      'FORM_ORG_UNIT_MANAGER',
      'NODE_ACTOR_MANAGER',
    ];

    expect(capable.map(isFallbackCapableApproverResolverType)).toEqual(
      capable.map(() => true),
    );
  });

  it('refuses types that have no manager to miss', () => {
    expect(isFallbackCapableApproverResolverType('DIRECT')).toBe(false);
    expect(isFallbackCapableApproverResolverType('NODE_ACTOR')).toBe(false);
    expect(isFallbackCapableApproverResolverType('FUTURE_TYPE')).toBe(false);
  });
});

describe('readUnsupportedOrgManagerChainStartType', () => {
  it('returns null for every start type this build knows', () => {
    expect(
      [
        { type: 'INITIATOR' },
        { formPath: 'a', type: 'FORM_MEMBER' },
        { nodeIds: ['n-1'], type: 'NODE_ACTOR' },
      ].map(readUnsupportedOrgManagerChainStartType),
    ).toEqual([null, null, null]);
  });

  it('returns the type name for a start saved by a newer version', () => {
    expect(
      readUnsupportedOrgManagerChainStartType({ type: 'FUTURE_START' }),
    ).toBe('FUTURE_START');
  });

  it('does not treat inherited object keys as known types', () => {
    expect(readUnsupportedOrgManagerChainStartType({ type: 'toString' })).toBe(
      'toString',
    );
  });

  it.each([
    ['no type', {}],
    ['an undefined type', { type: undefined }],
    ['a type that is not a string', { type: 5 }],
    ['an empty type', { type: '' }],
  ])('names a start with %s in words, never as undefined', (_label, start) => {
    expect(
      readUnsupportedOrgManagerChainStartType(
        start as unknown as { readonly type: string },
      ),
    ).toBe('（缺少型別）');
  });
});

describe('manager chain start readers', () => {
  it('reads an absent, null or INITIATOR start as the initiator', () => {
    expect(isOrgManagerChainStartedFromInitiator({})).toBe(true);
    expect(
      isOrgManagerChainStartedFromInitiator({
        startFrom: null as unknown as undefined,
      }),
    ).toBe(true);
    expect(
      isOrgManagerChainStartedFromInitiator({
        startFrom: { type: 'INITIATOR' },
      }),
    ).toBe(true);
  });

  it('does not read a form or stage start as the initiator', () => {
    expect(
      isOrgManagerChainStartedFromInitiator({
        startFrom: { formPath: 'a', type: 'FORM_MEMBER' },
      }),
    ).toBe(false);
    expect(
      isOrgManagerChainStartedFromInitiator({
        startFrom: { nodeIds: ['n-1'], type: 'NODE_ACTOR' },
      }),
    ).toBe(false);
  });

  it('reads the start level, and nothing for an absent or non-numeric one', () => {
    expect(
      readOrgManagerChainStartPositionLevel({ startPositionLevel: 10 }),
    ).toBe(10);
    expect(readOrgManagerChainStartPositionLevel({})).toBeNull();
    expect(
      readOrgManagerChainStartPositionLevel({
        startPositionLevel: null as unknown as undefined,
      }),
    ).toBeNull();
    expect(
      readOrgManagerChainStartPositionLevel({
        startPositionLevel: '10' as unknown as number,
      }),
    ).toBeNull();
  });
});

describe('manager chain dry-run placeholder', () => {
  it('keeps today\'s text when neither setting is used', () => {
    expect(formatOrgManagerChainPlaceholder({ minPositionLevel: 3 })).toBe(
      'orgManagerChain:3',
    );
    expect(
      formatOrgManagerChainPlaceholder({
        minPositionLevel: 3,
        startFrom: { type: 'INITIATOR' },
      }),
    ).toBe('orgManagerChain:3');
  });

  it.each<
    readonly [
      string,
      Parameters<typeof formatOrgManagerChainPlaceholder>[0],
      string,
    ]
  >([
    [
      'a start level only',
      { minPositionLevel: 30, startPositionLevel: 20 },
      'orgManagerChain:30:20',
    ],
    [
      'a form start',
      {
        minPositionLevel: 30,
        startFrom: { formPath: 'picked', type: 'FORM_MEMBER' },
      },
      'orgManagerChain:30::formMember:picked',
    ],
    [
      'a stage start with a start level',
      {
        minPositionLevel: 30,
        startFrom: { nodeIds: ['a', 'b'], type: 'NODE_ACTOR' },
        startPositionLevel: 20,
      },
      'orgManagerChain:30:20:nodeActor:a,b',
    ],
    [
      // A draft the publish lint refuses, but the dry run still shows it.
      'a fractional start level',
      { minPositionLevel: 30, startPositionLevel: 1.5 },
      'orgManagerChain:30:1.5',
    ],
    [
      'an INITIATOR start with a start level',
      {
        minPositionLevel: 30,
        startFrom: { type: 'INITIATOR' },
        startPositionLevel: 20,
      },
      'orgManagerChain:30:20',
    ],
  ])('writes %s', (_label, resolver, placeholder) => {
    expect(formatOrgManagerChainPlaceholder(resolver)).toBe(placeholder);
  });

  it.each([
    [
      'orgManagerChain:3',
      { minPositionLevel: 3, startFrom: null, startPositionLevel: null },
    ],
    [
      'orgManagerChain:30:20',
      { minPositionLevel: 30, startFrom: null, startPositionLevel: 20 },
    ],
    [
      'orgManagerChain:30::formMember:picked',
      {
        minPositionLevel: 30,
        startFrom: { formPath: 'picked', type: 'FORM_MEMBER' },
        startPositionLevel: null,
      },
    ],
    [
      'orgManagerChain:30:20:nodeActor:a,b',
      {
        minPositionLevel: 30,
        startFrom: { nodeIds: ['a', 'b'], type: 'NODE_ACTOR' },
        startPositionLevel: 20,
      },
    ],
    [
      // A form path may hold a colon: the key is everything after the kind.
      'orgManagerChain:30:20:formMember:a:b',
      {
        minPositionLevel: 30,
        startFrom: { formPath: 'a:b', type: 'FORM_MEMBER' },
        startPositionLevel: 20,
      },
    ],
    [
      // Written by a draft with a fractional level: it reads back as written.
      'orgManagerChain:30:1.5',
      { minPositionLevel: 30, startFrom: null, startPositionLevel: 1.5 },
    ],
  ])('reads %s back', (placeholder, parts) => {
    expect(parseOrgManagerChainPlaceholder(placeholder)).toEqual(parts);
  });

  it.each([
    'orgManagerChain',
    'orgManagerChain:x',
    'orgManagerChain:3:',
    'orgManagerChain:3:x',
    'orgManagerChain:3:2:formMember',
    'orgManagerChain:3:2:unknown:key',
    'orgManagerChain:3:2:formMember:',
    'orgManagerChain:3:formMember:key',
    'position:p-1',
  ])('reads %s as not a chain placeholder', (placeholder) => {
    expect(parseOrgManagerChainPlaceholder(placeholder)).toBeNull();
  });
});
