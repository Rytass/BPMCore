import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, LessThanOrEqual, Repository } from 'typeorm';
import { ConditionService } from '../condition/condition.service';
import {
  CreateDelegationRuleInput,
  UpdateDelegationRuleInput,
} from './dto/delegation-rule.input';
import { DelegationRuleEntity } from './delegation-rule.entity';
import {
  DelegationRuleStatusEnum,
  DelegationScopeTypeEnum,
} from './delegation.enums';

export interface DelegationResolutionContext {
  readonly formData: Readonly<Record<string, unknown>>;
  readonly initiatorMemberId: string;
  readonly initiatorMetadataSnapshot: Readonly<Record<string, unknown>>;
  readonly instanceId: string;
  readonly nodeId: string;
  readonly state: string;
  readonly templateId: string;
  readonly templateVersionId: string;
  readonly title: string;
}

export interface DelegationResolution {
  readonly delegationChain: readonly DelegationStep[];
  readonly finalAssigneeMemberId: string;
}

export interface DelegationStep extends Readonly<Record<string, unknown>> {
  readonly from: string;
  readonly reason: string;
  readonly ruleId: string | null;
  readonly to: string;
}

interface ListDelegationRulesOptions {
  readonly agentMemberId?: string | null;
  readonly includeInactive?: boolean;
  readonly page?: number;
  readonly pageSize?: number;
  readonly principalMemberId?: string | null;
  readonly scopeType?: DelegationScopeTypeEnum | null;
  readonly status?: DelegationRuleStatusEnum;
}

@Injectable()
export class DelegationService {
  constructor(
    @InjectRepository(DelegationRuleEntity)
    private readonly delegationRuleRepository: Repository<DelegationRuleEntity>,
    private readonly conditionService: ConditionService,
  ) {}

  async listDelegationRules(
    options: ListDelegationRulesOptions = {},
  ): Promise<readonly DelegationRuleEntity[]> {
    const isPaginated =
      typeof options.page === 'number' || typeof options.pageSize === 'number';
    const normalizedPageSize = isPaginated
      ? normalizePageSize(options.pageSize ?? 10)
      : undefined;

    return this.delegationRuleRepository.find({
      order: {
        createdAt: 'DESC',
        priority: 'ASC',
      },
      ...(normalizedPageSize
        ? {
            skip: (normalizePage(options.page ?? 1) - 1) * normalizedPageSize,
            take: normalizedPageSize,
          }
        : {}),
      where: createDelegationRuleWhere(options),
    });
  }

  async countDelegationRules(
    options: Pick<
      ListDelegationRulesOptions,
      | 'agentMemberId'
      | 'includeInactive'
      | 'principalMemberId'
      | 'scopeType'
      | 'status'
    > = {},
  ): Promise<number> {
    return this.delegationRuleRepository.count({
      where: createDelegationRuleWhere(options),
    });
  }

  async createDelegationRule(
    input: CreateDelegationRuleInput,
  ): Promise<DelegationRuleEntity> {
    const normalizedRule = this.normalizeRuleInput(input);

    await this.assertNoActiveCycle(
      normalizedRule.principalMemberId,
      normalizedRule.agentMemberId,
    );

    return this.delegationRuleRepository.save(
      this.delegationRuleRepository.create({
        ...normalizedRule,
        revokedAt: null,
        revokedByMemberId: null,
        status: DelegationRuleStatusEnum.ACTIVE,
      }),
    );
  }

  async updateDelegationRule(
    input: UpdateDelegationRuleInput,
  ): Promise<DelegationRuleEntity> {
    const currentRule = await this.readRuleOrThrow(input.id);
    const normalizedRule = this.normalizeRuleInput({
      ...input,
      principalMemberId: currentRule.principalMemberId,
      createdByMemberId: currentRule.createdByMemberId,
    });

    await this.assertNoActiveCycle(
      normalizedRule.principalMemberId,
      normalizedRule.agentMemberId,
      currentRule.id,
    );

    return this.delegationRuleRepository.save({
      ...currentRule,
      ...normalizedRule,
    });
  }

  async getDelegationRule(id: string): Promise<DelegationRuleEntity> {
    return this.readRuleOrThrow(id);
  }

