import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  FindOptionsWhere,
  ILike,
  In,
  IsNull,
  LessThanOrEqual,
  MoreThanOrEqual,
  Not,
  Repository,
} from 'typeorm';
import { ManagerResolutionEntity } from './manager-resolution.entity';
import { MembershipEntity } from './membership.entity';
import { OrgUnitEntity } from './org-unit.entity';
import {
  ManagerResolutionScopeTypeEnum,
  OrgUnitTypeEnum,
} from './organization.enums';
import { PositionEntity } from './position.entity';
import {
  CreateManagerResolutionInput,
  UpdateManagerResolutionInput,
} from './dto/manager-resolution.input';
import {
  CreateMembershipInput,
  UpdateMembershipInput,
} from './dto/membership.input';
import {
  CommitOrgUnitTreeDraftInput,
  CommitOrgUnitTreeDraftMoveInput,
  CreateOrgUnitInput,
  UpdateOrgUnitInput,
} from './dto/org-unit.input';
import { OrgUnitTreeCommitResultObject } from './org-unit-tree-commit-result.object';
import { CreatePositionInput, UpdatePositionInput } from './dto/position.input';
import { parseMetadataJson } from './json-metadata';
import { OrganizationSummaryObject } from './organization-summary.object';

const ROOT_PATH_PREFIX = 'org';
const BUSINESS_TIME_ZONE = 'Asia/Taipei';

/**
 * Upper bound for a single paginated page. Callers that need the complete list
 * (org tree, id->name mapping, dropdowns) must instead opt in explicitly via
 * `all: true` (or, historically, by omitting `pageSize`), which bypasses this
 * cap. A `pageSize` larger than this is clamped and logged rather than silently
 * truncated.
 */
const MAX_PAGE_SIZE = 100;

const paginationLogger = new Logger('OrganizationPagination');

