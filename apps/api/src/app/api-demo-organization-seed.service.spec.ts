import {
  ManagerResolutionScopeTypeEnum,
  OrganizationService,
  OrgUnitTypeEnum,
} from '@bpm/core/organization';
import { ApiDemoOrganizationSeedService } from './api-demo-organization-seed.service';

describe('ApiDemoOrganizationSeedService', () => {
  it('does not seed when organization data already exists', async (): Promise<void> => {
    const readOrganizationSummary = jest.fn(async () => ({
      managerResolutionCount: 0,
      membershipCount: 0,
      orgUnitCount: 1,
      positionCount: 0,
    }));
    const createOrgUnit = jest.fn();
    const service = new ApiDemoOrganizationSeedService(
      {
        createOrgUnit,
        readOrganizationSummary,
      } as unknown as OrganizationService,
    );

    await service.onApplicationBootstrap();

    expect(createOrgUnit).not.toHaveBeenCalled();
  });

  it('seeds demo org units, positions, memberships, and manager rules', async (): Promise<void> => {
    const readOrganizationSummary = jest.fn(async () => ({
      managerResolutionCount: 0,
      membershipCount: 0,
      orgUnitCount: 0,
      positionCount: 0,
    }));
    const createOrgUnit = jest.fn(
      async (input: {
        readonly code: string;
        readonly parentId: string | null;
        readonly type: OrgUnitTypeEnum;
      }) => ({
        id: `org-${input.code}`,
      }),
    );
    const createPosition = jest.fn(
      async (input: {
        readonly code: string;
        readonly level: number;
      }) => ({
        id: `position-${input.code}`,
      }),
    );
    const createMembership = jest.fn(async () => ({ id: 'membership-id' }));
    const createManagerResolution = jest.fn(async () => ({
      id: 'manager-resolution-id',
    }));
    const service = new ApiDemoOrganizationSeedService(
      {
        createManagerResolution,
        createMembership,
        createOrgUnit,
        createPosition,
        readOrganizationSummary,
      } as unknown as OrganizationService,
    );

    await service.onApplicationBootstrap();

    expect(createOrgUnit).toHaveBeenCalledTimes(7);
    expect(createPosition).toHaveBeenCalledTimes(6);
    expect(createMembership).toHaveBeenCalledTimes(7);
    expect(createManagerResolution).toHaveBeenCalledTimes(8);
    expect(createOrgUnit).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'FIN-TW',
        parentId: 'org-BPM-HQ',
        type: OrgUnitTypeEnum.DEPARTMENT,
      }),
    );
    expect(createMembership).toHaveBeenCalledWith(
      expect.objectContaining({
        memberId: 'member-102',
        orgUnitId: 'org-FIN-AP',
        positionId: 'position-AP_SPECIALIST',
      }),
    );
    expect(createManagerResolution).toHaveBeenCalledWith(
      expect.objectContaining({
        managerMemberId: 'member-101',
        priority: 200,
        scopeId: 'member-102',
        scopeType: ManagerResolutionScopeTypeEnum.MEMBER,
      }),
    );
  });
});
