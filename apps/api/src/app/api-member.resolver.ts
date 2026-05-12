import { Injectable, NotFoundException } from '@nestjs/common';
import type { BPMMemberResolver } from '@bpm/core';
import type { MemberMetadata } from '@bpm/shared';
import { API_DEMO_MEMBER_PROFILES } from './api-demo-members';

const API_DEMO_MEMBERS = API_DEMO_MEMBER_PROFILES.map(
  (profile) => profile.member,
);

@Injectable()
export class ApiMemberResolver implements BPMMemberResolver {
  async resolve(memberId: string): Promise<MemberMetadata> {
    const member = API_DEMO_MEMBERS.find(
      (candidate) => candidate.memberId === memberId,
    );

    if (!member) {
      throw new NotFoundException(`API demo member ${memberId} was not found`);
    }

    return member;
  }

  async resolveMany(
    memberIds: readonly string[],
  ): Promise<ReadonlyMap<string, MemberMetadata>> {
    const resolvedMembers = await Promise.all(
      memberIds.map((memberId) => this.resolve(memberId)),
    );

    return new Map(
      resolvedMembers.map((member): readonly [string, MemberMetadata] => [
        member.memberId,
        member,
      ]),
    );
  }

  async search(searchText: string): Promise<readonly MemberMetadata[]> {
    const normalizedSearchText = searchText.trim().toLocaleLowerCase();

    if (!normalizedSearchText) {
      return API_DEMO_MEMBERS;
    }

    return API_DEMO_MEMBERS.filter((member) =>
      [member.email, member.memberId, member.name].some((value) =>
        value.toLocaleLowerCase().includes(normalizedSearchText),
      ),
    );
  }
}