@Injectable()
export class OrganizationService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(OrgUnitEntity)
    private readonly orgUnitRepository: Repository<OrgUnitEntity>,
    @InjectRepository(PositionEntity)
    private readonly positionRepository: Repository<PositionEntity>,
    @InjectRepository(MembershipEntity)
    private readonly membershipRepository: Repository<MembershipEntity>,
    @InjectRepository(ManagerResolutionEntity)
    private readonly managerResolutionRepository: Repository<ManagerResolutionEntity>,
  ) {}

  async createOrgUnit(input: CreateOrgUnitInput): Promise<OrgUnitEntity> {
    await this.assertOrgUnitCodeAvailable(input.code);
    const id = randomUUID();
    const parent = input.parentId
      ? await this.getOrgUnitOrThrow(input.parentId)
      : null;
    const pathSegment = this.buildPathSegment(id);
    const path = parent
      ? `${parent.path}.${pathSegment}`
      : `${ROOT_PATH_PREFIX}.${pathSegment}`;
    const entity = this.orgUnitRepository.create({
      code: input.code,
      id,
      metadata: parseMetadataJson(input.metadataJson),
      name: input.name,
      parentId: input.parentId,
      path,
      type: input.type,
    });

    return this.orgUnitRepository.save(entity);
  }

  async updateOrgUnit(input: UpdateOrgUnitInput): Promise<OrgUnitEntity> {
    const existing = await this.getOrgUnitOrThrow(input.id);
    const nextParentId =
      input.parentId === undefined ? existing.parentId : input.parentId;
    const parent = nextParentId
      ? await this.getOrgUnitOrThrow(nextParentId)
      : null;
    const nextCode = input.code ?? existing.code;

    if (nextParentId === existing.id) {
      throw new BadRequestException('Org unit cannot be its own parent');
    }

    if (parent && parent.path.startsWith(`${existing.path}.`)) {
      throw new BadRequestException(
        'Org unit cannot be moved under its descendant',
      );
    }

    await this.assertOrgUnitCodeAvailable(nextCode, existing.id);
    const pathSegment = this.buildPathSegment(existing.id);
    const path = parent
      ? `${parent.path}.${pathSegment}`
      : `${ROOT_PATH_PREFIX}.${pathSegment}`;
    const previousPath = existing.path;

    const next = this.orgUnitRepository.merge(existing, {
      code: nextCode,
      metadata: input.metadataJson
        ? parseMetadataJson(input.metadataJson)
        : existing.metadata,
      name: input.name ?? existing.name,
      parentId: nextParentId,
      path,
      type: input.type ?? existing.type,
    });

    return this.dataSource.transaction(
      async (manager): Promise<OrgUnitEntity> => {
        const saved = await manager.getRepository(OrgUnitEntity).save(next);

        if (saved.path !== previousPath) {
          const descendants = await manager
            .getRepository(OrgUnitEntity)
            .createQueryBuilder('orgUnit')
            .where('orgUnit.deleted_at IS NULL')
            .andWhere('orgUnit.path <@ :previousPath', { previousPath })
            .andWhere('orgUnit.id != :id', { id: saved.id })
            .getMany();

          await Promise.all(
            descendants.map((descendant): Promise<OrgUnitEntity> => {
              const updatedDescendant = manager
                .getRepository(OrgUnitEntity)
                .merge(descendant, {
                  path: descendant.path.replace(previousPath, saved.path),
                });

              return manager
                .getRepository(OrgUnitEntity)
                .save(updatedDescendant);
            }),
          );
        }

        return saved;
      },
    );
  }

  async commitOrgUnitTreeDraft(
    input: CommitOrgUnitTreeDraftInput,
  ): Promise<OrgUnitTreeCommitResultObject> {
    if (!input.moves.length) {
      return { orgUnits: [] };
    }

    this.assertUniqueOrgUnitTreeMoves(input.moves);

    return this.dataSource.transaction(
      async (manager): Promise<OrgUnitTreeCommitResultObject> => {
        const repository = manager.getRepository(OrgUnitEntity);
        const orgUnitIds = collectOrgUnitTreeDraftIds(input.moves);
        const orgUnits = await repository.find({
          where: { deletedAt: IsNull(), id: In(orgUnitIds) },
        });
        const orgUnitById = new Map(
          orgUnits.map((orgUnit): readonly [string, OrgUnitEntity] => [
            orgUnit.id,
            orgUnit,
          ]),
        );

        this.assertOrgUnitTreeDraftReferences(input.moves, orgUnitById);
        this.assertOrgUnitTreeDraftVersions(input.moves, orgUnitById);
        this.assertOrgUnitTreeDraftHierarchy(input.moves, orgUnitById);

        const affectedOrgUnits = new Map<string, OrgUnitEntity>();
        const sortedMoves = sortOrgUnitTreeDraftMoves(input.moves);

        for (const move of sortedMoves) {
          const existing = orgUnitById.get(move.id);

          if (!existing) {
            throw new NotFoundException(`Org unit ${move.id} was not found`);
          }

          const parent = move.parentId
            ? orgUnitById.get(move.parentId) ?? null
            : null;
          const previousPath = existing.path;
          const nextPath = parent
            ? `${parent.path}.${this.buildPathSegment(existing.id)}`
            : `${ROOT_PATH_PREFIX}.${this.buildPathSegment(existing.id)}`;

          if (
            existing.parentId === move.parentId &&
            existing.path === nextPath
          ) {
            affectedOrgUnits.set(existing.id, existing);
            continue;
          }

          const saved = await repository.save(
            repository.merge(existing, {
              parentId: move.parentId,
              path: nextPath,
            }),
          );

          orgUnitById.set(saved.id, saved);
          affectedOrgUnits.set(saved.id, saved);

          const descendants = await repository
            .createQueryBuilder('orgUnit')
            .where('orgUnit.deleted_at IS NULL')
            .andWhere('orgUnit.path <@ :previousPath', { previousPath })
            .andWhere('orgUnit.id != :id', { id: saved.id })
            .getMany();

          for (const descendant of descendants) {
            const updatedDescendant = await repository.save(
              repository.merge(descendant, {
                path: descendant.path.replace(previousPath, saved.path),
              }),
            );

            orgUnitById.set(updatedDescendant.id, updatedDescendant);
            affectedOrgUnits.set(updatedDescendant.id, updatedDescendant);
          }
        }

        return {
          orgUnits: [...affectedOrgUnits.values()].sort(compareOrgUnitPath),
        };
      },
    );
  }

  async deleteOrgUnit(id: string): Promise<boolean> {
    await this.getOrgUnitOrThrow(id);
    const childCount = await this.orgUnitRepository.count({
      where: { deletedAt: IsNull(), parentId: id },
    });

    if (childCount > 0) {
      throw new BadRequestException(
        'Org unit with child units cannot be deleted',
      );
    }

    const membershipCount = await this.membershipRepository.count({
      where: { orgUnitId: id },
    });

    if (membershipCount > 0) {
      throw new BadRequestException(
        'Org unit with memberships cannot be deleted',
      );
    }

    await this.orgUnitRepository.softDelete(id);

    return true;
  }

  async getOrgUnit(id: string): Promise<OrgUnitEntity> {
    return this.getOrgUnitOrThrow(id);
  }

  async listOrgUnits({
    all,
    page,
    pageSize,
    parentId,
    searchText,
    type,
  }: {
    readonly all?: boolean | null;
    readonly page?: number | null;
    readonly pageSize?: number | null;
    readonly parentId?: string | null;
    readonly searchText?: string | null;
    readonly type?: OrgUnitTypeEnum | null;
  } = {}): Promise<readonly OrgUnitEntity[]> {
    return this.orgUnitRepository.find({
      ...createPaginationFindOptions({ all, page, pageSize }),
      order: { path: 'ASC' },
      where: createOrgUnitWhere({ parentId, searchText, type }),
    });
  }

  async countOrgUnits({
    parentId,
    searchText,
    type,
  }: {
    readonly parentId?: string | null;
    readonly searchText?: string | null;
    readonly type?: OrgUnitTypeEnum | null;
  } = {}): Promise<number> {
    return this.orgUnitRepository.count({
      where: createOrgUnitWhere({ parentId, searchText, type }),
    });
  }

  async createPosition(input: CreatePositionInput): Promise<PositionEntity> {
    await this.assertPositionCodeAvailable(input.code);

    return this.positionRepository.save(
      this.positionRepository.create({
        code: input.code,
        level: input.level,
        metadata: parseMetadataJson(input.metadataJson),
        name: input.name,
      }),
    );
  }

  async updatePosition(input: UpdatePositionInput): Promise<PositionEntity> {
    const existing = await this.getPositionOrThrow(input.id);
    const nextCode = input.code ?? existing.code;

    await this.assertPositionCodeAvailable(nextCode, existing.id);

    const next = this.positionRepository.merge(existing, {
      code: nextCode,
      level: input.level ?? existing.level,
      metadata: input.metadataJson
        ? parseMetadataJson(input.metadataJson)
        : existing.metadata,
      name: input.name ?? existing.name,
    });

    return this.positionRepository.save(next);
  }

  async listPositions({
    page,
    pageSize,
    searchText,
  }: {
    readonly page?: number | null;
    readonly pageSize?: number | null;
    readonly searchText?: string | null;
  } = {}): Promise<readonly PositionEntity[]> {
    return this.positionRepository.find({
      ...createPaginationFindOptions({ page, pageSize }),
      order: { level: 'DESC', code: 'ASC' },
      where: createPositionWhere({ searchText }),
    });
  }

  async countPositions({
    searchText,
  }: {
    readonly searchText?: string | null;
  } = {}): Promise<number> {
    return this.positionRepository.count({
      where: createPositionWhere({ searchText }),
    });
  }

  async createMembership(
    input: CreateMembershipInput,
  ): Promise<MembershipEntity> {
    await this.assertMembershipReferences(input);
    await this.assertMembershipDateRange(
      input.effectiveFrom,
      input.effectiveTo,
    );

    if (input.isPrimary) {
      await this.clearPrimaryMemberships(input.memberId);
    }

    return this.membershipRepository.save(
      this.membershipRepository.create(input),
    );
  }

  async updateMembership(
    input: UpdateMembershipInput,
  ): Promise<MembershipEntity> {
    const existing = await this.getMembershipOrThrow(input.id);
    const nextMemberId = existing.memberId;
    const nextOrgUnitId = input.orgUnitId ?? existing.orgUnitId;
    const nextPositionId =
      input.positionId === undefined ? existing.positionId : input.positionId;
    const nextEffectiveFrom = input.effectiveFrom ?? existing.effectiveFrom;
    const nextEffectiveTo =
      input.effectiveTo === undefined
        ? existing.effectiveTo
        : input.effectiveTo;
    const nextIsPrimary = input.isPrimary ?? existing.isPrimary;

    await this.assertMembershipReferences({
      effectiveFrom: nextEffectiveFrom,
      effectiveTo: nextEffectiveTo,
      isPrimary: nextIsPrimary,
      memberId: nextMemberId,
      orgUnitId: nextOrgUnitId,
      positionId: nextPositionId,
    });
    await this.assertMembershipDateRange(nextEffectiveFrom, nextEffectiveTo);

    if (nextIsPrimary) {
      await this.clearPrimaryMemberships(nextMemberId, existing.id);
    }

    const next = this.membershipRepository.merge(existing, {
      effectiveFrom: nextEffectiveFrom,
      effectiveTo: nextEffectiveTo,
      isPrimary: nextIsPrimary,
      orgUnitId: nextOrgUnitId,
      positionId: nextPositionId,
    });

    return this.membershipRepository.save(next);
  }

  async deleteMembership(id: string): Promise<boolean> {
    await this.getMembershipOrThrow(id);
    await this.membershipRepository.delete(id);

    return true;
  }

  async listMemberships({
    activeOnly = false,
    memberId,
    orgUnitId,
    page,
    pageSize,
    positionId,
  }: {
    readonly activeOnly?: boolean;
    readonly memberId?: string | null;
    readonly orgUnitId?: string | null;
    readonly page?: number | null;
    readonly pageSize?: number | null;
    readonly positionId?: string | null;
  } = {}): Promise<readonly MembershipEntity[]> {
    const date = this.toDateOnly(new Date());

    return this.membershipRepository.find({
      ...createPaginationFindOptions({ page, pageSize }),
      order: { memberId: 'ASC', isPrimary: 'DESC', effectiveFrom: 'DESC' },
      where: createMembershipWhere({
        activeOnly,
        date,
        memberId,
        orgUnitId,
        positionId,
      }),
    });
  }

  async countMemberships({
    activeOnly = false,
    memberId,
    orgUnitId,
    positionId,
  }: {
    readonly activeOnly?: boolean;
    readonly memberId?: string | null;
    readonly orgUnitId?: string | null;
    readonly positionId?: string | null;
  } = {}): Promise<number> {
    const date = this.toDateOnly(new Date());

    return this.membershipRepository.count({
      where: createMembershipWhere({
        activeOnly,
        date,
        memberId,
        orgUnitId,
        positionId,
      }),
    });
  }

  async createManagerResolution(
    input: CreateManagerResolutionInput,
  ): Promise<ManagerResolutionEntity> {
    await this.assertManagerResolutionReferences(input);
    await this.assertMembershipDateRange(
      input.effectiveFrom,
      input.effectiveTo,
    );

    return this.managerResolutionRepository.save(
      this.managerResolutionRepository.create(input),
    );
  }

  async updateManagerResolution(
    input: UpdateManagerResolutionInput,
  ): Promise<ManagerResolutionEntity> {
    const existing = await this.getManagerResolutionOrThrow(input.id);
    const nextScopeType = input.scopeType ?? existing.scopeType;
    const nextScopeId = input.scopeId ?? existing.scopeId;
    const nextManagerMemberId =
      input.managerMemberId ?? existing.managerMemberId;
    const nextEffectiveFrom = input.effectiveFrom ?? existing.effectiveFrom;
    const nextEffectiveTo =
      input.effectiveTo === undefined
        ? existing.effectiveTo
        : input.effectiveTo;

    await this.assertManagerResolutionReferences({
      effectiveFrom: nextEffectiveFrom,
      effectiveTo: nextEffectiveTo,
      managerMemberId: nextManagerMemberId,
      priority: input.priority ?? existing.priority,
      scopeId: nextScopeId,
      scopeType: nextScopeType,
    });
    await this.assertMembershipDateRange(nextEffectiveFrom, nextEffectiveTo);

    const next = this.managerResolutionRepository.merge(existing, {
      effectiveFrom: nextEffectiveFrom,
      effectiveTo: nextEffectiveTo,
      managerMemberId: nextManagerMemberId,
      priority: input.priority ?? existing.priority,
      scopeId: nextScopeId,
      scopeType: nextScopeType,
    });

    return this.managerResolutionRepository.save(next);
  }

  async deleteManagerResolution(id: string): Promise<boolean> {
    await this.getManagerResolutionOrThrow(id);
    await this.managerResolutionRepository.delete(id);

    return true;
  }

  async listManagerResolutions({
    activeOnly = false,
    page,
    pageSize,
    scopeId,
    scopeType,
  }: {
    readonly activeOnly?: boolean;
    readonly page?: number | null;
    readonly pageSize?: number | null;
    readonly scopeId?: string | null;
    readonly scopeType?: ManagerResolutionScopeTypeEnum | null;
  } = {}): Promise<readonly ManagerResolutionEntity[]> {
    const date = this.toDateOnly(new Date());

    return this.managerResolutionRepository.find({
      ...createPaginationFindOptions({ page, pageSize }),
      order: { priority: 'DESC', createdAt: 'DESC' },
      where: createManagerResolutionWhere({
        activeOnly,
        date,
        scopeId,
        scopeType,
      }),
    });
  }

  async countManagerResolutions({
    activeOnly = false,
    scopeId,
    scopeType,
  }: {
    readonly activeOnly?: boolean;
    readonly scopeId?: string | null;
    readonly scopeType?: ManagerResolutionScopeTypeEnum | null;
  } = {}): Promise<number> {
    const date = this.toDateOnly(new Date());

    return this.managerResolutionRepository.count({
      where: createManagerResolutionWhere({
        activeOnly,
        date,
        scopeId,
        scopeType,
      }),
    });
  }

  async readOrganizationSummary(): Promise<OrganizationSummaryObject> {
    const [
      orgUnitCount,
      positionCount,
      membershipCount,
      managerResolutionCount,
    ] = await Promise.all([
      this.orgUnitRepository.count({ where: { deletedAt: IsNull() } }),
      this.positionRepository.count(),
      this.membershipRepository.count(),
      this.managerResolutionRepository.count(),
    ]);

    return {
      managerResolutionCount,
      membershipCount,
      orgUnitCount,
      positionCount,
    };
  }

  async resolveManagerMemberId(
    memberId: string,
    effectiveAt = new Date(),
  ): Promise<string | null> {
    const date = this.toDateOnly(effectiveAt);
    const memberships = await this.findActiveMemberships(memberId, date);
    const orgUnits = await this.findMembershipOrgUnits(memberships);
    const positionIds = memberships
      .map((membership) => membership.positionId)
      .filter((positionId): positionId is string => Boolean(positionId));
    const candidatePairs = [
      { scopeId: memberId, scopeType: ManagerResolutionScopeTypeEnum.MEMBER },
      ...orgUnits.map((orgUnit) => ({
        scopeId: orgUnit.id,
        scopeType: ManagerResolutionScopeTypeEnum.ORG_UNIT,
      })),
      ...positionIds.map((positionId) => ({
        scopeId: positionId,
        scopeType: ManagerResolutionScopeTypeEnum.POSITION,
      })),
    ];
    const scopeIds = candidatePairs.map((pair) => pair.scopeId);
    const resolutions = scopeIds.length
      ? await this.managerResolutionRepository.find({
          where: {
            scopeId: In(scopeIds),
            scopeType: In([
              ManagerResolutionScopeTypeEnum.MEMBER,
              ManagerResolutionScopeTypeEnum.ORG_UNIT,
              ManagerResolutionScopeTypeEnum.POSITION,
            ]),
          },
        })
      : [];

    const active = resolutions
      .filter((resolution) =>
        candidatePairs.some(
          (pair) =>
            pair.scopeId === resolution.scopeId &&
            pair.scopeType === resolution.scopeType,
        ),
      )
      .filter((resolution) => this.isDateActive(resolution, date))
      .sort((left, right) => this.compareManagerResolution(left, right));

    return active[0]?.managerMemberId ?? null;
  }

  private assertUniqueOrgUnitTreeMoves(
    moves: readonly CommitOrgUnitTreeDraftMoveInput[],
  ): void {
    const moveIds = moves.map((move) => move.id);
    const uniqueMoveIds = new Set(moveIds);

    if (uniqueMoveIds.size !== moveIds.length) {
      throw new BadRequestException(
        'Org unit tree draft includes duplicate moves',
      );
    }
  }

  private assertOrgUnitTreeDraftReferences(
    moves: readonly CommitOrgUnitTreeDraftMoveInput[],
    orgUnitById: ReadonlyMap<string, OrgUnitEntity>,
  ): void {
    const missingId = collectOrgUnitTreeDraftIds(moves).find(
      (id) => !orgUnitById.has(id),
    );

    if (missingId) {
      throw new NotFoundException(`Org unit ${missingId} was not found`);
    }
  }

  private assertOrgUnitTreeDraftVersions(
    moves: readonly CommitOrgUnitTreeDraftMoveInput[],
    orgUnitById: ReadonlyMap<string, OrgUnitEntity>,
  ): void {
    const staleMove = moves.find((move) => {
      const orgUnit = orgUnitById.get(move.id);

      return orgUnit
        ? orgUnit.updatedAt.getTime() !== parseBaseUpdatedAt(move).getTime()
        : false;
    });

    if (staleMove) {
      throw new ConflictException(
        `Org unit ${staleMove.id} has changed since this draft was based`,
      );
    }
  }

  private assertOrgUnitTreeDraftHierarchy(
    moves: readonly CommitOrgUnitTreeDraftMoveInput[],
    orgUnitById: ReadonlyMap<string, OrgUnitEntity>,
  ): void {
    for (const move of moves) {
      if (move.id === move.parentId) {
        throw new BadRequestException('Org unit cannot be its own parent');
      }

      const existing = orgUnitById.get(move.id);
      const parent = move.parentId ? orgUnitById.get(move.parentId) : null;

      if (existing && parent?.path.startsWith(`${existing.path}.`)) {
        throw new BadRequestException(
          'Org unit cannot be moved under its descendant',
        );
      }
    }

    assertOrgUnitTreeDraftHasNoCycles(moves);
  }

  private async getOrgUnitOrThrow(id: string): Promise<OrgUnitEntity> {
    const entity = await this.orgUnitRepository.findOne({
      where: { deletedAt: IsNull(), id },
    });

    if (!entity) {
      throw new NotFoundException(`Org unit ${id} was not found`);
    }

    return entity;
  }

  private async getPositionOrThrow(id: string): Promise<PositionEntity> {
    const entity = await this.positionRepository.findOne({ where: { id } });

    if (!entity) {
      throw new NotFoundException(`Position ${id} was not found`);
    }

    return entity;
  }

  private async assertOrgUnitCodeAvailable(
    code: string,
    exceptId?: string,
  ): Promise<void> {
    const existing = await this.orgUnitRepository.findOne({
      where: {
        code,
        deletedAt: IsNull(),
        ...(exceptId ? { id: Not(exceptId) } : {}),
      },
    });

    if (existing) {
      throw new BadRequestException(`Org unit code ${code} is already used`);
    }
  }

  private async assertPositionCodeAvailable(
    code: string,
    exceptId?: string,
  ): Promise<void> {
    const existing = await this.positionRepository.findOne({
      where: {
        code,
        ...(exceptId ? { id: Not(exceptId) } : {}),
      },
    });

    if (existing) {
      throw new BadRequestException(`Position code ${code} is already used`);
    }
  }

  private async assertMembershipReferences(
    input: CreateMembershipInput,
  ): Promise<void> {
    await this.getOrgUnitOrThrow(input.orgUnitId);

    if (input.positionId) {
      await this.getPositionOrThrow(input.positionId);
    }
  }

  private async assertManagerResolutionReferences(
    input: CreateManagerResolutionInput,
  ): Promise<void> {
    if (
      input.scopeType === ManagerResolutionScopeTypeEnum.MEMBER &&
      input.scopeId === input.managerMemberId
    ) {
      throw new BadRequestException('Manager cannot be the scoped member');
    }

    if (input.scopeType === ManagerResolutionScopeTypeEnum.ORG_UNIT) {
      await this.getOrgUnitOrThrow(input.scopeId);
    }

    if (input.scopeType === ManagerResolutionScopeTypeEnum.POSITION) {
      await this.getPositionOrThrow(input.scopeId);
    }
  }

  private async assertMembershipDateRange(
    effectiveFrom: string,
    effectiveTo: string | null,
  ): Promise<void> {
    if (effectiveTo && effectiveFrom > effectiveTo) {
      throw new BadRequestException(
        'Effective from cannot be after effective to',
      );
    }
  }

  private async clearPrimaryMemberships(
    memberId: string,
    exceptId?: string,
  ): Promise<void> {
    await this.membershipRepository.update(
      {
        isPrimary: true,
        memberId,
        ...(exceptId ? { id: Not(exceptId) } : {}),
      },
      { isPrimary: false },
    );
  }

  private async getMembershipOrThrow(id: string): Promise<MembershipEntity> {
    const entity = await this.membershipRepository.findOne({ where: { id } });

    if (!entity) {
      throw new NotFoundException(`Membership ${id} was not found`);
    }

    return entity;
  }

  private async getManagerResolutionOrThrow(
    id: string,
  ): Promise<ManagerResolutionEntity> {
    const entity = await this.managerResolutionRepository.findOne({
      where: { id },
    });

    if (!entity) {
      throw new NotFoundException(`Manager resolution ${id} was not found`);
    }

    return entity;
  }

  private async findActiveMemberships(
    memberId: string,
    date: string,
  ): Promise<readonly MembershipEntity[]> {
    const memberships = await this.membershipRepository.find({
      where: { memberId },
    });

    return memberships.filter((membership) =>
      this.isDateActive(membership, date),
    );
  }

  private async findMembershipOrgUnits(
    memberships: readonly MembershipEntity[],
  ): Promise<readonly OrgUnitEntity[]> {
    const orgUnitIds = memberships.map((membership) => membership.orgUnitId);

    if (!orgUnitIds.length) {
      return [];
    }

    const directOrgUnits = await this.orgUnitRepository.find({
      where: { deletedAt: IsNull(), id: In(orgUnitIds) },
    });
    const ancestorGroups = await Promise.all(
      directOrgUnits.map((orgUnit) =>
        this.orgUnitRepository
          .createQueryBuilder('orgUnit')
          .where('orgUnit.deleted_at IS NULL')
          .andWhere('orgUnit.path @> :path', { path: orgUnit.path })
          .getMany(),
      ),
    );
    const flattened = ancestorGroups.flat();
    const byId = new Map(
      flattened.map((orgUnit): readonly [string, OrgUnitEntity] => [
        orgUnit.id,
        orgUnit,
      ]),
    );

    return [...byId.values()];
  }

  private buildPathSegment(id: string): string {
    return `n${id.replace(/-/g, '_')}`;
  }

  private toDateOnly(date: Date): string {
    const parts = new Intl.DateTimeFormat('en-US', {
      day: '2-digit',
      month: '2-digit',
      timeZone: BUSINESS_TIME_ZONE,
      year: 'numeric',
    }).formatToParts(date);
    const byType = new Map(
      parts.map((part): readonly [string, string] => [part.type, part.value]),
    );

    return `${byType.get('year') ?? '1970'}-${byType.get('month') ?? '01'}-${byType.get('day') ?? '01'}`;
  }

  private isDateActive(
    value: Pick<
      MembershipEntity | ManagerResolutionEntity,
      'effectiveFrom' | 'effectiveTo'
    >,
    date: string,
  ): boolean {
    return (
      value.effectiveFrom <= date &&
      (!value.effectiveTo || value.effectiveTo >= date)
    );
  }

  private compareManagerResolution(
    left: ManagerResolutionEntity,
    right: ManagerResolutionEntity,
  ): number {
    const priorityDiff = right.priority - left.priority;

    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    return (
      this.scopeRank(right.scopeType) - this.scopeRank(left.scopeType) ||
      right.effectiveFrom.localeCompare(left.effectiveFrom)
    );
  }

  private scopeRank(scopeType: ManagerResolutionScopeTypeEnum): number {
    const ranks: Readonly<Record<ManagerResolutionScopeTypeEnum, number>> = {
      [ManagerResolutionScopeTypeEnum.MEMBER]: 3,
      [ManagerResolutionScopeTypeEnum.ORG_UNIT]: 2,
      [ManagerResolutionScopeTypeEnum.POSITION]: 1,
    };

    return ranks[scopeType];
  }
}

