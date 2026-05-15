import { Args, Int, Query, Resolver } from '@nestjs/graphql';
import { BPMAdminOnly, BPMAuthenticated } from '../bpm-auth';
import { IdentityService } from './identity.service';
import { MemberMetadataCacheEntity } from './member-metadata-cache.entity';
import {
  MemberProfileObject,
  toMemberProfileObject,
} from './member-profile.object';

@Resolver()
@BPMAuthenticated()
export class IdentityQueries {
  constructor(private readonly identityService: IdentityService) {}

  @Query(() => MemberProfileObject)
  async member(
    @Args('memberId', { type: () => String }) memberId: string,
  ): Promise<MemberProfileObject> {
    const metadata = await this.identityService.resolveMember(memberId);

    return toMemberProfileObject(metadata);
  }

  @Query(() => [MemberProfileObject])
  async members(
    @Args('memberIds', { type: () => [String] }) memberIds: readonly string[],
  ): Promise<readonly MemberProfileObject[]> {
    const metadataList = await this.identityService.resolveMembers(memberIds);

    return metadataList.map(toMemberProfileObject);
  }

  @Query(() => [MemberMetadataCacheEntity])
  @BPMAdminOnly()
  async cachedMembers(): Promise<readonly MemberMetadataCacheEntity[]> {
    return this.identityService.listCachedMembers();
  }

  @Query(() => [MemberProfileObject])
  async searchMembers(
    @Args('searchText', { type: () => String }) searchText: string,
    @Args('page', { nullable: true, type: () => Int }) page?: number | null,
    @Args('pageSize', { nullable: true, type: () => Int })
    pageSize?: number | null,
  ): Promise<readonly MemberProfileObject[]> {
    const metadataList = await this.identityService.searchMembers(searchText, {
      page: page ?? undefined,
      pageSize: pageSize ?? undefined,
    });

    return metadataList.map(toMemberProfileObject);
  }

  @Query(() => Int)
  async memberCount(
    @Args('searchText', { nullable: true, type: () => String })
    searchText?: string | null,
  ): Promise<number> {
    return this.identityService.countMembers(searchText ?? '');
  }
}
