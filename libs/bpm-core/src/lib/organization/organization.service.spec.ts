import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource, FindOperator, Repository } from 'typeorm';
import { BPMRootRuntimeOptions } from '../bpm/bpm-root-options';
import {
  CommitOrgUnitTreeDraftMoveInput,
  UpdateOrgUnitInput,
} from './dto/org-unit.input';
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

/**
 * A DataSource that reports no approval-template or workflow metadata, which
 * is what an `OrganizationModule`-only host looks like. `deletePosition` then
 * has nothing beyond the organization tables to check.
 */
function createDataSourceWithoutWorkflowArtifacts(): DataSource {
  return {
    hasMetadata: (): boolean => false,
  } as unknown as DataSource;
}

/**
 * A DataSource carrying approval-template versions and pending ad-hoc
 * directives, so `deletePosition` can be driven against workflow artifacts
 * that do — and do not — reference the position.
 */
function createDataSourceWithWorkflowArtifacts({
  pendingAdhocDirectiveCount = 0,
  versions = [],
}: {
  readonly pendingAdhocDirectiveCount?: number;
  readonly versions?: readonly Readonly<Record<string, unknown>>[];
} = {}): DataSource {
  const adhocQueryBuilder = {
    andWhere: (): unknown => adhocQueryBuilder,
    getCount: (): Promise<number> =>
      Promise.resolve(pendingAdhocDirectiveCount),
    where: (): unknown => adhocQueryBuilder,
  };

  const versionQueryBuilder = {
    andWhere: (): unknown => versionQueryBuilder,
    getMany: (): Promise<readonly Readonly<Record<string, unknown>>[]> =>
      Promise.resolve(versions),
    select: (): unknown => versionQueryBuilder,
    where: (): unknown => versionQueryBuilder,
  };

  return {
    getRepository: (entity: { readonly name: string }): unknown => ({
      createQueryBuilder: (): unknown =>
        entity.name === 'AdhocDirectiveEntity'
          ? adhocQueryBuilder
          : versionQueryBuilder,
    }),
    hasMetadata: (): boolean => true,
  } as unknown as DataSource;
}

/**
 * Compile-time half of the BPM-1 fix. The runtime tests below prove the service
 * honours the three states; nothing but this stops someone changing
 * `parentId?` back to `parentId!`, which would again force every caller into
 * passing `null` for a field they did not mean to touch.
 */
const renameOnly: UpdateOrgUnitInput = { id: 'org-1', name: 'Finance' };

/**
 * The inverse contract, one type over: a draft move must state a destination,
 * so leaving `parentId` out has to be a compile error rather than a silent
 * move to the top level.
 */
// @ts-expect-error parentId is required on CommitOrgUnitTreeDraftMoveInput
const moveWithoutDestination: CommitOrgUnitTreeDraftMoveInput = {
  baseUpdatedAt: '2026-05-12T08:00:00.000Z',
  id: 'org-1',
};

