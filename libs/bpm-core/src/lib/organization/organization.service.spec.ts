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

const baseUpdatedAt = new Date('2026-05-12T08:00:00.000Z');

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

  it('pushes org unit filters into repository query', async (): Promise<void> => {
    const find = jest.fn(
      (): Promise<readonly OrgUnitEntity[]> => Promise.resolve([]),
    );
    const orgUnitRepository = {
      find,
    } as unknown as Repository<OrgUnitEntity>;
    const service = new OrganizationService(
      {} as DataSource,
      orgUnitRepository,
      {} as Repository<PositionEntity>,
      {} as Repository<MembershipEntity>,
      {} as Repository<ManagerResolutionEntity>,
    );

    await service.listOrgUnits({
      page: 2,
      pageSize: 5,
      searchText: '財務',
      type: OrgUnitTypeEnum.DEPARTMENT,
    });

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        order: { path: 'ASC' },
        skip: 5,
        take: 5,
        where: expect.arrayContaining([
          expect.objectContaining({
            code: expect.any(Object),
            deletedAt: expect.any(Object),
            type: OrgUnitTypeEnum.DEPARTMENT,
          }),
          expect.objectContaining({
            deletedAt: expect.any(Object),
            name: expect.any(Object),
            type: OrgUnitTypeEnum.DEPARTMENT,
          }),
        ]),
      }),
    );
  });

  it('pushes organization table filters into paginated repository queries', async (): Promise<void> => {
    const positionFind = jest.fn(
      (): Promise<readonly PositionEntity[]> => Promise.resolve([]),
    );
    const membershipFind = jest.fn(
      (): Promise<readonly MembershipEntity[]> => Promise.resolve([]),
    );
    const managerResolutionCount = jest.fn((): Promise<number> =>
      Promise.resolve(0),
    );
    const service = new OrganizationService(
      {} as DataSource,
      {} as Repository<OrgUnitEntity>,
      { find: positionFind } as unknown as Repository<PositionEntity>,
      { find: membershipFind } as unknown as Repository<MembershipEntity>,
      {
        count: managerResolutionCount,
      } as unknown as Repository<ManagerResolutionEntity>,
    );

    await service.listPositions({
      page: 3,
      pageSize: 10,
      searchText: '主管',
    });
    await service.listMemberships({
      activeOnly: true,
      orgUnitId: 'org-1',
      page: 2,
      pageSize: 20,
      positionId: 'position-1',
    });
    await service.countManagerResolutions({
      activeOnly: true,
      scopeType: ManagerResolutionScopeTypeEnum.ORG_UNIT,
    });

    expect(positionFind).toHaveBeenCalledWith(
      expect.objectContaining({
        order: { code: 'ASC', level: 'DESC' },
        skip: 20,
        take: 10,
        where: expect.arrayContaining([
          expect.objectContaining({ code: expect.any(Object) }),
          expect.objectContaining({ name: expect.any(Object) }),
        ]),
      }),
    );
    expect(membershipFind).toHaveBeenCalledWith(
      expect.objectContaining({
        order: {
          effectiveFrom: 'DESC',
          isPrimary: 'DESC',
          memberId: 'ASC',
        },
        skip: 20,
        take: 20,
        where: expect.arrayContaining([
          expect.objectContaining({
            effectiveFrom: expect.any(Object),
            orgUnitId: 'org-1',
            positionId: 'position-1',
          }),
        ]),
      }),
    );
    expect(managerResolutionCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.arrayContaining([
          expect.objectContaining({
            effectiveFrom: expect.any(Object),
            scopeType: ManagerResolutionScopeTypeEnum.ORG_UNIT,
          }),
        ]),
      }),
    );
  });

  it('commits org unit tree draft moves and recalculates descendant paths in one transaction', async (): Promise<void> => {
    const orgUnits = [
      createOrgUnitFixture({
        code: 'ROOT',
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Root',
        path: 'org.n00000000_0000_4000_8000_000000000001',
      }),
      createOrgUnitFixture({
        code: 'A',
        id: '00000000-0000-4000-8000-000000000002',
        name: 'Department A',
        parentId: '00000000-0000-4000-8000-000000000001',
        path: 'org.n00000000_0000_4000_8000_000000000001.n00000000_0000_4000_8000_000000000002',
      }),
      createOrgUnitFixture({
        code: 'A1',
        id: '00000000-0000-4000-8000-000000000003',
        name: 'Team A1',
        parentId: '00000000-0000-4000-8000-000000000002',
        path: 'org.n00000000_0000_4000_8000_000000000001.n00000000_0000_4000_8000_000000000002.n00000000_0000_4000_8000_000000000003',
      }),
      createOrgUnitFixture({
        code: 'B',
        id: '00000000-0000-4000-8000-000000000004',
        name: 'Department B',
        parentId: '00000000-0000-4000-8000-000000000001',
        path: 'org.n00000000_0000_4000_8000_000000000001.n00000000_0000_4000_8000_000000000004',
      }),
    ];
    const orgUnitRepository = createOrgUnitTreeDraftRepository(orgUnits);
    const manager = {
      getRepository: jest.fn(() => orgUnitRepository),
    };
    const transaction = jest.fn(
      (
        callback: (value: typeof manager) => Promise<unknown>,
      ): Promise<unknown> => callback(manager),
    );
    const service = new OrganizationService(
      { transaction } as unknown as DataSource,
      {} as Repository<OrgUnitEntity>,
      {} as Repository<PositionEntity>,
      {} as Repository<MembershipEntity>,
      {} as Repository<ManagerResolutionEntity>,
    );

    const result = await service.commitOrgUnitTreeDraft({
      moves: [
        {
          baseUpdatedAt: baseUpdatedAt.toISOString(),
          id: '00000000-0000-4000-8000-000000000002',
          parentId: '00000000-0000-4000-8000-000000000004',
        },
      ],
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(orgUnitRepository.save).toHaveBeenCalledTimes(2);
    expect(result.orgUnits.map((orgUnit) => orgUnit.id)).toEqual([
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
    ]);
    expect(orgUnits[1]?.parentId).toBe(
      '00000000-0000-4000-8000-000000000004',
    );
    expect(orgUnits[1]?.path).toBe(
      'org.n00000000_0000_4000_8000_000000000001.n00000000_0000_4000_8000_000000000004.n00000000_0000_4000_8000_000000000002',
    );
    expect(orgUnits[2]?.path).toBe(
      'org.n00000000_0000_4000_8000_000000000001.n00000000_0000_4000_8000_000000000004.n00000000_0000_4000_8000_000000000002.n00000000_0000_4000_8000_000000000003',
    );
  });

  it('rejects stale org unit tree draft moves', async (): Promise<void> => {
    const orgUnits = [
      createOrgUnitFixture({
        id: '00000000-0000-4000-8000-000000000001',
        updatedAt: new Date('2026-05-12T08:01:00.000Z'),
      }),
    ];
    const orgUnitRepository = createOrgUnitTreeDraftRepository(orgUnits);
    const manager = {
      getRepository: jest.fn(() => orgUnitRepository),
    };
    const transaction = jest.fn(
      (
        callback: (value: typeof manager) => Promise<unknown>,
      ): Promise<unknown> => callback(manager),
    );
    const service = new OrganizationService(
      { transaction } as unknown as DataSource,
      {} as Repository<OrgUnitEntity>,
      {} as Repository<PositionEntity>,
      {} as Repository<MembershipEntity>,
      {} as Repository<ManagerResolutionEntity>,
    );

    await expect(
      service.commitOrgUnitTreeDraft({
        moves: [
          {
            baseUpdatedAt: baseUpdatedAt.toISOString(),
            id: '00000000-0000-4000-8000-000000000001',
            parentId: null,
          },
        ],
      }),
    ).rejects.toThrow('changed since this draft was based');
    expect(orgUnitRepository.save).not.toHaveBeenCalled();
  });

  it('rejects org unit tree draft cycles before saving', async (): Promise<void> => {
    const orgUnits = [
      createOrgUnitFixture({
        id: '00000000-0000-4000-8000-000000000001',
        path: 'org.n00000000_0000_4000_8000_000000000001',
      }),
      createOrgUnitFixture({
        id: '00000000-0000-4000-8000-000000000002',
        path: 'org.n00000000_0000_4000_8000_000000000002',
      }),
    ];
    const orgUnitRepository = createOrgUnitTreeDraftRepository(orgUnits);
    const manager = {
      getRepository: jest.fn(() => orgUnitRepository),
    };
    const transaction = jest.fn(
      (
        callback: (value: typeof manager) => Promise<unknown>,
      ): Promise<unknown> => callback(manager),
    );
    const service = new OrganizationService(
      { transaction } as unknown as DataSource,
      {} as Repository<OrgUnitEntity>,
      {} as Repository<PositionEntity>,
      {} as Repository<MembershipEntity>,
      {} as Repository<ManagerResolutionEntity>,
    );

    await expect(
      service.commitOrgUnitTreeDraft({
        moves: [
          {
            baseUpdatedAt: baseUpdatedAt.toISOString(),
            id: '00000000-0000-4000-8000-000000000001',
            parentId: '00000000-0000-4000-8000-000000000002',
          },
          {
            baseUpdatedAt: baseUpdatedAt.toISOString(),
            id: '00000000-0000-4000-8000-000000000002',
            parentId: '00000000-0000-4000-8000-000000000001',
          },
        ],
      }),
    ).rejects.toThrow('cycle');
    expect(orgUnitRepository.save).not.toHaveBeenCalled();
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

  it('clears membership effectiveTo when update input explicitly passes null', async (): Promise<void> => {
    const existingMembership = {
      createdAt: new Date(),
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-12-31',
      id: 'membership-1',
      isPrimary: false,
      memberId: 'member-1',
      orgUnitId: 'org-1',
      positionId: null,
      updatedAt: new Date(),
    };
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
      findOne: jest.fn<Promise<MembershipEntity | null>, []>(() =>
        Promise.resolve(existingMembership),
      ),
      merge: jest.fn(
        (
          entity: MembershipEntity,
          update: Partial<MembershipEntity>,
        ): MembershipEntity => ({
          ...entity,
          ...update,
        }),
      ),
      save: jest.fn((entity: MembershipEntity): Promise<MembershipEntity> => {
        return Promise.resolve(entity);
      }),
    } as unknown as Repository<MembershipEntity>;
    const service = new OrganizationService(
      {} as DataSource,
      orgUnitRepository,
      {} as Repository<PositionEntity>,
      membershipRepository,
      {} as Repository<ManagerResolutionEntity>,
    );

    const membership = await service.updateMembership({
      effectiveFrom: null,
      effectiveTo: null,
      id: 'membership-1',
      isPrimary: null,
      orgUnitId: null,
      positionId: null,
    });

    expect(membership.effectiveTo).toBeNull();
    expect(membershipRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ effectiveTo: null }),
    );
  });

  it('clears manager resolution effectiveTo when update input explicitly passes null', async (): Promise<void> => {
    const existingResolution = {
      createdAt: new Date(),
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-12-31',
      id: 'resolution-1',
      managerMemberId: 'manager-1',
      priority: 10,
      scopeId: 'member-1',
      scopeType: ManagerResolutionScopeTypeEnum.MEMBER,
    };
    const managerResolutionRepository = {
      findOne: jest.fn<Promise<ManagerResolutionEntity | null>, []>(() =>
        Promise.resolve(existingResolution),
      ),
      merge: jest.fn(
        (
          entity: ManagerResolutionEntity,
          update: Partial<ManagerResolutionEntity>,
        ): ManagerResolutionEntity => ({
          ...entity,
          ...update,
        }),
      ),
      save: jest.fn(
        (entity: ManagerResolutionEntity): Promise<ManagerResolutionEntity> => {
          return Promise.resolve(entity);
        },
      ),
    } as unknown as Repository<ManagerResolutionEntity>;
    const service = new OrganizationService(
      {} as DataSource,
      {} as Repository<OrgUnitEntity>,
      {} as Repository<PositionEntity>,
      {} as Repository<MembershipEntity>,
      managerResolutionRepository,
    );

    const resolution = await service.updateManagerResolution({
      effectiveFrom: null,
      effectiveTo: null,
      id: 'resolution-1',
      managerMemberId: null,
      priority: null,
      scopeId: null,
      scopeType: null,
    });

    expect(resolution.effectiveTo).toBeNull();
    expect(managerResolutionRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ effectiveTo: null }),
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

function createOrgUnitFixture(
  value: Partial<OrgUnitEntity>,
): OrgUnitEntity {
  return {
    code: value.code ?? 'ORG',
    createdAt: value.createdAt ?? baseUpdatedAt,
    deletedAt: value.deletedAt ?? null,
    id: value.id ?? '00000000-0000-4000-8000-000000000001',
    metadata: value.metadata ?? {},
    name: value.name ?? 'Organization',
    parentId: value.parentId ?? null,
    path: value.path ?? 'org.n00000000_0000_4000_8000_000000000001',
    type: value.type ?? OrgUnitTypeEnum.DEPARTMENT,
    updatedAt: value.updatedAt ?? baseUpdatedAt,
  };
}

function createOrgUnitTreeDraftRepository(
  orgUnits: OrgUnitEntity[],
): Repository<OrgUnitEntity> {
  type OrgUnitTreeDraftQueryBuilder = Readonly<{
    andWhere: (
      condition: string,
      nextParameters?: {
        readonly id?: string;
        readonly previousPath?: string;
      },
    ) => OrgUnitTreeDraftQueryBuilder;
    getMany: () => Promise<OrgUnitEntity[]>;
    where: (condition: string) => OrgUnitTreeDraftQueryBuilder;
  }>;

  const find = jest.fn((): Promise<OrgUnitEntity[]> =>
    Promise.resolve(orgUnits),
  );
  const save = jest.fn((entity: OrgUnitEntity): Promise<OrgUnitEntity> => {
    const index = orgUnits.findIndex((orgUnit) => orgUnit.id === entity.id);

    if (index >= 0) {
      orgUnits[index] = entity;
    }

    return Promise.resolve(entity);
  });
  const merge = jest.fn(
    (
      entity: OrgUnitEntity,
      patch: Partial<OrgUnitEntity>,
    ): OrgUnitEntity => Object.assign(entity, patch),
  );
  const createQueryBuilder = jest.fn((): OrgUnitTreeDraftQueryBuilder => {
    const parameters: { id?: string; previousPath?: string } = {};
    const queryBuilder: OrgUnitTreeDraftQueryBuilder = {
      andWhere: jest.fn(
        (
          _condition: string,
          nextParameters?: {
            readonly id?: string;
            readonly previousPath?: string;
          },
        ): OrgUnitTreeDraftQueryBuilder => {
          Object.assign(parameters, nextParameters);

          return queryBuilder;
        },
      ),
      getMany: jest.fn((): Promise<OrgUnitEntity[]> => {
        const previousPath = parameters.previousPath ?? '';
        const id = parameters.id ?? '';

        return Promise.resolve(
          orgUnits.filter(
            (orgUnit) =>
              orgUnit.id !== id &&
              orgUnit.path !== previousPath &&
              orgUnit.path.startsWith(`${previousPath}.`),
          ),
        );
      }),
      where: jest.fn((condition: string): OrgUnitTreeDraftQueryBuilder => {
        void condition;

        return queryBuilder;
      }),
    };

    return queryBuilder;
  });

  return {
    createQueryBuilder,
    find,
    merge,
    save,
  } as unknown as Repository<OrgUnitEntity>;
}
