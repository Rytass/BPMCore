import type { MemberProfileRecord } from '@rytass/bpm-core-client/template';

/** Most ids asked for on their own after a failed batch, per round. */
export const MAX_PER_ID_REQUESTS = 20;

/** Most per-id requests in flight at once. */
export const PER_ID_CONCURRENCY = 4;

export type MemberProfileResolution = Readonly<{
  /** Ids whose lookup failed even when asked for on their own. */
  failedIds: readonly string[];
  profiles: readonly MemberProfileRecord[];
  /**
   * Ids left unasked because a failed batch held more than the per-id budget.
   * They were not tried, so a later round may ask for them again.
   */
  skippedIds: readonly string[];
}>;

export type MemberProfileResolutionLimits = Readonly<{
  concurrency?: number;
  maxPerIdRequests?: number;
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
 * The retry is bounded: at most `maxPerIdRequests` ids are asked for on their
 * own (the rest come back in `skippedIds` without a request), and at most
 * `concurrency` of those requests run at once, so one bad id in a large
 * template cannot turn into a burst of requests.
 *
 * A single-id batch is not retried: it already is the per-id request.
 */
export async function resolveMemberProfilesPerIdOnFailure(
  memberIds: readonly string[],
  resolveMembers: (
    memberIds: readonly string[],
  ) => Promise<readonly MemberProfileRecord[]>,
  limits: MemberProfileResolutionLimits = {},
): Promise<MemberProfileResolution> {
  const maxPerIdRequests = limits.maxPerIdRequests ?? MAX_PER_ID_REQUESTS;
  const concurrency = Math.max(1, limits.concurrency ?? PER_ID_CONCURRENCY);

  try {
    return {
      failedIds: [],
      profiles: await resolveMembers(memberIds),
      skippedIds: [],
    };
  } catch {
    if (memberIds.length <= 1) {
      return { failedIds: memberIds, profiles: [], skippedIds: [] };
    }
  }

  const askedIds = memberIds.slice(0, maxPerIdRequests);
  const settled = await settleWithConcurrency(
    askedIds,
    concurrency,
    (memberId) => resolveMembers([memberId]),
  );

  return {
    failedIds: askedIds.filter(
      (_, index) => settled[index].status === 'rejected',
    ),
    profiles: settled.flatMap((result) =>
      result.status === 'fulfilled' ? result.value : [],
    ),
    skippedIds: memberIds.slice(maxPerIdRequests),
  };
}

/**
 * The ids still worth asking the directory for: those that already failed on
 * their own in this session are left out, so they stay 「未知會員」 instead of
 * being re-requested every time the option list changes.
 *
 * A failed id stays 「未知會員」 for the rest of the session, even when the
 * failure was transient (a network blip, say), unless a later member search
 * returns it and replaces the placeholder. Ids skipped over the per-id cap
 * were never asked and must not be added to `failedMemberIds`.
 */
export function excludeFailedMemberIds(
  memberIds: readonly string[],
  failedMemberIds: ReadonlySet<string>,
): readonly string[] {
  return memberIds.filter((memberId) => !failedMemberIds.has(memberId));
}

async function settleWithConcurrency<TItem, TResult>(
  items: readonly TItem[],
  concurrency: number,
  run: (item: TItem) => Promise<TResult>,
): Promise<readonly PromiseSettledResult<TResult>[]> {
  const results: PromiseSettledResult<TResult>[] = [];
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;

      nextIndex += 1;
      results[index] = await run(items[index]).then(
        (value): PromiseSettledResult<TResult> => ({
          status: 'fulfilled',
          value,
        }),
        (reason: unknown): PromiseSettledResult<TResult> => ({
          reason,
          status: 'rejected',
        }),
      );
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );

  return results;
}
