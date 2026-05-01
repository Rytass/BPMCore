import { Repository } from 'typeorm';
import { ManagerResolutionEntity } from './manager-resolution.entity';
import { MembershipEntity } from './membership.entity';
import { OrgUnitEntity } from './org-unit.entity';
import {
  ManagerResolutionScopeTypeEnum,
  OrgUnitTypeEnum,
} from './organization.enums';
import { OrganizationService } from './organization.service';
import { PositionEntity } from './position.entity';

describe('OrganizationService', () => {
  it('resolves member-scoped manager by highest priority', async (): Promise<void> => {
    const managerResolutionRepository = {
      find: jest.fn<Promise<readonly ManagerResolutionEntity[]>, []>(() =>
        Promise.resolve([
          {
            createdAt: new Date(),
            effectiveFrom: '2026-01-01',
            effectiveTo: null,
            id: 'rule-low',
            managerMemberId: 'manager-low',
            priority: 1,
            scopeId: 'member-1',
            scopeType: ManagerResolutionScopeTypeEnum.MEMBER,
          },
          {
            createdAt: new Date(),
            effectiveFrom: '2026-01-01',
            effectiveTo: null,
            id: 'rule-high',
            managerMemberId: 'manager-high',
            priority: 10,
            scopeId: 'member-1',
            scopeType: ManagerResolutionScopeTypeEnum.MEMBER,
          },
        ]),
      ),
    } as unknown as Repository<ManagerResolutionEntity>;
    const membershipRepository = {
      find: jest.fn<Promise<readonly MembershipEntity[]>, []>(() =>
        Promise.resolve([]),
      ),
    } as unknown as Repository<MembershipEntity>;
    const service = new OrganizationService(
      {} as Repository<OrgUnitEntity>,
      {} as Repository<PositionEntity>,
      membershipRepository,
      managerResolutionRepository,
    );

    await expect(
      service.resolveManagerMemberId('member-1', new Date('2026-04-30')),
    ).resolves.toBe('manager-high');
  });

  it('creates org unit paths with ltree-safe identifiers', async (): Promise<void> => {
    const orgUnitRepository = {
      create: jest.fn((entity: Partial<OrgUnitEntity>): OrgUnitEntity => {
        return {
          code: entity.code ?? 'ROOT',
          createdAt: new Date(),
          deletedAt: null,
          id: entity.id ?? 'id',
          metadata: entity.metadata ?? {},
          name: entity.name ?? 'Root',
          parentId: entity.parentId ?? null,
          path: entity.path ?? '',
          type: entity.type ?? OrgUnitTypeEnum.COMPANY,
          updatedAt: new Date(),
        };
      }),
      save: jest.fn((entity: OrgUnitEntity): Promise<OrgUnitEntity> => {
        return Promise.resolve(entity);
      }),
    } as unknown as Repository<OrgUnitEntity>;
    const service = new OrganizationService(
      orgUnitRepository,
      {} as Repository<PositionEntity>,
      {} as Repository<MembershipEntity>,
      {} as Repository<ManagerResolutionEntity>,
    );

    const orgUnit = await service.createOrgUnit({
      code: 'ROOT',
      metadataJson: '{}',
      name: 'Root',
      parentId: null,
      type: OrgUnitTypeEnum.COMPANY,
    });

    expect(orgUnit.path).toMatch(/^org\.n[0-9a-f_]+$/);
    expect(orgUnitRepository.save).toHaveBeenCalledTimes(1);
  });
});
