import { requestGraphQl } from '../../_lib/graphql-client';

export interface MemberProfileRecord {
  readonly customFieldsJson: string;
  readonly email: string;
  readonly memberId: string;
  readonly name: string;
}

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
