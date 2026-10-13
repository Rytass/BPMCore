import type { MemberProfileRecord } from '@rytass/bpm-core-client/template';
import {
  excludeFailedMemberIds,
  resolveMemberProfilesPerIdOnFailure,
} from './member-profile-resolution';

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
    ).resolves.toEqual({ failedIds: [], profiles: [alice], skippedIds: [] });
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
    ).resolves.toEqual({
      failedIds: ['member-001'],
      profiles: [alice],
      skippedIds: [],
    });
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
    ).resolves.toEqual({
      failedIds: ['member-001'],
      profiles: [],
      skippedIds: [],
    });
    expect(resolveMembers).toHaveBeenCalledTimes(1);
  });

  it('reports every id as failed when each one fails on its own', async () => {
    const resolveMembers = jest.fn().mockRejectedValue(new Error('down'));

    await expect(
      resolveMemberProfilesPerIdOnFailure(['a', 'b'], resolveMembers),
    ).resolves.toEqual({ failedIds: ['a', 'b'], profiles: [], skippedIds: [] });
    expect(resolveMembers).toHaveBeenCalledTimes(3);
  });

  it('never has more per-id requests in flight than the concurrency cap', async () => {
    let inFlight = 0;
    let peak = 0;
    const resolveMembers = jest
      .fn<Promise<readonly MemberProfileRecord[]>, [readonly string[]]>()
      .mockImplementation(async (memberIds) => {
        if (memberIds.length > 1) {
          throw new Error('batch failed');
        }

        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;

        return [];
      });
    const memberIds = Array.from({ length: 10 }, (_, index) => `m${index}`);

    await resolveMemberProfilesPerIdOnFailure(memberIds, resolveMembers, {
      concurrency: 3,
    });

    expect(resolveMembers).toHaveBeenCalledTimes(11);
    expect(peak).toBe(3);
  });

  it('asks for at most the per-id budget and reports the rest as skipped without a request', async () => {
    const resolveMembers = jest.fn().mockRejectedValue(new Error('down'));
    const memberIds = Array.from({ length: 5 }, (_, index) => `m${index}`);

    await expect(
      resolveMemberProfilesPerIdOnFailure(memberIds, resolveMembers, {
        maxPerIdRequests: 2,
      }),
    ).resolves.toEqual({
      failedIds: ['m0', 'm1'],
      profiles: [],
      skippedIds: ['m2', 'm3', 'm4'],
    });
    // The batch plus two per-id requests; m2..m4 are never asked for alone.
    expect(resolveMembers.mock.calls).toEqual([
      [memberIds],
      [['m0']],
      [['m1']],
    ]);
  });

  it('does not ask again, on the next round, for an id that failed on its own', async () => {
    const resolveMembers = jest
      .fn<Promise<readonly MemberProfileRecord[]>, [readonly string[]]>()
      .mockImplementation((memberIds) =>
        memberIds.includes('member-001')
          ? Promise.reject(new Error('foreign id'))
          : Promise.resolve([alice]),
      );
    const failedIds = new Set<string>();
    const wanted = ['member-alice', 'member-001'];

    const first = await resolveMemberProfilesPerIdOnFailure(
      excludeFailedMemberIds(wanted, failedIds),
      resolveMembers,
    );

    first.failedIds.forEach((memberId) => failedIds.add(memberId));
    resolveMembers.mockClear();

    // The next round (the options list changed) wants the same ids.
    const pending = excludeFailedMemberIds(wanted, failedIds);

    expect(pending).toEqual(['member-alice']);
    await resolveMemberProfilesPerIdOnFailure(pending, resolveMembers);
    expect(resolveMembers.mock.calls).toEqual([[['member-alice']]]);
  });
});
