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
 * - `resolve` is called per missing id; throwing here surfaces as a BPM
 *   GraphQL error.
 * - `resolveMany` is the batched form BPM prefers when many ids are needed.
 *   Implementations may de-duplicate / cache as they see fit; missing ids
 *   should be omitted from the result `Map`.
 * - `search` is optional. When omitted, BPM's `searchMembers` GraphQL
 *   query simply returns an empty array.
 */
export interface BPMMemberResolver {
  resolve(memberId: string): Promise<MemberMetadata>;
  resolveMany(
    memberIds: readonly string[],
  ): Promise<ReadonlyMap<string, MemberMetadata>>;
  search?(searchText: string): Promise<readonly MemberMetadata[]>;
}

/**
 * @deprecated Use {@link BPMMemberResolver}. Kept as a backwards-compatible
 * alias.
 */
export type MemberResolver = BPMMemberResolver;