function createOrgUnitWhere({
  parentId,
  searchText,
  type,
}: {
  readonly parentId?: string | null;
  readonly searchText?: string | null;
  readonly type?: OrgUnitTypeEnum | null;
}):
  | FindOptionsWhere<OrgUnitEntity>
  | FindOptionsWhere<OrgUnitEntity>[] {
  const parentWhere: FindOptionsWhere<OrgUnitEntity> =
    parentId === undefined
      ? {}
      : { parentId: parentId === null ? IsNull() : parentId };
  const baseWhere: FindOptionsWhere<OrgUnitEntity> = {
    deletedAt: IsNull(),
    ...parentWhere,
    ...(type ? { type } : {}),
  };
  const trimmedSearchText = searchText?.trim();

  if (!trimmedSearchText) {
    return baseWhere;
  }

  const searchPattern = `%${trimmedSearchText}%`;

  return [
    { ...baseWhere, code: ILike(searchPattern) },
    { ...baseWhere, name: ILike(searchPattern) },
  ];
}

function createPositionWhere({
  searchText,
}: {
  readonly searchText?: string | null;
}):
  | FindOptionsWhere<PositionEntity>
  | FindOptionsWhere<PositionEntity>[] {
  const trimmedSearchText = searchText?.trim();

  if (!trimmedSearchText) {
    return {};
  }

  const searchPattern = `%${trimmedSearchText}%`;

  return [{ code: ILike(searchPattern) }, { name: ILike(searchPattern) }];
}

