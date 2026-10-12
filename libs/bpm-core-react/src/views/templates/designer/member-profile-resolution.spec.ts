import type { MemberProfileRecord } from '@rytass/bpm-core-client/template';
import { resolveMemberProfilesPerIdOnFailure } from './member-profile-resolution';

const alice: MemberProfileRecord = {
  email: 'alice@example.com',
  memberId: 'member-alice',
  name: 'Alice',
};

describe('resolveMemberProfilesPerIdOnFailure', () => {
  it('uses the single batch request when it succeeds', async () => {
    const resolveMembers = jest.fn().mockResolvedValue([alice]);

    await expect(
      resolveMemberProfilesPerIdOnFailure(
        ['member-alice', 'member-bob'],
        resolveMembers,
      ),
    ).resolves.toEqual({ failedIds: [], profiles: [alice] });
    expect(resolveMembers).toHaveBeenCalledTimes(1);
  });

  it('retries a failed batch per id so only the failing id is left unresolved', async () => {
    const resolveMembers = jest
      .fn<Promise<readonly MemberProfileRecord[]>, [readonly string[]]>()
      .mockImplementation((memberIds) =>
        memberIds.length === 1 && memberIds[0] === 'member-alice'
          ? Promise.resolve([alice])
          : Promise.reject(new Error('lookup failed')),
      );

    await expect(
      resolveMemberProfilesPerIdOnFailure(
        ['member-alice', 'member-001'],
        resolveMembers,
      ),
    ).resolves.toEqual({ failedIds: ['member-001'], profiles: [alice] });
    expect(resolveMembers.mock.calls).toEqual([
      [['member-alice', 'member-001']],
      [['member-alice']],
      [['member-001']],
    ]);
  });

  it('does not repeat a failed single-id request', async () => {
    const resolveMembers = jest.fn().mockRejectedValue(new Error('nope'));

    await expect(
      resolveMemberProfilesPerIdOnFailure(['member-001'], resolveMembers),
    ).resolves.toEqual({ failedIds: ['member-001'], profiles: [] });
    expect(resolveMembers).toHaveBeenCalledTimes(1);
  });

  it('reports every id as failed when each one fails on its own', async () => {
    const resolveMembers = jest.fn().mockRejectedValue(new Error('down'));

    await expect(
      resolveMemberProfilesPerIdOnFailure(['a', 'b'], resolveMembers),
    ).resolves.toEqual({ failedIds: ['a', 'b'], profiles: [] });
    expect(resolveMembers).toHaveBeenCalledTimes(3);
  });
});
