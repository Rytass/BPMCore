import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ManagerResolutionEntity } from './manager-resolution.entity';
import { MembershipEntity } from './membership.entity';
import { OrgUnitEntity } from './org-unit.entity';
import { OrganizationDirectoryQueries } from './organization-directory.queries';
import { OrganizationPickerQueries } from './organization-picker.queries';
import { OrganizationMutations } from './organization.mutations';
import { OrganizationQueries } from './organization.queries';
import { OrganizationService } from './organization.service';
import { PositionEntity } from './position.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ManagerResolutionEntity,
      MembershipEntity,
      OrgUnitEntity,
      PositionEntity,
    ]),
  ],
  providers: [
    OrganizationDirectoryQueries,
    OrganizationMutations,
    OrganizationPickerQueries,
    OrganizationQueries,
    OrganizationService,
  ],
  exports: [OrganizationService],
})
export class OrganizationModule {}