function createMembershipWhere({
  activeOnly,
  date,
  memberId,
  orgUnitId,
  positionId,
}: {
  readonly activeOnly: boolean;
  readonly date: string;
  readonly memberId?: string | null;
  readonly orgUnitId?: string | null;
  readonly positionId?: string | null;
}):
  | FindOptionsWhere<MembershipEntity>
  | FindOptionsWhere<MembershipEntity>[] {
  const baseWhere: FindOptionsWhere<MembershipEntity> = {
    ...(memberId ? { memberId } : {}),
    ...(orgUnitId ? { orgUnitId } : {}),
    ...(positionId ? { positionId } : {}),
  };

  if (!activeOnly) {
    return baseWhere;
  }

  return [
    {
      ...baseWhere,
      effectiveFrom: LessThanOrEqual(date),
      effectiveTo: IsNull(),
    },
    {
      ...baseWhere,
      effectiveFrom: LessThanOrEqual(date),
      effectiveTo: MoreThanOrEqual(date),
    },
  ];
}

function createManagerResolutionWhere({
  activeOnly,
  date,
  scopeId,
  scopeType,
}: {
  readonly activeOnly: boolean;
  readonly date: string;
  readonly scopeId?: string | null;
  readonly scopeType?: ManagerResolutionScopeTypeEnum | null;
}):
  | FindOptionsWhere<ManagerResolutionEntity>
  | FindOptionsWhere<ManagerResolutionEntity>[] {
  const baseWhere: FindOptionsWhere<ManagerResolutionEntity> = {
    ...(scopeId ? { scopeId } : {}),
    ...(scopeType ? { scopeType } : {}),
  };

  if (!activeOnly) {
    return baseWhere;
  }

  return [
    {
      ...baseWhere,
      effectiveFrom: LessThanOrEqual(date),
      effectiveTo: IsNull(),
    },
    {
      ...baseWhere,
      effectiveFrom: LessThanOrEqual(date),
      effectiveTo: MoreThanOrEqual(date),
    },
  ];
}

