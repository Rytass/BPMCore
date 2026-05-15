import { Args, Int, Query, Resolver } from '@nestjs/graphql';
import { BPMAdminOnly } from '../bpm-auth';
import { ManagerResolutionEntity } from './manager-resolution.entity';
import { MembershipEntity } from './membership.entity';
import { OrgUnitEntity } from './org-unit.entity';
import {
  ManagerResolutionScopeTypeEnum,
  OrgUnitTypeEnum,
} from './organization.enums';
import { OrganizationSummaryObject } from './organization-summary.object';
import { OrganizationService } from './organization.service';
import { PositionEntity } from './position.entity';
import { ResolvedManagerObject } from './resolved-manager.object';

@Resolver()
@BPMAdminOnly()
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
    @Args('page', { nullable: true, type: () => Int }) page?: number | null,
    @Args('pageSize', { nullable: true, type: () => Int })
    pageSize?: number | null,
    @Args('parentId', { nullable: true, type: () => String })
    parentId?: string | null,
    @Args('searchText', { nullable: true, type: () => String })
    searchText?: string | null,
    @Args('type', { nullable: true, type: () => OrgUnitTypeEnum })
    type?: OrgUnitTypeEnum | null,
  ): Promise<readonly OrgUnitEntity[]> {
    return this.organizationService.listOrgUnits({
      page,
      pageSize,
      parentId,
      searchText,
      type,
    });
  }

  @Query(() => Int)
  async orgUnitCount(
    @Args('parentId', { nullable: true, type: () => String })
    parentId?: string | null,
    @Args('searchText', { nullable: true, type: () => String })
    searchText?: string | null,
    @Args('type', { nullable: true, type: () => OrgUnitTypeEnum })
    type?: OrgUnitTypeEnum | null,
  ): Promise<number> {
    return this.organizationService.countOrgUnits({
      parentId,
      searchText,
      type,
    });
  }

  @Query(() => [PositionEntity])
  async positions(
    @Args('page', { nullable: true, type: () => Int }) page?: number | null,
    @Args('pageSize', { nullable: true, type: () => Int })
    pageSize?: number | null,
    @Args('searchText', { nullable: true, type: () => String })
    searchText?: string | null,
  ): Promise<readonly PositionEntity[]> {
    return this.organizationService.listPositions({
      page,
      pageSize,
      searchText,
    });
  }

  @Query(() => Int)
  async positionCount(
    @Args('searchText', { nullable: true, type: () => String })
    searchText?: string | null,
  ): Promise<number> {
    return this.organizationService.countPositions({ searchText });
  }

  @Query(() => [MembershipEntity])
  async memberships(
    @Args('page', { nullable: true, type: () => Int }) page?: number | null,
    @Args('pageSize', { nullable: true, type: () => Int })
    pageSize?: number | null,
    @Args('memberId', { nullable: true, type: () => String })
    memberId?: string,
    @Args('orgUnitId', { nullable: true, type: () => String })
    orgUnitId?: string,
    @Args('positionId', { nullable: true, type: () => String })
    positionId?: string,
    @Args('activeOnly', { nullable: true, type: () => Boolean })
    activeOnly?: boolean | null,
  ): Promise<readonly MembershipEntity[]> {
    return this.organizationService.listMemberships({
      activeOnly: activeOnly ?? false,
      memberId,
      orgUnitId,
      page,
      pageSize,
      positionId,
    });
  }

  @Query(() => Int)
  async membershipCount(
    @Args('memberId', { nullable: true, type: () => String })
    memberId?: string,
    @Args('orgUnitId', { nullable: true, type: () => String })
    orgUnitId?: string,
    @Args('positionId', { nullable: true, type: () => String })
    positionId?: string,
    @Args('activeOnly', { nullable: true, type: () => Boolean })
    activeOnly?: boolean | null,
  ): Promise<number> {
    return this.organizationService.countMemberships({
      activeOnly: activeOnly ?? false,
      memberId,
      orgUnitId,
      positionId,
    });
  }

  @Query(() => [ManagerResolutionEntity])
  async managerResolutions(
    @Args('page', { nullable: true, type: () => Int }) page?: number | null,
    @Args('pageSize', { nullable: true, type: () => Int })
    pageSize?: number | null,
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
      page,
      pageSize,
      scopeId,
      scopeType,
    });
  }

  @Query(() => Int)
  async managerResolutionCount(
    @Args('scopeType', {
      nullable: true,
      type: () => ManagerResolutionScopeTypeEnum,
    })
    scopeType?: ManagerResolutionScopeTypeEnum | null,
    @Args('scopeId', { nullable: true, type: () => String })
    scopeId?: string | null,
    @Args('activeOnly', { nullable: true, type: () => Boolean })
    activeOnly?: boolean | null,
  ): Promise<number> {
    return this.organizationService.countManagerResolutions({
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
