import { Args, Int, Query, Resolver } from '@nestjs/graphql';
import { BPMDesignerOnly } from '../bpm-auth';
import { MembershipEntity } from './membership.entity';
import { OrgUnitEntity } from './org-unit.entity';
import { OrgUnitTypeEnum } from './organization.enums';
import { OrganizationService } from './organization.service';
import { PositionEntity } from './position.entity';

/**
 * The organization reads the template designer and the compose wizard (which
 * embeds it) load to fill their approver pickers: units, positions and
 * memberships. A designer is not necessarily an administrator, so these three
 * are `@BPMDesignerOnly()`.
 *
 * Nothing else belongs here. Every other organization read stays in the
 * administrator-only `OrganizationQueries` (manager rules, counts, the
 * summary, a single unit, retirement impact, resolved managers), and every
 * write stays in `OrganizationMutations`.
 */
@Resolver()
@BPMDesignerOnly()
export class OrganizationDirectoryQueries {
  constructor(private readonly organizationService: OrganizationService) {}

  @Query(() => [OrgUnitEntity])
  async orgUnits(
    @Args('all', { nullable: true, type: () => Boolean })
    all?: boolean | null,
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
      all,
      page,
      pageSize,
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
}