function createPaginationFindOptions({
  all,
  page,
  pageSize,
}: {
  readonly all?: boolean | null;
  readonly page?: number | null;
  readonly pageSize?: number | null;
}): { readonly skip?: number; readonly take?: number } {
  if (all) {
    return {};
  }

  const normalizedPageSize = normalizePageSize(pageSize);

  if (!normalizedPageSize) {
    return {};
  }

  return {
    skip: (normalizePage(page) - 1) * normalizedPageSize,
    take: normalizedPageSize,
  };
}

function normalizePage(page?: number | null): number {
  if (typeof page !== 'number' || !Number.isFinite(page)) {
    return 1;
  }

  return Math.max(1, Math.floor(page));
}

function normalizePageSize(pageSize?: number | null): number | null {
  if (typeof pageSize !== 'number' || !Number.isFinite(pageSize)) {
    return null;
  }

  const flooredPageSize = Math.max(1, Math.floor(pageSize));

  if (flooredPageSize > MAX_PAGE_SIZE) {
    paginationLogger.warn(
      `Requested pageSize ${flooredPageSize} exceeds the maximum of ${MAX_PAGE_SIZE} and was clamped. ` +
        `To fetch the complete list, pass all: true (or omit pageSize) instead of an oversized pageSize.`,
    );
  }

  return Math.min(MAX_PAGE_SIZE, flooredPageSize);
}