  async revokeDelegationRule({
    id,
    revokedByMemberId,
  }: {
    readonly id: string;
    readonly revokedByMemberId?: string | null;
  }): Promise<DelegationRuleEntity> {
    const rule = await this.readRuleOrThrow(id);

    if (rule.status === DelegationRuleStatusEnum.REVOKED) {
      return rule;
    }

    return this.delegationRuleRepository.save({
      ...rule,
      revokedAt: new Date(),
      revokedByMemberId: revokedByMemberId?.trim() || null,
      status: DelegationRuleStatusEnum.REVOKED,
    });
  }

  async resolveAssignee(
    originalAssigneeMemberId: string,
    context: DelegationResolutionContext,
    at: Date = new Date(),
  ): Promise<DelegationResolution> {
    return this.walkDelegationChain(
      originalAssigneeMemberId,
      context,
      at,
      new Set([originalAssigneeMemberId]),
      [],
    );
  }

  private async walkDelegationChain(
    principalMemberId: string,
    context: DelegationResolutionContext,
    at: Date,
    visitedMemberIds: ReadonlySet<string>,
    chain: readonly DelegationStep[],
  ): Promise<DelegationResolution> {
    const applicableRule = (
      await this.delegationRuleRepository.find({
        order: {
          createdAt: 'ASC',
          priority: 'ASC',
        },
        where: {
          principalMemberId,
          startAt: LessThanOrEqual(at),
          status: DelegationRuleStatusEnum.ACTIVE,
        },
      })
    )
      .filter((rule) => !rule.endAt || rule.endAt.getTime() > at.getTime())
      .find((rule) => this.matchesRuleScope(rule, context));

    if (!applicableRule) {
      return {
        delegationChain: chain,
        finalAssigneeMemberId: principalMemberId,
      };
    }

    if (visitedMemberIds.has(applicableRule.agentMemberId)) {
      throw new ConflictException(
        `Delegation cycle detected for member ${applicableRule.agentMemberId}`,
      );
    }

    const nextChain: readonly DelegationStep[] = [
      ...chain,
      {
        from: principalMemberId,
        reason: applicableRule.scopeType,
        ruleId: applicableRule.id,
        to: applicableRule.agentMemberId,
      },
    ];

    return this.walkDelegationChain(
      applicableRule.agentMemberId,
      context,
      at,
      new Set(visitedMemberIds).add(applicableRule.agentMemberId),
      nextChain,
    );
  }

  private matchesRuleScope(
    rule: DelegationRuleEntity,
    context: DelegationResolutionContext,
  ): boolean {
    if (rule.scopeType === DelegationScopeTypeEnum.ALL) {
      return true;
    }

    if (rule.scopeType === DelegationScopeTypeEnum.TEMPLATE_LIST) {
      return rule.scopeTemplateIds.includes(context.templateId);
    }

    return this.conditionService.evaluateBoolean(
      rule.scopeConditionCel,
      buildDelegationExpressionContext(rule.principalMemberId, context),
      `delegationRules.${rule.id}.scopeConditionCel`,
    );
  }

  private async assertNoActiveCycle(
    principalMemberId: string,
    agentMemberId: string,
    ignoredRuleId: string | null = null,
  ): Promise<void> {
    if (principalMemberId === agentMemberId) {
      throw new ConflictException('Principal and agent must be different');
    }

    const activeRules = await this.delegationRuleRepository.find({
      where: {
        status: DelegationRuleStatusEnum.ACTIVE,
      },
    });
    const nextRules = activeRules
      .filter((rule) => rule.id !== ignoredRuleId)
      .map((rule) => ({
        agentMemberId: rule.agentMemberId,
        principalMemberId: rule.principalMemberId,
      }));

    assertDelegationGraphHasNoCycle(
      [
        ...nextRules,
        {
          agentMemberId,
          principalMemberId,
        },
      ],
      principalMemberId,
    );
  }

  private async readRuleOrThrow(id: string): Promise<DelegationRuleEntity> {
    const rule = await this.delegationRuleRepository.findOne({ where: { id } });

    if (!rule) {
      throw new NotFoundException(`Delegation rule ${id} was not found`);
    }

    return rule;
  }

