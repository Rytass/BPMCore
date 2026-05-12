import { Args, Query, Resolver } from '@nestjs/graphql';
import { ManagerResolutionEntity } from './manager-resolution.entity';
import { MembershipEntity } from './membership.entity';
import { OrgUnitEntity } from './org-unit.entity';
import { ManagerResolutionScopeTypeEnum } from './organization.enums';
import { OrganizationSummaryObject } from './organization-summary.object';
import { OrganizationService } from './organization.service';
import { PositionEntity } from './position.entity';
import { ResolvedManagerObject } from './resolved-manager.object';

@Resolver()
export class OrganizationQueries {
  constructor(private readonly organizationService: OrganizationService) {}

  @Query(() => OrgUnitEntity)
  async orgUnit(
    @Args('id', { type: () => String }) id: string,
  ): Promise<OrgUnitEntity> {
    return this.organizationService.getOrgUnit(id);
  }

  @Query(() => [OrgUnitEntity])
  async orgUnits(
    @Args('parentId', { nullable: true, type: () => String })
    parentId?: string | null,
  ): Promise<readonly OrgUnitEntity[]> {
    return this.organizationService.listOrgUnits(parentId);
  }

  @Query(() => [PositionEntity])
  async positions(): Promise<readonly PositionEntity[]> {
    return this.organizationService.listPositions();
  }

  @Query(() => [MembershipEntity])
  async memberships(
    @Args('memberId', { nullable: true, type: () => String })
    memberId?: string,
    @Args('orgUnitId', { nullable: true, type: () => String })
    orgUnitId?: string,
    @Args('activeOnly', { nullable: true, type: () => Boolean })
    activeOnly?: boolean | null,
  ): Promise<readonly MembershipEntity[]> {
    return this.organizationService.listMemberships({
      activeOnly: activeOnly ?? false,
      memberId,
      orgUnitId,
    });
  }

  @Query(() => [ManagerResolutionEntity])
  async managerResolutions(
    @Args('scopeType', {
      nullable: true,
      type: () => ManagerResolutionScopeTypeEnum,
    })
    scopeType?: ManagerResolutionScopeTypeEnum | null,
    @Args('scopeId', { nullable: true, type: () => String })
    scopeId?: string | null,
    @Args('activeOnly', { nullable: true, type: () => Boolean })
    activeOnly?: boolean | null,
  ): Promise<readonly ManagerResolutionEntity[]> {
    return this.organizationService.listManagerResolutions({
      activeOnly: activeOnly ?? false,
      scopeId,
      scopeType,
    });
  }

  @Query(() => OrganizationSummaryObject)
  async organizationSummary(): Promise<OrganizationSummaryObject> {
    return this.organizationService.readOrganizationSummary();
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
