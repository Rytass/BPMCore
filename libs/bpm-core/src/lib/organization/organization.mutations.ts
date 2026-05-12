import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { ManagerResolutionEntity } from './manager-resolution.entity';
import { MembershipEntity } from './membership.entity';
import { OrgUnitEntity } from './org-unit.entity';
import { OrganizationService } from './organization.service';
import { PositionEntity } from './position.entity';
import {
  CreateManagerResolutionInput,
  UpdateManagerResolutionInput,
} from './dto/manager-resolution.input';
import {
  CreateMembershipInput,
  UpdateMembershipInput,
} from './dto/membership.input';
import { CreateOrgUnitInput, UpdateOrgUnitInput } from './dto/org-unit.input';
import {
  CreatePositionInput,
  UpdatePositionInput,
} from './dto/position.input';

@Resolver()
export class OrganizationMutations {
  constructor(private readonly organizationService: OrganizationService) {}

  @Mutation(() => OrgUnitEntity)
  async createOrgUnit(
    @Args('input') input: CreateOrgUnitInput,
  ): Promise<OrgUnitEntity> {
    return this.organizationService.createOrgUnit(input);
  }

  @Mutation(() => OrgUnitEntity)
  async updateOrgUnit(
    @Args('input') input: UpdateOrgUnitInput,
  ): Promise<OrgUnitEntity> {
    return this.organizationService.updateOrgUnit(input);
  }

  @Mutation(() => Boolean)
  async deleteOrgUnit(
    @Args('id', { type: () => String }) id: string,
  ): Promise<boolean> {
    return this.organizationService.deleteOrgUnit(id);
  }

  @Mutation(() => PositionEntity)
  async createPosition(
    @Args('input') input: CreatePositionInput,
  ): Promise<PositionEntity> {
    return this.organizationService.createPosition(input);
  }

  @Mutation(() => PositionEntity)
  async updatePosition(
    @Args('input') input: UpdatePositionInput,
  ): Promise<PositionEntity> {
    return this.organizationService.updatePosition(input);
  }

  @Mutation(() => Boolean)
  async deleteMembership(
    @Args('id', { type: () => String }) id: string,
  ): Promise<boolean> {
    return this.organizationService.deleteMembership(id);
  }

  @Mutation(() => MembershipEntity)
  async createMembership(
    @Args('input') input: CreateMembershipInput,
  ): Promise<MembershipEntity> {
    return this.organizationService.createMembership(input);
  }

  @Mutation(() => MembershipEntity)
  async updateMembership(
    @Args('input') input: UpdateMembershipInput,
  ): Promise<MembershipEntity> {
    return this.organizationService.updateMembership(input);
  }

  @Mutation(() => ManagerResolutionEntity)
  async createManagerResolution(
    @Args('input') input: CreateManagerResolutionInput,
  ): Promise<ManagerResolutionEntity> {
    return this.organizationService.createManagerResolution(input);
  }

  @Mutation(() => ManagerResolutionEntity)
  async updateManagerResolution(
    @Args('input') input: UpdateManagerResolutionInput,
  ): Promise<ManagerResolutionEntity> {
    return this.organizationService.updateManagerResolution(input);
  }

  @Mutation(() => Boolean)
  async deleteManagerResolution(
    @Args('id', { type: () => String }) id: string,
  ): Promise<boolean> {
    return this.organizationService.deleteManagerResolution(id);
  }
}
