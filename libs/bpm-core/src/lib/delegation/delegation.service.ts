import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { UnknownElementException } from '@nestjs/core/errors/exceptions/unknown-element.exception.js';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, LessThanOrEqual, Repository } from 'typeorm';
import { ConditionService } from '../condition/condition.service';
import { IdentityService } from '../identity/identity.service';
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
  /** Set on an administrator reassignment: the administrator who made it. */
  readonly actorMemberId?: string;
  /** Set on an administrator reassignment: the reason they typed. */
  readonly comment?: string;
  readonly reason: string;
  readonly ruleId: string | null;
  readonly to: string;
}

/**
 * How long a delegation waits for the host's `resolveInactive`. Resolution runs
 * inside a launch or advance transaction, so a directory that hangs must not
 * hold its connection and locks: past this it counts as not answering.
 */
const DIRECTORY_LOOKUP_TIMEOUT_MS = 5_000;

/** `pending`, or a rejection once `timeoutMs` has passed without an answer. */
function readWithinTime<TValue>(
  pending: Promise<TValue>,
  timeoutMs: number,
): Promise<TValue> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  return Promise.race([
    pending,
    new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(
        (): void => reject(new Error(`no answer within ${timeoutMs} ms`)),
        timeoutMs,
      );
    }),
  ]).finally((): void => clearTimeout(timeoutId));
}

/** A hop whose rules and deactivated agents were read ahead of the walk. */
interface PreloadedDelegationHop {
  readonly inactiveAgentIds: ReadonlySet<string>;
  readonly rules: readonly DelegationRuleEntity[];
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
  private readonly logger = new Logger(DelegationService.name);

