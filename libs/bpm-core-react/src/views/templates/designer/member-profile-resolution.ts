import type { MemberProfileRecord } from '@rytass/bpm-core-client/template';

export type MemberProfileResolution = Readonly<{
  /** Ids whose lookup failed even when asked for on their own. */
  failedIds: readonly string[];
  profiles: readonly MemberProfileRecord[];
}>;

/**
 * Looks up member profiles in one batch, and degrades per id when the batch
 * request fails.
 *
 * The host fails a whole lookup when it contains an id it cannot handle (a
 * foreign id stored in a template, say). Treating that as "nobody resolved"
 * labels every approver of the template 「未知會員」 for the sake of one bad
 * id, so a failed batch is retried one id at a time and only the ids that fail
 * on their own are reported back in `failedIds`.
 *
 * A single-id batch is not retried: it already is the per-id request.
 */
export async function resolveMemberProfilesPerIdOnFailure(
  memberIds: readonly string[],
  resolveMembers: (
    memberIds: readonly string[],
  ) => Promise<readonly MemberProfileRecord[]>,
): Promise<MemberProfileResolution> {
  try {
    return { failedIds: [], profiles: await resolveMembers(memberIds) };
  } catch {
    if (memberIds.length <= 1) {
      return { failedIds: memberIds, profiles: [] };
    }
  }

  const settled = await Promise.allSettled(
    memberIds.map((memberId) => resolveMembers([memberId])),
  );

  return {
    failedIds: memberIds.filter(
      (_, index) => settled[index].status === 'rejected',
    ),
    profiles: settled.flatMap((result) =>
      result.status === 'fulfilled' ? result.value : [],
    ),
  };
}
