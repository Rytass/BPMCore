import { Injectable, NotFoundException } from '@nestjs/common';
import {
  BPMMemberBaseResolverAdapter,
  type BPMMemberBaseDirectory,
  type BPMMemberResolver,
} from '@rytass/bpm-core-nestjs-module/identity';
import type { MemberMetadata } from '@rytass/bpm-core-shared';
import { API_DEMO_MEMBER_PROFILES } from './api-demo-members';

const API_DEMO_MEMBERS = API_DEMO_MEMBER_PROFILES.map(
  (profile) => profile.member,
);

@Injectable()
export class ApiMemberResolver
  extends BPMMemberBaseResolverAdapter<MemberMetadata>
  implements BPMMemberResolver
{
  constructor() {
    super(createApiDemoMemberDirectory());
  }

  override async resolve(memberId: string): Promise<MemberMetadata> {
    try {
      return await super.resolve(memberId);
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new NotFoundException(
          `API demo member ${memberId} was not found`,
        );
      }

      throw error;
    }
  }
}

function createApiDemoMemberDirectory(): BPMMemberBaseDirectory<MemberMetadata> {
  return {
    resolveMember: (memberId): Promise<MemberMetadata | null> =>
      Promise.resolve(
        API_DEMO_MEMBERS.find((member) => member.memberId === memberId) ?? null,
      ),
    resolveMembers: (memberIds): Promise<readonly MemberMetadata[]> =>
      Promise.resolve(
        API_DEMO_MEMBERS.filter((member) =>
          memberIds.includes(member.memberId),
        ),
      ),
    searchMembers: (searchText): Promise<readonly MemberMetadata[]> => {
      const normalizedSearchText = searchText.trim().toLocaleLowerCase();

      if (!normalizedSearchText) {
        return Promise.resolve(API_DEMO_MEMBERS);
      }

      return Promise.resolve(
        API_DEMO_MEMBERS.filter((member) =>
          [member.email, member.memberId, member.name].some((value) =>
            value.toLocaleLowerCase().includes(normalizedSearchText),
          ),
        ),
      );
    },
  };
}