function collectOrgUnitTreeDraftIds(
  moves: readonly CommitOrgUnitTreeDraftMoveInput[],
): readonly string[] {
  return [
    ...new Set(
      moves.flatMap((move) =>
        move.parentId ? [move.id, move.parentId] : [move.id],
      ),
    ),
  ];
}

function parseBaseUpdatedAt(move: CommitOrgUnitTreeDraftMoveInput): Date {
  const baseUpdatedAt = new Date(move.baseUpdatedAt);

  if (Number.isNaN(baseUpdatedAt.getTime())) {
    throw new BadRequestException(
      `Org unit ${move.id} baseUpdatedAt is invalid`,
    );
  }

  return baseUpdatedAt;
}

function assertOrgUnitTreeDraftHasNoCycles(
  moves: readonly CommitOrgUnitTreeDraftMoveInput[],
): void {
  const parentById = new Map(
    moves.map((move): readonly [string, string | null] => [
      move.id,
      move.parentId,
    ]),
  );

  for (const move of moves) {
    const visited = new Set<string>();
    let parentId = move.parentId;

    while (parentId && parentById.has(parentId)) {
      if (parentId === move.id || visited.has(parentId)) {
        throw new BadRequestException(
          'Org unit tree draft cannot create a cycle',
        );
      }

      visited.add(parentId);
      parentId = parentById.get(parentId) ?? null;
    }
  }
}

