import { DataSource, Repository } from 'typeorm';
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
      {} as DataSource,
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
      findOne: jest.fn<Promise<OrgUnitEntity | null>, []>(() =>
        Promise.resolve(null),
      ),
      save: jest.fn((entity: OrgUnitEntity): Promise<OrgUnitEntity> => {
        return Promise.resolve(entity);
      }),
    } as unknown as Repository<OrgUnitEntity>;
    const service = new OrganizationService(
      {} as DataSource,
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

  it('clears previous primary membership when creating a new primary membership', async (): Promise<void> => {
    const orgUnitRepository = {
      findOne: jest.fn<Promise<OrgUnitEntity | null>, []>(() =>
        Promise.resolve({
          code: 'FIN',
          createdAt: new Date(),
          deletedAt: null,
          id: 'org-1',
          metadata: {},
          name: 'Finance',
          parentId: null,
          path: 'org.n_fin',
          type: OrgUnitTypeEnum.DEPARTMENT,
          updatedAt: new Date(),
        }),
      ),
    } as unknown as Repository<OrgUnitEntity>;
    const membershipRepository = {
      create: jest.fn((input: Partial<MembershipEntity>): MembershipEntity => {
        return {
          createdAt: new Date(),
          effectiveFrom: input.effectiveFrom ?? '2026-01-01',
          effectiveTo: input.effectiveTo ?? null,
          id: input.id ?? 'membership-1',
          isPrimary: input.isPrimary ?? false,
          memberId: input.memberId ?? 'member-1',
          orgUnitId: input.orgUnitId ?? 'org-1',
          positionId: input.positionId ?? null,
          updatedAt: new Date(),
        };
      }),
      save: jest.fn((entity: MembershipEntity): Promise<MembershipEntity> => {
        return Promise.resolve(entity);
      }),
      update: jest.fn<Promise<{ readonly affected: number }>, []>(() =>
        Promise.resolve({ affected: 1 }),
      ),
    } as unknown as Repository<MembershipEntity>;
    const service = new OrganizationService(
      {} as DataSource,
      orgUnitRepository,
      {} as Repository<PositionEntity>,
      membershipRepository,
      {} as Repository<ManagerResolutionEntity>,
    );

    const membership = await service.createMembership({
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      isPrimary: true,
      memberId: 'member-1',
      orgUnitId: 'org-1',
      positionId: null,
    });

    expect(membership.isPrimary).toBe(true);
    expect(membershipRepository.update).toHaveBeenCalledWith(
      { isPrimary: true, memberId: 'member-1' },
      { isPrimary: false },
    );
  });

  it('rejects a member-scoped manager resolution that points to the same member', async (): Promise<void> => {
    const service = new OrganizationService(
      {} as DataSource,
      {} as Repository<OrgUnitEntity>,
      {} as Repository<PositionEntity>,
      {} as Repository<MembershipEntity>,
      {} as Repository<ManagerResolutionEntity>,
    );

    await expect(
      service.createManagerResolution({
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        managerMemberId: 'member-1',
        priority: 0,
        scopeId: 'member-1',
        scopeType: ManagerResolutionScopeTypeEnum.MEMBER,
      }),
    ).rejects.toThrow('Manager cannot be the scoped member');
  });

  it('rejects moving an org unit under its descendant', async (): Promise<void> => {
    const existing = {
      code: 'ROOT',
      createdAt: new Date(),
      deletedAt: null,
      id: 'org-root',
      metadata: {},
      name: 'Root',
      parentId: null,
      path: 'org.n_root',
      type: OrgUnitTypeEnum.COMPANY,
      updatedAt: new Date(),
    };
    const descendant = {
      ...existing,
      code: 'FIN',
      id: 'org-fin',
      name: 'Finance',
      parentId: 'org-root',
      path: 'org.n_root.n_fin',
      type: OrgUnitTypeEnum.DEPARTMENT,
    };
    const orgUnitRepository = {
      findOne: jest.fn(
        (options: {
          readonly where: { readonly id?: string };
        }): Promise<OrgUnitEntity | null> => {
          if (options.where.id === 'org-root') {
            return Promise.resolve(existing);
          }

          if (options.where.id === 'org-fin') {
            return Promise.resolve(descendant);
          }

          return Promise.resolve(null);
        },
      ),
    } as unknown as Repository<OrgUnitEntity>;
    const service = new OrganizationService(
      {} as DataSource,
      orgUnitRepository,
      {} as Repository<PositionEntity>,
      {} as Repository<MembershipEntity>,
      {} as Repository<ManagerResolutionEntity>,
    );

    await expect(
      service.updateOrgUnit({
        code: null,
        id: 'org-root',
        metadataJson: null,
        name: null,
        parentId: 'org-fin',
        type: null,
      }),
    ).rejects.toThrow('descendant');
  });

  it('formats date-only values with the BPM business timezone', (): void => {
    const service = new OrganizationService(
      {} as DataSource,
      {} as Repository<OrgUnitEntity>,
      {} as Repository<PositionEntity>,
      {} as Repository<MembershipEntity>,
      {} as Repository<ManagerResolutionEntity>,
    );
    const formatter = service as unknown as {
      readonly toDateOnly: (date: Date) => string;
    };

    expect(formatter.toDateOnly(new Date('2026-05-10T16:30:00.000Z'))).toBe(
      '2026-05-11',
    );
  });
});
