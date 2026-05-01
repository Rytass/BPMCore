import { Args, Query, Resolver } from '@nestjs/graphql';
import { IdentityService } from './identity.service';
import { MemberMetadataCacheEntity } from './member-metadata-cache.entity';
import {
  MemberProfileObject,
  toMemberProfileObject,
} from './member-profile.object';

@Resolver()
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
  async cachedMembers(): Promise<readonly MemberMetadataCacheEntity[]> {
    return this.identityService.listCachedMembers();
  }
}
