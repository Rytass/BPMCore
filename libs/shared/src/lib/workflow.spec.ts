import {
  type ApproverResolverFallback,
  readUnsupportedApproverFallbackType,
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
