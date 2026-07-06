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
 * - `search(text)` is the **member-picker** contract: an optional,
 *   non-paginated fuzzy search that returns up to ~50 best matches. When
 *   omitted, BPM's `searchMembers` GraphQL query returns an empty array
 *   (the picker UI degrades to id-only entry). It is **not** meant to
 *   back a full member-directory listing page — see `searchPaged`.
 * - `searchPaged(text, { page, pageSize })` is the optional **directory
 *   listing** contract. When implemented, BPM delegates pagination and
 *   total counting to the host (typically DB-level `LIMIT/OFFSET` + `COUNT`)
 *   instead of fetching everything through `search` and paginating in
 *   memory. This is what the admin members list (`admin/users`) needs to
 *   page through a directory larger than `search`'s ~50-row cap and to
 *   report an accurate total. When omitted, BPM falls back to
 *   `search`-and-slice, so the listing page is capped by whatever `search`
 *   returns (backwards-compatible with pre-0.5.0 hosts).
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
   * Optional **member-picker** free-text search. Return up to ~50 best
   * matches; BPM does not paginate the result. Omit the method entirely
   * to disable member-picker search. This contract is intentionally
   * non-paginated — to back a full directory listing page implement
   * {@link BPMMemberResolver.searchPaged} instead.
   */
  search?(searchText: string): Promise<readonly MemberMetadata[]>;

  /**
   * Optional **directory-listing** paged search. When present, BPM
   * delegates both pagination and total counting to the host — the
   * host is expected to page at the source (e.g. DB `LIMIT/OFFSET`) and
   * return an accurate `total` — bypassing the `search`-and-slice-in-
   * memory path that caps the listing at `search`'s ~50 rows.
   *
   * `page` is 1-based and `pageSize` is the number of rows per page;
   * BPM normalizes and clamps both before calling (see the identity
   * service pagination defaults). BPM row-caches the returned `items`
   * under the same TTL as `resolve`/`resolveMany`, but never caches the
   * page query itself. Omit the method to keep the pre-0.5.0
   * `search`-backed behavior.
   */
  searchPaged?(
    searchText: string,
    options: BPMMemberSearchPageOptions,
  ): Promise<BPMMemberSearchPage>;
}

/**
 * Pagination request passed to {@link BPMMemberResolver.searchPaged}.
 * `page` is 1-based; `pageSize` is the page length. BPM normalizes both
 * to sane, clamped values before delegating, so hosts can trust them.
 */
export interface BPMMemberSearchPageOptions {
  readonly page: number;
  readonly pageSize: number;
}

/**
 * A single page of member search results returned by
 * {@link BPMMemberResolver.searchPaged}. `items` is the requested slice
 * (already limited to `pageSize`); `total` is the full unpaginated match
 * count used by the `memberCount` GraphQL query.
 */
export interface BPMMemberSearchPage {
  readonly items: readonly MemberMetadata[];
  readonly total: number;
}

/**
 * @deprecated Use {@link BPMMemberResolver}. Kept as a backwards-compatible
 * alias.
 */
export type MemberResolver = BPMMemberResolver;
