import { Args, Int, Query, Resolver } from '@nestjs/graphql';
import { BPMAdminOnly } from '../bpm-auth';
import { ManagerResolutionEntity } from './manager-resolution.entity';
import { OrgUnitEntity } from './org-unit.entity';
import {
  ManagerResolutionScopeTypeEnum,
  OrgUnitTypeEnum,
} from './organization.enums';
import { OrgUnitRetirementImpactObject } from './org-unit-retirement-impact.object';
import { OrganizationSummaryObject } from './organization-summary.object';
import { OrganizationService } from './organization.service';
import { ResolvedManagerObject } from './resolved-manager.object';

/**
 * Read-only organization queries for the organization admin pages.
 *
 * Administrator-only as a whole class, so a query added here is closed to
 * designers unless it is moved on purpose. The three reads the template
 * designer needs live in `OrganizationDirectoryQueries` instead: Nest runs
 * class-level and method-level guards together, so a method here cannot be
 * opened wider than this class.
 */
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

  @Query(() => OrgUnitRetirementImpactObject, {
    description:
      'What deleteOrgUnit would have to deal with: live child units (always blocking), and open memberships and ORG_UNIT manager rules (blocking unless a successor unit is given).',
  })
  async orgUnitRetirementImpact(
    @Args('id', { type: () => String }) id: string,
  ): Promise<OrgUnitRetirementImpactObject> {
    return this.organizationService.readOrgUnitRetirementImpact(id);
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

  @Query(() => Int)
  async positionCount(
    @Args('searchText', { nullable: true, type: () => String })
    searchText?: string | null,
  ): Promise<number> {
    return this.organizationService.countPositions({ searchText });
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
