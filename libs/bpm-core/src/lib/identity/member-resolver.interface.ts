import { MemberMetadata } from '@rytass/bpm-core-shared';

/**
 * Injection token for the host-provided `BPMMemberResolver`.
 *
 * Hosts must register a provider under this token through
 * `BPMRootModuleOptions.memberResolverProvider`. BPM resolvers and
 * services look up display names, emails, and approver candidates via
 * this token without coupling to any specific identity backend.
 */
export const BPM_MEMBER_RESOLVER = Symbol('BPM_MEMBER_RESOLVER');

/**
 * @deprecated Use {@link BPM_MEMBER_RESOLVER}. Kept as a backwards-compatible
 * alias for hosts that adopted the original name. To be removed in a future
 * major release.
 */
export const MEMBER_RESOLVER = BPM_MEMBER_RESOLVER;

/**
 * Contract host applications must implement so BPM can resolve member
 * profiles, approver candidates, and search results.
 *
 * BPM never reads the host's user table directly — it only knows
 * `memberId` strings and asks this resolver for any additional information.
 *
 * ## Caching
 *
 * BPM caches resolver responses in the `member_metadata_cache` table
 * with a configurable TTL (`identityOptions.memberMetadataCacheTtlMs`,
 * default 5 minutes — `IDENTITY_MEMBER_METADATA_CACHE_TTL_MS_DEFAULT`).
 * Hosts do **not** need to add their own cache layer for the common
 * case; implementations may layer additional caching if they have a
 * faster source of truth (e.g. an in-process LRU over a remote auth
 * service). The two layers do not coordinate — BPM's row-level cache
 * is invalidated only by TTL expiry, never by host signals.
 *
 * ## Unknown-id contract (the two methods diverge intentionally)
 *
 * - `resolve(id)` is the **single-id, must-succeed** form. Throw
 *   `MemberNotFoundException` (or any error) when `memberId` is unknown
 *   — the caller is asking about one specific member and a partial
 *   answer is meaningless. BPM surfaces the error as a GraphQL
 *   `errors[]` entry on the originating query.
 * - `resolveMany(ids)` is the **batched, partial-success** form BPM
 *   prefers when many ids are needed (e.g. resolving the assignee list
 *   on a task page). Implementations should **omit** unknown ids from
 *   the returned `Map` rather than throwing; BPM treats missing entries
 *   as deleted/anonymized members and renders a placeholder. Throwing
 *   here aborts the entire batch and fails the GraphQL query — almost
 *   never the right choice.
 * - `search(text)` is optional. When omitted, BPM's `searchMembers`
 *   GraphQL query returns an empty array (the picker UI degrades to
 *   id-only entry).
 *
 * Implementations may de-duplicate within a single call freely.
 */
export interface BPMMemberResolver {
  /**
   * Single-id lookup. **Throw** (e.g. `MemberNotFoundException`) when
   * the id is unknown — BPM surfaces the error to the caller. Result is
   * row-cached by BPM with TTL `identityOptions.memberMetadataCacheTtlMs`.
   */
  resolve(memberId: string): Promise<MemberMetadata>;

  /**
   * Batched lookup. **Omit** unknown ids from the returned `Map`
   * (do not throw) — BPM renders missing entries as deleted/anonymized
   * members. Cached per-id under the same TTL as `resolve`.
   */
  resolveMany(
    memberIds: readonly string[],
  ): Promise<ReadonlyMap<string, MemberMetadata>>;

  /**
   * Optional free-text search. Return up to ~50 best matches; BPM does
   * not paginate the result. Omit the method entirely to disable
   * member-picker search.
   */
  search?(searchText: string): Promise<readonly MemberMetadata[]>;
}

/**
 * @deprecated Use {@link BPMMemberResolver}. Kept as a backwards-compatible
 * alias.
 */
export type MemberResolver = BPMMemberResolver;
