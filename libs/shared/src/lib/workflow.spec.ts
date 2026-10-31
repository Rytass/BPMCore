import {
  type ApproverResolver,
  type ApproverResolverFallback,
  isFallbackCapableApproverResolverType,
  isNotifyRecipientResolverType,
  readUnsupportedApproverFallbackType,
  readUnsupportedApproverResolverType,
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