  private normalizeRuleInput(
    input: CreateDelegationRuleInput &
      Readonly<{
        readonly principalMemberId: string;
      }>,
  ): Omit<
    DelegationRuleEntity,
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'revokedAt'
    | 'revokedByMemberId'
    | 'status'
  > {
    const principalMemberId = input.principalMemberId.trim();
    const agentMemberId = input.agentMemberId.trim();
    const startAt = input.startAt ? new Date(input.startAt) : new Date();
    const endAt = input.endAt ? new Date(input.endAt) : null;

    if (!principalMemberId || !agentMemberId) {
      throw new BadRequestException('Principal and agent are required');
    }

    if (Number.isNaN(startAt.getTime())) {
      throw new BadRequestException('startAt is invalid');
    }

    if (endAt && Number.isNaN(endAt.getTime())) {
      throw new BadRequestException('endAt is invalid');
    }

    if (endAt && endAt.getTime() <= startAt.getTime()) {
      throw new BadRequestException('endAt must be after startAt');
    }

    const scopeTemplateIds = input.scopeTemplateIds ?? [];
    const scopeConditionCel = input.scopeConditionCel?.trim() || null;

    if (
      input.scopeType === DelegationScopeTypeEnum.TEMPLATE_LIST &&
      scopeTemplateIds.length === 0
    ) {
      throw new BadRequestException(
        'Template scoped delegation requires templates',
      );
    }

    if (
      input.scopeType === DelegationScopeTypeEnum.CONDITION_BASED &&
      !scopeConditionCel
    ) {
      throw new BadRequestException('Condition scoped delegation requires CEL');
    }

    const lintErrors = this.conditionService.lintExpression(
      scopeConditionCel,
      'scopeConditionCel',
    );

    if (lintErrors.length > 0) {
      throw new BadRequestException(lintErrors.join('; '));
    }

    return {
      agentMemberId,
      createdByMemberId: input.createdByMemberId?.trim() || null,
      priority: input.priority ?? 100,
      principalMemberId,
      requiresConfirmation: input.requiresConfirmation ?? false,
      scopeConditionCel:
        input.scopeType === DelegationScopeTypeEnum.CONDITION_BASED
          ? scopeConditionCel
          : null,
      scopeTemplateIds:
        input.scopeType === DelegationScopeTypeEnum.TEMPLATE_LIST
          ? scopeTemplateIds
          : [],
      scopeType: input.scopeType,
      startAt,
      endAt,
    };
  }
}

function buildDelegationExpressionContext(
  principalMemberId: string,
  context: DelegationResolutionContext,
): Readonly<Record<string, unknown>> {
  return {
    env: {
      now: new Date().toISOString(),
    },
    form: context.formData,
    formData: context.formData,
    initiator: {
      ...context.initiatorMetadataSnapshot,
      memberId: context.initiatorMemberId,
    },
    instance: {
      id: context.instanceId,
      nodeId: context.nodeId,
      state: context.state,
      templateId: context.templateId,
      templateVersionId: context.templateVersionId,
      title: context.title,
    },
    principal: {
      memberId: principalMemberId,
    },
  };
}

function assertDelegationGraphHasNoCycle(
  rules: readonly Readonly<{
    readonly agentMemberId: string;
    readonly principalMemberId: string;
  }>[],
  startingMemberId: string,
): void {
  const edges = rules.reduce<ReadonlyMap<string, readonly string[]>>(
    (groups, rule) =>
      new Map(groups).set(rule.principalMemberId, [
        ...(groups.get(rule.principalMemberId) ?? []),
        rule.agentMemberId,
      ]),
    new Map(),
  );

  walkDelegationGraph(startingMemberId, edges, new Set());
}

function walkDelegationGraph(
  memberId: string,
  edges: ReadonlyMap<string, readonly string[]>,
  path: ReadonlySet<string>,
): void {
  if (path.has(memberId)) {
    throw new ConflictException(
      `Delegation cycle detected for member ${memberId}`,
    );
  }

  (edges.get(memberId) ?? []).forEach((nextMemberId) =>
    walkDelegationGraph(nextMemberId, edges, new Set(path).add(memberId)),
  );
}

function createDelegationRuleWhere({
  agentMemberId,
  includeInactive = false,
  principalMemberId,
  scopeType,
  status,
}: Pick<
  ListDelegationRulesOptions,
  | 'agentMemberId'
  | 'includeInactive'
  | 'principalMemberId'
  | 'scopeType'
  | 'status'
>): FindOptionsWhere<DelegationRuleEntity> {
  return {
    ...(agentMemberId ? { agentMemberId } : {}),
    ...(principalMemberId ? { principalMemberId } : {}),
    ...(scopeType ? { scopeType } : {}),
    ...(status
      ? { status }
      : includeInactive
        ? {}
        : { status: DelegationRuleStatusEnum.ACTIVE }),
  };
}

function normalizePage(page: number): number {
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function normalizePageSize(pageSize: number): number {
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    return 10;
  }

  return Math.min(pageSize, 100);
}
