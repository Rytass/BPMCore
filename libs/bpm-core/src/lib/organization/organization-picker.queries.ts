import { Args, ID, Int, Query, Resolver } from '@nestjs/graphql';
import { BPMAuthenticated } from '../bpm-auth';
import { OrgUnitOptionObject } from './dto/org-unit-option.object';
import { OrganizationService } from './organization.service';

/**
 * The organization read behind the 組織選擇 form field. A person filling in a
 * form is not a designer, so unlike `OrganizationDirectoryQueries`
 * (`@BPMDesignerOnly()`) this is open to any signed-in member, and it returns
 * only an id, code, name and a retired flag.
 *
 * Nothing else belongs here: every other organization read stays behind the
 * designer or administrator guards.
 */
@Resolver()
@BPMAuthenticated()
export class OrganizationPickerQueries {
  constructor(private readonly organizationService: OrganizationService) {}

  @Query(() => [OrgUnitOptionObject])
  async searchOrgUnitOptions(
    @Args('searchText', { nullable: true, type: () => String })
    searchText?: string | null,
    @Args('limit', { nullable: true, type: () => Int }) limit?: number | null,
  ): Promise<readonly OrgUnitOptionObject[]> {
    return this.organizationService.searchOrgUnitOptions({ limit, searchText });
  }

  @Query(() => [OrgUnitOptionObject])
  async orgUnitOptionsByIds(
    @Args('ids', { type: () => [ID] }) ids: readonly string[],
  ): Promise<readonly OrgUnitOptionObject[]> {
    return this.organizationService.listOrgUnitOptionsByIds(ids);
  }
}
