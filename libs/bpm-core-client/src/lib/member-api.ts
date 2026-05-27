import { requestGraphQl } from './graphql-client';

/**
 * Member profile record exposed by the BPM identity GraphQL surface.
 *
 * `customFieldsJson` is a stringified JSON blob — BPM does not impose a
 * schema on host-side member metadata. Consumers parse it according to
 * their own host conventions.
 */
export interface MemberProfileRecord {
  readonly customFieldsJson: string;
  readonly email: string;
  readonly memberId: string;
  readonly name: string;
}

/**
 * A paginated slice of the host member directory, returned by
 * {@link listMemberDirectoryPage}.
 */
export interface MemberDirectoryPage {
  readonly members: readonly MemberProfileRecord[];
  readonly totalCount: number;
}

interface MembersQueryData {
  readonly members: readonly MemberProfileRecord[];
}

interface SearchMembersQueryData {
  readonly searchMembers: readonly MemberProfileRecord[];
}

interface MemberDirectoryPageQueryData extends SearchMembersQueryData {
  readonly memberCount: number;
}

/**
 * Resolves a set of `memberId`s into full member profile records by hitting
 * BPM's `members(memberIds: [String!]!)` GraphQL query, which in turn calls
 * the host-provided `BPMMemberResolver.resolveMany`.
 *
 * Returns an empty array when given an empty input — does not make a
 * network call in that case.
 */
export async function resolveMembers(
  memberIds: readonly string[],
): Promise<readonly MemberProfileRecord[]> {
  if (!memberIds.length) {
    return [];
  }

  const data = await requestGraphQl<MembersQueryData>(
    `query AdminMembers($memberIds: [String!]!) {
      members(memberIds: $memberIds) {
        customFieldsJson
        email
        memberId
        name
      }
    }`,
    { memberIds },
  );

  return data.members;
}

/**
 * Free-text search over the host's member directory through BPM's
 * `searchMembers(searchText: String!)` query. The matching strategy is
 * defined by the host's `BPMMemberResolver.search` implementation.
 */
export async function searchMembers(
  searchText: string,
): Promise<readonly MemberProfileRecord[]> {
  const data = await requestGraphQl<SearchMembersQueryData>(
    `query AdminSearchMembers($searchText: String!) {
      searchMembers(searchText: $searchText) {
        customFieldsJson
        email
        memberId
        name
      }
    }`,
    { searchText },
  );

  return data.searchMembers;
}

/**
 * Reads a single page of the member directory (search + total count in a
 * single GraphQL roundtrip).
 *
 * @param page - 1-based page index.
 * @param pageSize - Items per page.
 * @param searchText - Optional free-text filter; empty string returns all.
 */
export async function listMemberDirectoryPage({
  page,
  pageSize,
  searchText = '',
}: {
  readonly page: number;
  readonly pageSize: number;
  readonly searchText?: string;
}): Promise<MemberDirectoryPage> {
  const data = await requestGraphQl<MemberDirectoryPageQueryData>(
    `query AdminMemberDirectoryPage(
      $page: Int
      $pageSize: Int
      $searchText: String!
    ) {
      searchMembers(page: $page, pageSize: $pageSize, searchText: $searchText) {
        customFieldsJson
        email
        memberId
        name
      }
      memberCount(searchText: $searchText)
    }`,
    { page, pageSize, searchText },
  );

  return {
    members: data.searchMembers,
    totalCount: data.memberCount,
  };
}