describe('OrganizationService', () => {
  it('types a rename that leaves the parent alone, and rejects a move with no destination', (): void => {
    expect(renameOnly.parentId).toBeUndefined();
    expect(moveWithoutDestination.id).toBe('org-1');
  });

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
    const find = jest.fn((): Promise<readonly OrgUnitEntity[]> =>
      Promise.resolve([]),
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
    const positionFind = jest.fn((): Promise<readonly PositionEntity[]> =>
      Promise.resolve([]),
    );
    const membershipFind = jest.fn((): Promise<readonly MembershipEntity[]> =>
      Promise.resolve([]),
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

  it('fetches every org unit without pagination when all is true', async (): Promise<void> => {
    const find = jest.fn((): Promise<readonly OrgUnitEntity[]> =>
      Promise.resolve([]),
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

    await service.listOrgUnits({ all: true, page: 3, pageSize: 5 });

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({ order: { path: 'ASC' } }),
    );
    expect(find).toHaveBeenCalledWith(
      expect.not.objectContaining({ skip: expect.anything() }),
    );
    expect(find).toHaveBeenCalledWith(
      expect.not.objectContaining({ take: expect.anything() }),
    );
  });

  it('returns the full org unit list when pageSize is omitted', async (): Promise<void> => {
    const find = jest.fn((): Promise<readonly OrgUnitEntity[]> =>
      Promise.resolve([]),
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

    await service.listOrgUnits({});

    expect(find).toHaveBeenCalledWith(
      expect.not.objectContaining({ skip: expect.anything() }),
    );
    expect(find).toHaveBeenCalledWith(
      expect.not.objectContaining({ take: expect.anything() }),
    );
  });

  it('clamps an oversized pageSize to the maximum page size', async (): Promise<void> => {
    const find = jest.fn((): Promise<readonly OrgUnitEntity[]> =>
      Promise.resolve([]),
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

    await service.listOrgUnits({ page: 1, pageSize: 5000 });

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 100 }),
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
    expect(orgUnits[1]?.parentId).toBe('00000000-0000-4000-8000-000000000004');
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

  it('keeps the current parent when updateOrgUnit omits parentId', async (): Promise<void> => {
    const parent = {
      code: 'ROOT',
      createdAt: new Date(),
      deletedAt: null,
      id: 'org-root',
      metadata: {},
      name: 'Root',
      parentId: null,
      path: 'org.norg_root',
      type: OrgUnitTypeEnum.COMPANY,
      updatedAt: new Date(),
    };
    const existing = {
      ...parent,
      code: 'FIN',
      id: 'org-fin',
      name: 'Finance',
      parentId: 'org-root',
      path: 'org.norg_root.norg_fin',
      type: OrgUnitTypeEnum.DEPARTMENT,
    };
    const orgUnitRepository = {
      findOne: jest.fn(
        (options: {
          readonly where: { readonly id?: string };
        }): Promise<OrgUnitEntity | null> => {
          if (options.where.id === 'org-root') {
            return Promise.resolve(parent);
          }

          if (options.where.id === 'org-fin') {
            return Promise.resolve(existing);
          }

          return Promise.resolve(null);
        },
      ),
      merge: jest.fn(
        (
          target: OrgUnitEntity,
          patch: Partial<OrgUnitEntity>,
        ): OrgUnitEntity => ({ ...target, ...patch }),
      ),
    } as unknown as Repository<OrgUnitEntity>;
    const saved: OrgUnitEntity[] = [];
    const dataSource = {
      transaction: jest.fn(
        (
          runInTransaction: (manager: {
            readonly getRepository: () => unknown;
          }) => Promise<OrgUnitEntity>,
        ): Promise<OrgUnitEntity> =>
          runInTransaction({
            getRepository: () => ({
              save: (entity: OrgUnitEntity): Promise<OrgUnitEntity> => {
                saved.push(entity);

                return Promise.resolve(entity);
              },
            }),
          }),
      ),
    } as unknown as DataSource;
    const service = new OrganizationService(
      dataSource,
      orgUnitRepository,
      {} as Repository<PositionEntity>,
      {} as Repository<MembershipEntity>,
      {} as Repository<ManagerResolutionEntity>,
    );

    // A plain rename. `parentId` is left out, which is the only way to say
    // "do not touch the parent" — passing `null` here would move the unit and
    // its whole subtree to the top level.
    const result = await service.updateOrgUnit({
      id: 'org-fin',
      name: 'Finance & Accounting',
    });

    expect(result.parentId).toBe('org-root');
    expect(result.path).toBe('org.norg_root.norg_fin');
    expect(saved).toHaveLength(1);
  });

  it('moves an org unit to the top level when updateOrgUnit passes parentId null', async (): Promise<void> => {
    const existing = {
      code: 'FIN',
      createdAt: new Date(),
      deletedAt: null,
      id: 'org-fin',
      metadata: {},
      name: 'Finance',
      parentId: 'org-root',
      path: 'org.norg_root.norg_fin',
      type: OrgUnitTypeEnum.DEPARTMENT,
      updatedAt: new Date(),
    };
    const orgUnitRepository = {
      createQueryBuilder: jest.fn(() => ({
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn(() => Promise.resolve([])),
        where: jest.fn().mockReturnThis(),
      })),
      findOne: jest.fn(
        (options: {
          readonly where: { readonly id?: string };
        }): Promise<OrgUnitEntity | null> =>
          Promise.resolve(options.where.id === 'org-fin' ? existing : null),
      ),
      merge: jest.fn(
        (
          target: OrgUnitEntity,
          patch: Partial<OrgUnitEntity>,
        ): OrgUnitEntity => ({ ...target, ...patch }),
      ),
    } as unknown as Repository<OrgUnitEntity>;
    const dataSource = {
      transaction: jest.fn(
        (
          runInTransaction: (manager: {
            readonly getRepository: () => unknown;
          }) => Promise<OrgUnitEntity>,
        ): Promise<OrgUnitEntity> =>
          runInTransaction({
            getRepository: () => ({
              createQueryBuilder: () => ({
                andWhere: jest.fn().mockReturnThis(),
                getMany: jest.fn(() => Promise.resolve([])),
                where: jest.fn().mockReturnThis(),
              }),
              merge: (
                target: OrgUnitEntity,
                patch: Partial<OrgUnitEntity>,
              ): OrgUnitEntity => ({ ...target, ...patch }),
              save: (entity: OrgUnitEntity): Promise<OrgUnitEntity> =>
                Promise.resolve(entity),
            }),
          }),
      ),
    } as unknown as DataSource;
    const service = new OrganizationService(
      dataSource,
      orgUnitRepository,
      {} as Repository<PositionEntity>,
      {} as Repository<MembershipEntity>,
      {} as Repository<ManagerResolutionEntity>,
    );

    const result = await service.updateOrgUnit({
      id: 'org-fin',
      parentId: null,
    });

    expect(result.parentId).toBeNull();
    expect(result.path).toBe('org.norg_fin');
  });

  it('deletes a position that nothing references', async (): Promise<void> => {
    const positionDelete = jest.fn(() => Promise.resolve({ affected: 1 }));
    const positionRepository = {
      delete: positionDelete,
      findOne: jest.fn(() =>
        Promise.resolve({ id: 'position-1' } as PositionEntity),
      ),
    } as unknown as Repository<PositionEntity>;
    const membershipRepository = {
      count: jest.fn(() => Promise.resolve(0)),
    } as unknown as Repository<MembershipEntity>;
    const managerResolutionRepository = {
      count: jest.fn(() => Promise.resolve(0)),
    } as unknown as Repository<ManagerResolutionEntity>;
    const service = new OrganizationService(
      createDataSourceWithoutWorkflowArtifacts(),
      {} as Repository<OrgUnitEntity>,
      positionRepository,
      membershipRepository,
      managerResolutionRepository,
    );

    await expect(service.deletePosition('position-1')).resolves.toBe(true);
    expect(positionDelete).toHaveBeenCalledWith('position-1');
  });

  it('refuses to delete a position that memberships still reference', async (): Promise<void> => {
    const positionDelete = jest.fn(() => Promise.resolve({ affected: 1 }));
    const positionRepository = {
      delete: positionDelete,
      findOne: jest.fn(() =>
        Promise.resolve({ id: 'position-1' } as PositionEntity),
      ),
    } as unknown as Repository<PositionEntity>;
    const membershipRepository = {
      count: jest.fn(() => Promise.resolve(2)),
    } as unknown as Repository<MembershipEntity>;
    const service = new OrganizationService(
      createDataSourceWithoutWorkflowArtifacts(),
      {} as Repository<OrgUnitEntity>,
      positionRepository,
      membershipRepository,
      {} as Repository<ManagerResolutionEntity>,
    );

    await expect(service.deletePosition('position-1')).rejects.toThrow(
      'Position with memberships cannot be deleted',
    );
    expect(positionDelete).not.toHaveBeenCalled();
  });

  it('refuses to delete a position that manager resolutions still reference', async (): Promise<void> => {
    const positionDelete = jest.fn(() => Promise.resolve({ affected: 1 }));
    const positionRepository = {
      delete: positionDelete,
      findOne: jest.fn(() =>
        Promise.resolve({ id: 'position-1' } as PositionEntity),
      ),
    } as unknown as Repository<PositionEntity>;
    const membershipRepository = {
      count: jest.fn(() => Promise.resolve(0)),
    } as unknown as Repository<MembershipEntity>;
    const managerResolutionCount = jest.fn(() => Promise.resolve(1));
    const managerResolutionRepository = {
      count: managerResolutionCount,
    } as unknown as Repository<ManagerResolutionEntity>;
    const service = new OrganizationService(
      createDataSourceWithoutWorkflowArtifacts(),
      {} as Repository<OrgUnitEntity>,
      positionRepository,
      membershipRepository,
      managerResolutionRepository,
    );

    await expect(service.deletePosition('position-1')).rejects.toThrow(
      'Position with manager resolutions cannot be deleted',
    );
    expect(managerResolutionCount).toHaveBeenCalledWith({
      where: {
        scopeId: 'position-1',
        scopeType: ManagerResolutionScopeTypeEnum.POSITION,
      },
    });
    expect(positionDelete).not.toHaveBeenCalled();
  });

  it('refuses to delete a position a live approval template routes through', async (): Promise<void> => {
    const positionDelete = jest.fn(() => Promise.resolve({ affected: 1 }));
    const positionRepository = {
      delete: positionDelete,
      findOne: jest.fn(() =>
        Promise.resolve({ id: 'position-1' } as PositionEntity),
      ),
    } as unknown as Repository<PositionEntity>;
    // No membership and no manager resolution: the two earlier guards let this
    // through, which is exactly the gap a temporarily unstaffed position falls
    // into. A template that routes approvals to it would be left pointing at a
    // row that no longer exists.
    const dataSource = createDataSourceWithWorkflowArtifacts({
      versions: [
        {
          id: 'version-1',
          templateId: 'template-1',
          version: 3,
          workflowDefinition: {
            nodes: [
              {
                data: {
                  approverResolver: {
                    orgUnitId: 'org-1',
                    positionId: 'position-1',
                    type: 'ORG_UNIT_POSITION',
                  },
                },
                id: 'node-1',
              },
            ],
          },
        },
      ],
    });
    const service = new OrganizationService(
      dataSource,
      {} as Repository<OrgUnitEntity>,
      positionRepository,
      {
        count: jest.fn(() => Promise.resolve(0)),
      } as unknown as Repository<MembershipEntity>,
      {
        count: jest.fn(() => Promise.resolve(0)),
      } as unknown as Repository<ManagerResolutionEntity>,
    );

    await expect(service.deletePosition('position-1')).rejects.toThrow(
      'template-1 v3',
    );
    expect(positionDelete).not.toHaveBeenCalled();
  });

  it('allows deleting a position no live approval template mentions', async (): Promise<void> => {
    const positionDelete = jest.fn(() => Promise.resolve({ affected: 1 }));
    const positionRepository = {
      delete: positionDelete,
      findOne: jest.fn(() =>
        Promise.resolve({ id: 'position-1' } as PositionEntity),
      ),
    } as unknown as Repository<PositionEntity>;
    const dataSource = createDataSourceWithWorkflowArtifacts({
      versions: [
        {
          id: 'version-1',
          templateId: 'template-1',
          version: 3,
          workflowDefinition: {
            nodes: [
              {
                data: {
                  approverResolver: {
                    positionId: 'position-other',
                    type: 'POSITION',
                  },
                },
                id: 'node-1',
              },
            ],
          },
        },
      ],
    });
    const service = new OrganizationService(
      dataSource,
      {} as Repository<OrgUnitEntity>,
      positionRepository,
      {
        count: jest.fn(() => Promise.resolve(0)),
      } as unknown as Repository<MembershipEntity>,
      {
        count: jest.fn(() => Promise.resolve(0)),
      } as unknown as Repository<ManagerResolutionEntity>,
    );

    await expect(service.deletePosition('position-1')).resolves.toBe(true);
    expect(positionDelete).toHaveBeenCalledWith('position-1');
  });

  it('refuses to delete a position a running instance still targets ad hoc', async (): Promise<void> => {
    const positionDelete = jest.fn(() => Promise.resolve({ affected: 1 }));
    const positionRepository = {
      delete: positionDelete,
      findOne: jest.fn(() =>
        Promise.resolve({ id: 'position-1' } as PositionEntity),
      ),
    } as unknown as Repository<PositionEntity>;
    // No template mentions it, but a stage approver countersigned the whole
    // position on a live instance and that directive has not been consumed.
    const dataSource = createDataSourceWithWorkflowArtifacts({
      pendingAdhocDirectiveCount: 2,
    });
    const service = new OrganizationService(
      dataSource,
      {} as Repository<OrgUnitEntity>,
      positionRepository,
      {
        count: jest.fn(() => Promise.resolve(0)),
      } as unknown as Repository<MembershipEntity>,
      {
        count: jest.fn(() => Promise.resolve(0)),
      } as unknown as Repository<ManagerResolutionEntity>,
    );

    await expect(service.deletePosition('position-1')).rejects.toThrow(
      'pending ad-hoc directive',
    );
    expect(positionDelete).not.toHaveBeenCalled();
  });

  describe('organization time zone', () => {
    const createService = (
      rootOptions?: BPMRootRuntimeOptions,
    ): OrganizationService =>
      new OrganizationService(
        {} as DataSource,
        {} as Repository<OrgUnitEntity>,
        {} as Repository<PositionEntity>,
        {} as Repository<MembershipEntity>,
        {} as Repository<ManagerResolutionEntity>,
        rootOptions,
      );
    const readDateOnly = (service: OrganizationService, date: Date): string =>
      (
        service as unknown as {
          readonly toDateOnly: (value: Date) => string;
        }
      ).toDateOnly(date);

    it('formats date-only values in Asia/Taipei when no zone is configured', (): void => {
      const service = createService();

      expect(readDateOnly(service, new Date('2026-05-10T16:30:00.000Z'))).toBe(
        '2026-05-11',
      );
    });

    it('formats date-only values in the configured zone', (): void => {
      const service = createService({ organizationTimeZone: 'UTC' });

      expect(readDateOnly(service, new Date('2026-05-10T16:30:00.000Z'))).toBe(
        '2026-05-10',
      );
    });

    it('rejects an unknown zone when the service is created', (): void => {
      expect(() =>
        createService({ organizationTimeZone: 'Nowhere/City' }),
      ).toThrow('organizationTimeZone');
    });

    describe('activeOnly listings and counts', () => {
      // 01:00 on 2026-10-14 in Asia/Taipei, still 2026-10-13 in UTC.
      const instant = new Date('2026-10-13T17:00:00.000Z');

      beforeEach((): void => {
        jest.useFakeTimers({ now: instant });
      });

      afterEach((): void => {
        jest.useRealTimers();
      });

      type ActiveOnlyCall = (service: OrganizationService) => Promise<unknown>;

      // Each entry drives one of the four `toDateOnly(new Date())` call sites
      // and returns the `where` clause the repository was given.
      const readActiveOnlyDate = async (
        repository: 'membership' | 'managerResolution',
        method: 'find' | 'count',
        call: ActiveOnlyCall,
        rootOptions?: BPMRootRuntimeOptions,
      ): Promise<string> => {
        const query = jest.fn((): Promise<unknown> =>
          Promise.resolve(method === 'find' ? [] : 0),
        );
        const repositoryStub = { [method]: query } as unknown;
        const service = new OrganizationService(
          {} as DataSource,
          {} as Repository<OrgUnitEntity>,
          {} as Repository<PositionEntity>,
          (repository === 'membership'
            ? repositoryStub
            : {}) as Repository<MembershipEntity>,
          (repository === 'managerResolution'
            ? repositoryStub
            : {}) as Repository<ManagerResolutionEntity>,
          rootOptions,
        );

        await call(service);

        const calls = query.mock.calls as unknown as readonly [
          {
            readonly where: readonly {
              readonly effectiveFrom: FindOperator<string>;
            }[];
          },
        ][];

        return calls[0][0].where[0].effectiveFrom.value;
      };

      const sites: readonly [
        string,
        'membership' | 'managerResolution',
        'find' | 'count',
        ActiveOnlyCall,
      ][] = [
        [
          'listMemberships',
          'membership',
          'find',
          (service) => service.listMemberships({ activeOnly: true }),
        ],
        [
          'countMemberships',
          'membership',
          'count',
          (service) => service.countMemberships({ activeOnly: true }),
        ],
        [
          'listManagerResolutions',
          'managerResolution',
          'find',
          (service) => service.listManagerResolutions({ activeOnly: true }),
        ],
        [
          'countManagerResolutions',
          'managerResolution',
          'count',
          (service) => service.countManagerResolutions({ activeOnly: true }),
        ],
      ];

      it.each(sites)(
        '%s reads today in Asia/Taipei by default',
        async (_name, repository, method, call): Promise<void> => {
          await expect(
            readActiveOnlyDate(repository, method, call),
          ).resolves.toBe('2026-10-14');
        },
      );

      it.each(sites)(
        '%s reads today in UTC when the zone is UTC',
        async (_name, repository, method, call): Promise<void> => {
          await expect(
            readActiveOnlyDate(repository, method, call, {
              organizationTimeZone: 'UTC',
            }),
          ).resolves.toBe('2026-10-13');
        },
      );
    });

    it('resolves the manager of an instant by the zone, Asia/Taipei by default', async (): Promise<void> => {
      // 01:00 on 2026-10-14 in Asia/Taipei, 2026-10-13 in UTC.
      const instant = new Date('2026-10-13T17:00:00.000Z');
      const createResolving = (
        rootOptions?: BPMRootRuntimeOptions,
      ): OrganizationService => {
        const membershipRepository = {
          find: jest.fn<Promise<readonly MembershipEntity[]>, []>(() =>
            Promise.resolve([]),
          ),
        } as unknown as Repository<MembershipEntity>;
        const managerResolutionRepository = {
          find: jest.fn<Promise<readonly ManagerResolutionEntity[]>, []>(() =>
            Promise.resolve([
              {
                effectiveFrom: '2026-10-14',
                effectiveTo: null,
                managerMemberId: 'manager-new',
                priority: 0,
                scopeId: 'member-1',
                scopeType: ManagerResolutionScopeTypeEnum.MEMBER,
              } as ManagerResolutionEntity,
            ]),
          ),
        } as unknown as Repository<ManagerResolutionEntity>;

        return new OrganizationService(
          {} as DataSource,
          {} as Repository<OrgUnitEntity>,
          {} as Repository<PositionEntity>,
          membershipRepository,
          managerResolutionRepository,
          rootOptions,
        );
      };

      await expect(
        createResolving().resolveManagerMemberId('member-1', instant),
      ).resolves.toBe('manager-new');
      await expect(
        createResolving({
          organizationTimeZone: 'UTC',
        }).resolveManagerMemberId('member-1', instant),
      ).resolves.toBeNull();
    });
  });
});

function createOrgUnitFixture(value: Partial<OrgUnitEntity>): OrgUnitEntity {
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
    (entity: OrgUnitEntity, patch: Partial<OrgUnitEntity>): OrgUnitEntity =>
      Object.assign(entity, patch),
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

describe('OrganizationService.deleteOrgUnit', () => {
  // 01:00 on 2026-10-14 in Asia/Taipei, still 2026-10-13 in UTC: "today" for
  // the organization is the 14th.
  const instant = new Date('2026-10-13T17:00:00.000Z');
  const RETIRING_ID = '00000000-0000-4000-8000-0000000000a1';
  const SUCCESSOR_ID = '00000000-0000-4000-8000-0000000000b2';

  type Row = Record<string, unknown> & { id: string };

  beforeEach((): void => {
    jest.useFakeTimers({ now: instant });
  });

  afterEach((): void => {
    jest.useRealTimers();
  });

  const matchesValue = (actual: unknown, expected: unknown): boolean => {
    if (expected instanceof FindOperator) {
      const operand = expected.value as string;

      switch (expected.type) {
        case 'isNull':
          return actual === null || actual === undefined;
        case 'moreThanOrEqual':
          return typeof actual === 'string' && actual >= operand;
        case 'lessThanOrEqual':
          return typeof actual === 'string' && actual <= operand;
        default:
          throw new Error(`Unsupported operator ${expected.type}`);
      }
    }

    return actual === expected;
  };

  const matchesWhere = (row: Row, where: unknown): boolean => {
    if (Array.isArray(where)) {
      return where.some((clause) => matchesWhere(row, clause));
    }

    return Object.entries((where ?? {}) as Record<string, unknown>).every(
      ([key, expected]) => matchesValue(row[key], expected),
    );
  };

  const createStoreRepository = (rows: Row[]): Repository<ObjectLiteralRow> => {
    const find = jest.fn(
      ({ where }: { readonly where?: unknown } = {}): Promise<Row[]> =>
        Promise.resolve(rows.filter((row) => matchesWhere(row, where))),
    );

    return {
      count: jest.fn(
        ({ where }: { readonly where?: unknown } = {}): Promise<number> =>
          Promise.resolve(
            rows.filter((row) => matchesWhere(row, where)).length,
          ),
      ),
      create: jest.fn((value: Record<string, unknown>): Row => ({
        ...value,
        id: '',
      })),
      delete: jest.fn((ids: readonly string[]): Promise<void> => {
        const remaining = rows.filter((row) => !ids.includes(row.id));

        rows.splice(0, rows.length, ...remaining);

        return Promise.resolve();
      }),
      find,
      findOne: jest.fn(
        ({ where }: { readonly where?: unknown }): Promise<Row | null> =>
          Promise.resolve(rows.find((row) => matchesWhere(row, where)) ?? null),
      ),
      // TypeORM's merge writes into the entity it is given and returns it,
      // so a stub that copied instead would hide a caller reading the entity
      // again after merging into it.
      merge: jest.fn((row: Row, patch: Record<string, unknown>): Row =>
        Object.assign(row, patch),
      ),
      save: jest.fn((values: readonly Row[]): Promise<readonly Row[]> => {
        values.forEach((value, index) => {
          const position = rows.findIndex((row) => row.id === value.id);

          if (value.id && position >= 0) {
            rows.splice(position, 1, value);
          } else {
            rows.push({ ...value, id: `new-${rows.length}-${index}` });
          }
        });

        return Promise.resolve(values);
      }),
      softDelete: jest.fn((id: string): Promise<void> => {
        const position = rows.findIndex((row) => row.id === id);

        rows.splice(position, 1, {
          ...rows[position],
          deletedAt: instant,
        } as Row);

        return Promise.resolve();
      }),
    } as unknown as Repository<ObjectLiteralRow>;
  };

  type ObjectLiteralRow = Record<string, unknown>;

  const membership = (value: Partial<MembershipEntity>): Row => ({
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    isPrimary: true,
    memberId: 'member-1',
    orgUnitId: RETIRING_ID,
    positionId: 'position-1',
    ...value,
    id: value.id ?? `membership-${Math.random()}`,
  });

  const managerRule = (value: Partial<ManagerResolutionEntity>): Row => ({
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    managerMemberId: 'manager-1',
    priority: 100,
    scopeId: RETIRING_ID,
    scopeType: ManagerResolutionScopeTypeEnum.ORG_UNIT,
    ...value,
    id: value.id ?? `rule-${Math.random()}`,
  });

  const setUp = ({
    managerRules = [],
    memberships = [],
    orgUnits = [
      createOrgUnitFixture({ code: 'OLD', id: RETIRING_ID }) as unknown as Row,
      createOrgUnitFixture({ code: 'NEW', id: SUCCESSOR_ID }) as unknown as Row,
    ],
  }: {
    readonly managerRules?: Row[];
    readonly memberships?: Row[];
    readonly orgUnits?: Row[];
  }): {
    readonly managerRules: Row[];
    readonly memberships: Row[];
    readonly orgUnits: Row[];
    readonly service: OrganizationService;
  } => {
    const repositories = new Map<unknown, Repository<ObjectLiteralRow>>([
      [OrgUnitEntity, createStoreRepository(orgUnits)],
      [MembershipEntity, createStoreRepository(memberships)],
      [ManagerResolutionEntity, createStoreRepository(managerRules)],
    ]);
    const manager = {
      getRepository: (entity: unknown): unknown => repositories.get(entity),
    };
    const dataSource = {
      transaction: (
        callback: (value: typeof manager) => Promise<unknown>,
      ): Promise<unknown> => callback(manager),
    } as unknown as DataSource;
    const service = new OrganizationService(
      dataSource,
      repositories.get(OrgUnitEntity) as unknown as Repository<OrgUnitEntity>,
      {} as Repository<PositionEntity>,
      repositories.get(
        MembershipEntity,
      ) as unknown as Repository<MembershipEntity>,
      repositories.get(
        ManagerResolutionEntity,
      ) as unknown as Repository<ManagerResolutionEntity>,
    );

    return { managerRules, memberships, orgUnits, service };
  };

  const isRetired = (orgUnits: readonly Row[]): boolean =>
    orgUnits.find((orgUnit) => orgUnit.id === RETIRING_ID)?.['deletedAt'] !==
    null;

  it('retires a unit whose memberships have all ended', async (): Promise<void> => {
    const { orgUnits, service } = setUp({
      memberships: [membership({ effectiveTo: '2026-10-13' })],
    });

    await expect(service.deleteOrgUnit(RETIRING_ID)).resolves.toBe(true);
    expect(isRetired(orgUnits)).toBe(true);
  });

  it('refuses while a membership ends today, in the organization time zone', async (): Promise<void> => {
    // effectiveTo is inclusive and "today" is 2026-10-14 in Asia/Taipei,
    // although the UTC date is still the 13th.
    const { orgUnits, service } = setUp({
      memberships: [membership({ effectiveTo: '2026-10-14' })],
    });

    await expect(service.deleteOrgUnit(RETIRING_ID)).rejects.toThrow(
      'Org unit with memberships cannot be deleted: 1 open membership(s) and 0 open manager rule(s) remain.',
    );
    expect(isRetired(orgUnits)).toBe(false);
  });

  it('refuses while a membership only starts in the future', async (): Promise<void> => {
    const { service } = setUp({
      memberships: [membership({ effectiveFrom: '2026-11-01' })],
    });

    await expect(service.deleteOrgUnit(RETIRING_ID)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuses while an ORG_UNIT manager rule is still open, even with no memberships', async (): Promise<void> => {
    const { service } = setUp({ managerRules: [managerRule({})] });

    await expect(service.deleteOrgUnit(RETIRING_ID)).rejects.toThrow(
      '0 open membership(s) and 1 open manager rule(s) remain.',
    );
  });

  it('ignores ended manager rules and rules scoped to something else', async (): Promise<void> => {
    const { orgUnits, service } = setUp({
      managerRules: [
        managerRule({ effectiveTo: '2026-10-13' }),
        managerRule({
          scopeId: RETIRING_ID,
          scopeType: ManagerResolutionScopeTypeEnum.MEMBER,
        }),
      ],
    });

    await expect(service.deleteOrgUnit(RETIRING_ID)).resolves.toBe(true);
    expect(isRetired(orgUnits)).toBe(true);
  });

  it('still refuses while live child units remain, successor or not', async (): Promise<void> => {
    const { service } = setUp({
      orgUnits: [
        createOrgUnitFixture({ id: RETIRING_ID }) as unknown as Row,
        createOrgUnitFixture({ id: SUCCESSOR_ID }) as unknown as Row,
        createOrgUnitFixture({
          id: '00000000-0000-4000-8000-0000000000c3',
          parentId: RETIRING_ID,
        }) as unknown as Row,
      ],
    });

    await expect(
      service.deleteOrgUnit(RETIRING_ID, { transferToOrgUnitId: SUCCESSOR_ID }),
    ).rejects.toThrow('Org unit with child units cannot be deleted');
  });

  it('ends started memberships yesterday and continues them in the successor from today', async (): Promise<void> => {
    const { memberships, orgUnits, service } = setUp({
      memberships: [
        membership({
          effectiveTo: '2027-12-31',
          id: 'started',
          isPrimary: true,
        }),
      ],
    });

    await service.deleteOrgUnit(RETIRING_ID, {
      transferToOrgUnitId: SUCCESSOR_ID,
    });

    expect(memberships).toEqual([
      expect.objectContaining({
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-10-13',
        id: 'started',
        orgUnitId: RETIRING_ID,
      }),
      expect.objectContaining({
        effectiveFrom: '2026-10-14',
        effectiveTo: '2027-12-31',
        isPrimary: true,
        memberId: 'member-1',
        orgUnitId: SUCCESSOR_ID,
        positionId: 'position-1',
      }),
    ]);
    expect(isRetired(orgUnits)).toBe(true);
  });

  it('moves a membership that starts today or later without ending it', async (): Promise<void> => {
    const { memberships, service } = setUp({
      memberships: [
        membership({ effectiveFrom: '2026-10-14', id: 'today' }),
        membership({
          effectiveFrom: '2026-12-01',
          id: 'future',
          memberId: 'member-2',
        }),
      ],
    });

    await service.deleteOrgUnit(RETIRING_ID, {
      transferToOrgUnitId: SUCCESSOR_ID,
    });

    expect(memberships).toEqual([
      expect.objectContaining({
        effectiveFrom: '2026-10-14',
        id: 'today',
        orgUnitId: SUCCESSOR_ID,
      }),
      expect.objectContaining({
        effectiveFrom: '2026-12-01',
        id: 'future',
        orgUnitId: SUCCESSOR_ID,
      }),
    ]);
  });

  it('leaves ended memberships pointing at the retired unit as history', async (): Promise<void> => {
    const { memberships, service } = setUp({
      memberships: [
        membership({ effectiveTo: '2025-12-31', id: 'ended' }),
        membership({ id: 'open', memberId: 'member-2' }),
      ],
    });

    await service.deleteOrgUnit(RETIRING_ID, {
      transferToOrgUnitId: SUCCESSOR_ID,
    });

    expect(memberships.find((row) => row.id === 'ended')).toEqual(
      expect.objectContaining({
        effectiveTo: '2025-12-31',
        orgUnitId: RETIRING_ID,
      }),
    );
  });

  it('does not give a member a second row in a successor they already sit in', async (): Promise<void> => {
    const { memberships, service } = setUp({
      memberships: [
        membership({ id: 'old' }),
        membership({
          effectiveFrom: '2026-10-20',
          id: 'old-future',
          positionId: 'position-2',
        }),
        membership({
          effectiveFrom: '2026-03-01',
          id: 'already',
          orgUnitId: SUCCESSOR_ID,
        }),
        membership({
          effectiveFrom: '2026-10-20',
          id: 'already-future',
          orgUnitId: SUCCESSOR_ID,
          positionId: 'position-2',
        }),
      ],
    });

    await service.deleteOrgUnit(RETIRING_ID, {
      transferToOrgUnitId: SUCCESSOR_ID,
    });

    expect(memberships.map((row) => row.id).sort()).toEqual([
      'already',
      'already-future',
      'old',
    ]);
    expect(memberships.find((row) => row.id === 'old')).toEqual(
      expect.objectContaining({ effectiveTo: '2026-10-13' }),
    );
  });

  it('ends started manager rules and removes ones that never took effect', async (): Promise<void> => {
    const { managerRules, service } = setUp({
      managerRules: [
        managerRule({ id: 'started' }),
        managerRule({ effectiveFrom: '2026-11-01', id: 'future' }),
      ],
    });

    await service.deleteOrgUnit(RETIRING_ID, {
      transferToOrgUnitId: SUCCESSOR_ID,
    });

    expect(managerRules).toEqual([
      expect.objectContaining({ effectiveTo: '2026-10-13', id: 'started' }),
    ]);
  });

  it('refuses a successor that is the unit itself or is gone', async (): Promise<void> => {
    const { service } = setUp({ memberships: [membership({})] });

    await expect(
      service.deleteOrgUnit(RETIRING_ID, { transferToOrgUnitId: RETIRING_ID }),
    ).rejects.toThrow('An org unit cannot be its own successor');
    await expect(
      service.deleteOrgUnit(RETIRING_ID, {
        transferToOrgUnitId: '00000000-0000-4000-8000-0000000000ff',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('reports the retirement impact with the same notion of open', async (): Promise<void> => {
    const { service } = setUp({
      managerRules: [
        managerRule({}),
        managerRule({ effectiveTo: '2026-10-13' }),
      ],
      memberships: [
        membership({}),
        membership({ effectiveFrom: '2026-11-01', memberId: 'member-2' }),
        membership({ effectiveTo: '2026-10-13', memberId: 'member-3' }),
      ],
    });

    await expect(
      service.readOrgUnitRetirementImpact(RETIRING_ID),
    ).resolves.toEqual({
      childUnitCount: 0,
      openManagerResolutionCount: 1,
      openMembershipCount: 2,
    });
  });
});