  constructor(
    @InjectRepository(DelegationRuleEntity)
    private readonly delegationRuleRepository: Repository<DelegationRuleEntity>,
    private readonly conditionService: ConditionService,
    @Optional() private readonly moduleRef?: ModuleRef,
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
      // Same order as manager rules: higher priority first, newest first.
      order: {
        priority: 'DESC',
        createdAt: 'DESC',
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

    // Assigning onto a fresh entity keeps the prototype. `DelegationRuleEntity`
    // has no getter-backed `@Field` today, but this row is the return value of
    // the `updateDelegationRule` mutation, so adding one to a plain object
    // would fail the mutation after the write had already been committed.
    return this.delegationRuleRepository.save(
      Object.assign(new DelegationRuleEntity(), currentRule, normalizedRule),
    );
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

    return this.delegationRuleRepository.save(
      Object.assign(new DelegationRuleEntity(), rule, {
        revokedAt: new Date(),
        revokedByMemberId: revokedByMemberId?.trim() || null,
        status: DelegationRuleStatusEnum.REVOKED,
      }),
    );
  }

  async resolveAssignee(
    originalAssigneeMemberId: string,
    context: DelegationResolutionContext,
    at: Date = new Date(),
  ): Promise<DelegationResolution> {
    const [resolution] = await this.resolveAssignees(
      [originalAssigneeMemberId],
      context,
      at,
    );

    return resolution;
  }

  /**
   * {@link resolveAssignee} for every member of `originalAssigneeMemberIds`,
   * in the same order. The first hop of every chain shares one
   * `resolveInactive` call, so a node with many candidates asks the host
   * directory once rather than once per candidate; only a hop beyond the
   * first asks again.
   */
  async resolveAssignees(
    originalAssigneeMemberIds: readonly string[],
    context: DelegationResolutionContext,
    at: Date = new Date(),
  ): Promise<readonly DelegationResolution[]> {
    const rulesByPrincipal = await Promise.all(
      originalAssigneeMemberIds.map((memberId) =>
        this.readCurrentRules(memberId, at),
      ),
    );
    const inactiveAgentIds = await this.readInactiveAgentIds(
      rulesByPrincipal.flat(),
    );

    return Promise.all(
      originalAssigneeMemberIds.map((memberId, index) =>
        this.walkDelegationChain(
          memberId,
          context,
          at,
          new Set([memberId]),
          [],
          { inactiveAgentIds, rules: rulesByPrincipal[index] },
        ),
      ),
    );
  }

  private async walkDelegationChain(
    principalMemberId: string,
    context: DelegationResolutionContext,
    at: Date,
    visitedMemberIds: ReadonlySet<string>,
    chain: readonly DelegationStep[],
    preloadedHop?: PreloadedDelegationHop,
  ): Promise<DelegationResolution> {
    const currentRules =
      preloadedHop?.rules ??
      (await this.readCurrentRules(principalMemberId, at));
    const inactiveAgentIds =
      preloadedHop?.inactiveAgentIds ??
      (await this.readInactiveAgentIds(currentRules));
    // A rule whose agent the host has deactivated no longer applies: handing
    // the task to them would leave it with someone who can no longer sign in.
    // Checked before the scope so a scope condition is still only evaluated
    // for the rules up to the one that applies.
    const applicableRule = currentRules.find(
      (rule) =>
        !inactiveAgentIds.has(rule.agentMemberId) &&
        this.matchesRuleScope(rule, context),
    );

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

  /** The principal's rules in force at `at`, the applicable one first. */
  private async readCurrentRules(
    principalMemberId: string,
    at: Date,
  ): Promise<readonly DelegationRuleEntity[]> {
    return (
      await this.delegationRuleRepository.find({
        // Higher priority wins, as with manager rules; among equal priorities
        // the rule created first wins. TypeORM sorts by key order, so
        // `priority` has to be the first key — it used to come second and
        // only broke ties between rules created in the same instant.
        order: {
          priority: 'DESC',
          createdAt: 'ASC',
        },
        where: {
          principalMemberId,
          startAt: LessThanOrEqual(at),
          status: DelegationRuleStatusEnum.ACTIVE,
        },
      })
    ).filter((rule) => !rule.endAt || rule.endAt.getTime() > at.getTime());
  }

  /**
   * Agents of `rules` the host reports as deactivated. Empty when there is no
   * rule to check, or no identity module (or no `resolveInactive` on the host
   * resolver): delegation then behaves as it did before this check existed.
   *
   * When the host directory fails to answer, or has not answered within
   * {@link DIRECTORY_LOOKUP_TIMEOUT_MS}, every agent counts as deactivated, so each principal keeps the task: no task goes to an agent
   * who could not be confirmed active, and a directory outage does not stop
   * a launch or an advance either.
   */
  private async readInactiveAgentIds(
    rules: readonly DelegationRuleEntity[],
  ): Promise<ReadonlySet<string>> {
    const identityService = rules.length ? this.readIdentityService() : null;

    if (!identityService) {
      return new Set();
    }

    const agentMemberIds = [
      ...new Set(rules.map((rule) => rule.agentMemberId)),
    ];

    return readWithinTime(
      identityService.resolveInactiveMembers(agentMemberIds),
      DIRECTORY_LOOKUP_TIMEOUT_MS,
    ).then(
      (inactiveMembers): ReadonlySet<string> =>
        new Set(inactiveMembers.map((member) => member.memberId)),
      (error: unknown): ReadonlySet<string> => {
        this.logger.warn(
          `Host directory lookup (resolveInactive) failed for delegation ` +
            `agents ${agentMemberIds.join(', ')}; their principals keep the ` +
            `task: ${error instanceof Error ? error.message : String(error)}`,
        );

        return new Set(agentMemberIds);
      },
    );
  }

  /**
   * Looked up at call time rather than injected: `IdentityModule` is a dynamic
   * module the root configures with the host's options, so this module cannot
   * import it (same as `WorkflowEngineQueries.readIdentityService`).
   */
  private readIdentityService(): IdentityService | null {
    if (!this.moduleRef) {
      return null;
    }

    try {
      return this.moduleRef.get(IdentityService, { strict: false });
    } catch (error) {
      // Only "not registered" means no identity module; anything else is a
      // real failure and must not pass for "no deactivated agent".
      if (error instanceof UnknownElementException) {
        return null;
      }

      throw error;
    }
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
      { allowedRootIdentifiers: DELEGATION_EXPRESSION_ROOT_IDENTIFIERS },
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

// The only roots a delegation condition can read. Saving a rule checks its CEL
// against this list, and the context below is typed by it, so the two cannot
// drift apart again.
const DELEGATION_EXPRESSION_ROOT_IDENTIFIERS = [
  'env',
  'form',
  'formData',
  'initiator',
  'instance',
  'principal',
] as const;

function buildDelegationExpressionContext(
  principalMemberId: string,
  context: DelegationResolutionContext,
): Readonly<
  Record<(typeof DELEGATION_EXPRESSION_ROOT_IDENTIFIERS)[number], unknown>
> {
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
