import { Args, Query, Resolver } from '@nestjs/graphql';
import { ManagerResolutionEntity } from './manager-resolution.entity';
import { MembershipEntity } from './membership.entity';
import { OrgUnitEntity } from './org-unit.entity';
import { OrganizationService } from './organization.service';
import { PositionEntity } from './position.entity';
import { ResolvedManagerObject } from './resolved-manager.object';

@Resolver()
export class OrganizationQueries {
  constructor(private readonly organizationService: OrganizationService) {}

  @Query(() => [OrgUnitEntity])
  async orgUnits(): Promise<readonly OrgUnitEntity[]> {
    return this.organizationService.listOrgUnits();
  }

  @Query(() => [PositionEntity])
  async positions(): Promise<readonly PositionEntity[]> {
    return this.organizationService.listPositions();
  }

  @Query(() => [MembershipEntity])
  async memberships(
    @Args('memberId', { nullable: true, type: () => String })
    memberId?: string,
  ): Promise<readonly MembershipEntity[]> {
    return this.organizationService.listMemberships(memberId);
  }

  @Query(() => [ManagerResolutionEntity])
  async managerResolutions(): Promise<readonly ManagerResolutionEntity[]> {
    return this.organizationService.listManagerResolutions();
  }

  @Query(() => ResolvedManagerObject)
  async resolvedManager(
    @Args('memberId', { type: () => String }) memberId: string,
  ): Promise<ResolvedManagerObject> {
    return {
      managerMemberId:
        await this.organizationService.resolveManagerMemberId(memberId),
      memberId,
    };
  }
}
