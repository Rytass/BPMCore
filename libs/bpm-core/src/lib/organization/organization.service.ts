import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Not, Repository } from 'typeorm';
import { ManagerResolutionEntity } from './manager-resolution.entity';
import { MembershipEntity } from './membership.entity';
import { OrgUnitEntity } from './org-unit.entity';
import { ManagerResolutionScopeTypeEnum } from './organization.enums';
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
import { CreatePositionInput, UpdatePositionInput } from './dto/position.input';
import { parseMetadataJson } from './json-metadata';
import { OrganizationSummaryObject } from './organization-summary.object';

const ROOT_PATH_PREFIX = 'org';
const BUSINESS_TIME_ZONE = 'Asia/Taipei';

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

  async listOrgUnits(
    parentId?: string | null,
  ): Promise<readonly OrgUnitEntity[]> {
    return this.orgUnitRepository.find({
      order: { path: 'ASC' },
      where:
        parentId === undefined
          ? { deletedAt: IsNull() }
          : {
              deletedAt: IsNull(),
              parentId: parentId === null ? IsNull() : parentId,
            },
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

  async listPositions(): Promise<readonly PositionEntity[]> {
    return this.positionRepository.find({
      order: { level: 'DESC', code: 'ASC' },
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
    const nextEffectiveTo = input.effectiveTo ?? existing.effectiveTo;
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
  }: {
    readonly activeOnly?: boolean;
    readonly memberId?: string | null;
    readonly orgUnitId?: string | null;
  } = {}): Promise<readonly MembershipEntity[]> {
    const memberships = await this.membershipRepository.find({
      order: { memberId: 'ASC', isPrimary: 'DESC', effectiveFrom: 'DESC' },
      where: {
        ...(memberId ? { memberId } : {}),
        ...(orgUnitId ? { orgUnitId } : {}),
      },
    });

    if (!activeOnly) {
      return memberships;
    }

    const date = this.toDateOnly(new Date());

    return memberships.filter((membership) =>
      this.isDateActive(membership, date),
    );
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
    const nextEffectiveTo = input.effectiveTo ?? existing.effectiveTo;

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
    scopeId,
    scopeType,
  }: {
    readonly activeOnly?: boolean;
    readonly scopeId?: string | null;
    readonly scopeType?: ManagerResolutionScopeTypeEnum | null;
  } = {}): Promise<readonly ManagerResolutionEntity[]> {
    const resolutions = await this.managerResolutionRepository.find({
      order: { priority: 'DESC', createdAt: 'DESC' },
      where: {
        ...(scopeId ? { scopeId } : {}),
        ...(scopeType ? { scopeType } : {}),
      },
    });

    if (!activeOnly) {
      return resolutions;
    }

    const date = this.toDateOnly(new Date());

    return resolutions.filter((resolution) =>
      this.isDateActive(resolution, date),
    );
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
