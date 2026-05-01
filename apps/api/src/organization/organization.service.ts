import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { ManagerResolutionEntity } from './manager-resolution.entity';
import { MembershipEntity } from './membership.entity';
import { OrgUnitEntity } from './org-unit.entity';
import {
  ManagerResolutionScopeTypeEnum,
} from './organization.enums';
import { PositionEntity } from './position.entity';
import { CreateManagerResolutionInput, UpdateManagerResolutionInput } from './dto/manager-resolution.input';
import { CreateMembershipInput, UpdateMembershipInput } from './dto/membership.input';
import { CreateOrgUnitInput, UpdateOrgUnitInput } from './dto/org-unit.input';
import { CreatePositionInput, UpdatePositionInput } from './dto/position.input';
import { parseMetadataJson } from './json-metadata';

const ROOT_PATH_PREFIX = 'org';

@Injectable()
export class OrganizationService {
  constructor(
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
    const id = randomUUID();
    const parent = input.parentId
      ? await this.getOrgUnitOrThrow(input.parentId)
      : null;
    const pathSegment = this.buildPathSegment(id);
    const path = parent ? `${parent.path}.${pathSegment}` : `${ROOT_PATH_PREFIX}.${pathSegment}`;
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
    const nextParentId = input.parentId === undefined ? existing.parentId : input.parentId;
    const parent = nextParentId ? await this.getOrgUnitOrThrow(nextParentId) : null;
    const pathSegment = this.buildPathSegment(existing.id);
    const path = parent ? `${parent.path}.${pathSegment}` : `${ROOT_PATH_PREFIX}.${pathSegment}`;

    const next = this.orgUnitRepository.merge(existing, {
      code: input.code ?? existing.code,
      metadata: input.metadataJson
        ? parseMetadataJson(input.metadataJson)
        : existing.metadata,
      name: input.name ?? existing.name,
      parentId: nextParentId,
      path,
      type: input.type ?? existing.type,
    });

    return this.orgUnitRepository.save(next);
  }

  async deleteOrgUnit(id: string): Promise<boolean> {
    await this.getOrgUnitOrThrow(id);
    await this.orgUnitRepository.softDelete(id);

    return true;
  }

  async listOrgUnits(): Promise<readonly OrgUnitEntity[]> {
    return this.orgUnitRepository.find({
      order: { path: 'ASC' },
      where: { deletedAt: IsNull() },
    });
  }

  async createPosition(input: CreatePositionInput): Promise<PositionEntity> {
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
    const next = this.positionRepository.merge(existing, {
      code: input.code ?? existing.code,
      level: input.level ?? existing.level,
      metadata: input.metadataJson
        ? parseMetadataJson(input.metadataJson)
        : existing.metadata,
      name: input.name ?? existing.name,
    });

    return this.positionRepository.save(next);
  }

  async listPositions(): Promise<readonly PositionEntity[]> {
    return this.positionRepository.find({ order: { level: 'DESC', code: 'ASC' } });
  }

  async createMembership(input: CreateMembershipInput): Promise<MembershipEntity> {
    return this.membershipRepository.save(
      this.membershipRepository.create(input),
    );
  }

  async updateMembership(input: UpdateMembershipInput): Promise<MembershipEntity> {
    const existing = await this.getMembershipOrThrow(input.id);
    const next = this.membershipRepository.merge(existing, {
      effectiveFrom: input.effectiveFrom ?? existing.effectiveFrom,
      effectiveTo: input.effectiveTo ?? existing.effectiveTo,
      isPrimary: input.isPrimary ?? existing.isPrimary,
      orgUnitId: input.orgUnitId ?? existing.orgUnitId,
      positionId:
        input.positionId === undefined ? existing.positionId : input.positionId,
    });

    return this.membershipRepository.save(next);
  }

  async listMemberships(memberId?: string): Promise<readonly MembershipEntity[]> {
    return this.membershipRepository.find({
      order: { memberId: 'ASC', isPrimary: 'DESC', effectiveFrom: 'DESC' },
      where: memberId ? { memberId } : {},
    });
  }

  async createManagerResolution(
    input: CreateManagerResolutionInput,
  ): Promise<ManagerResolutionEntity> {
    return this.managerResolutionRepository.save(
      this.managerResolutionRepository.create(input),
    );
  }

  async updateManagerResolution(
    input: UpdateManagerResolutionInput,
  ): Promise<ManagerResolutionEntity> {
    const existing = await this.getManagerResolutionOrThrow(input.id);
    const next = this.managerResolutionRepository.merge(existing, {
      effectiveFrom: input.effectiveFrom ?? existing.effectiveFrom,
      effectiveTo: input.effectiveTo ?? existing.effectiveTo,
      managerMemberId: input.managerMemberId ?? existing.managerMemberId,
      priority: input.priority ?? existing.priority,
      scopeId: input.scopeId ?? existing.scopeId,
      scopeType: input.scopeType ?? existing.scopeType,
    });

    return this.managerResolutionRepository.save(next);
  }

  async listManagerResolutions(): Promise<readonly ManagerResolutionEntity[]> {
    return this.managerResolutionRepository.find({
      order: { priority: 'DESC', createdAt: 'DESC' },
    });
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

    return memberships.filter((membership) => this.isDateActive(membership, date));
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
    return date.toISOString().slice(0, 10);
  }

  private isDateActive(
    value: Pick<MembershipEntity | ManagerResolutionEntity, 'effectiveFrom' | 'effectiveTo'>,
    date: string,
  ): boolean {
    return value.effectiveFrom <= date && (!value.effectiveTo || value.effectiveTo >= date);
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
