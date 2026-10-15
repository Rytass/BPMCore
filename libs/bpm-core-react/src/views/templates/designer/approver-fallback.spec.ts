import { readUnsupportedApproverFallbackType } from './approver-fallback';

describe('readUnsupportedApproverFallbackType', () => {
  it('returns null for the fallback types this build edits', () => {
    expect(readUnsupportedApproverFallbackType({ type: 'NONE' })).toBeNull();
    expect(
      readUnsupportedApproverFallbackType({ memberId: 'm-1', type: 'DIRECT' }),
    ).toBeNull();
  });

  it('returns the type name for a fallback saved by a newer engine', () => {
    expect(readUnsupportedApproverFallbackType({ type: 'FUTURE_KIND' })).toBe(
      'FUTURE_KIND',
    );
  });
});