function sortOrgUnitTreeDraftMoves(
  moves: readonly CommitOrgUnitTreeDraftMoveInput[],
): readonly CommitOrgUnitTreeDraftMoveInput[] {
  const moveById = new Map(
    moves.map((move): readonly [string, CommitOrgUnitTreeDraftMoveInput] => [
      move.id,
      move,
    ]),
  );

  return [...moves].sort((left, right) => {
    const leftDepth = calculateOrgUnitTreeDraftMoveDepth(left, moveById);
    const rightDepth = calculateOrgUnitTreeDraftMoveDepth(right, moveById);

    return leftDepth - rightDepth || left.id.localeCompare(right.id);
  });
}

function calculateOrgUnitTreeDraftMoveDepth(
  move: CommitOrgUnitTreeDraftMoveInput,
  moveById: ReadonlyMap<string, CommitOrgUnitTreeDraftMoveInput>,
): number {
  let depth = 0;
  let parentId = move.parentId;

  while (parentId && moveById.has(parentId)) {
    depth += 1;
    parentId = moveById.get(parentId)?.parentId ?? null;
  }

  return depth;
}

function compareOrgUnitPath(
  left: OrgUnitEntity,
  right: OrgUnitEntity,
): number {
  return left.path.localeCompare(right.path);
}
