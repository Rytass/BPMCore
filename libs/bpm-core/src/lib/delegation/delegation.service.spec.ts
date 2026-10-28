import { ModuleRef } from '@nestjs/core';
import { UnknownElementException } from '@nestjs/core/errors/exceptions/unknown-element.exception.js';
import { MemberMetadata } from '@rytass/bpm-core-shared';
import { validateSync } from 'class-validator';
import { Repository } from 'typeorm';
import { ConditionService } from '../condition/condition.service';
import { CreateDelegationRuleInput } from './dto/delegation-rule.input';
import { DelegationRuleEntity } from './delegation-rule.entity';
import {
  DelegationRuleStatusEnum,
  DelegationScopeTypeEnum,
} from './delegation.enums';
import { DelegationService } from './delegation.service';

describe('DelegationService', () => {
  it('applies pagination and counts rules with matching filters', async (): Promise<void> => {
    const rules = Array.from({ length: 12 }, (_, index) =>
      createDelegationRule({ id: `rule-${index + 1}` }),
    );
    const find = jest.fn(
      ({
        skip = 0,
        take = 10,
      }: {
        readonly skip?: number;
        readonly take?: number;
      }): Promise<readonly DelegationRuleEntity[]> =>
        Promise.resolve(rules.slice(skip, skip + take)),
    );
    const count = jest.fn((): Promise<number> => Promise.resolve(rules.length));
    const service = new DelegationService(
      createDelegationRuleRepository({
        count,
        find,
      }),
      new ConditionService(),
    );

    const pageTwo = await service.listDelegationRules({
      includeInactive: true,
      page: 2,
      pageSize: 5,
    });
    const totalCount = await service.countDelegationRules({
      includeInactive: true,
    });

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 5, take: 5 }),
    );
    expect(pageTwo.map((rule) => rule.id)).toEqual([
      'rule-6',
      'rule-7',
      'rule-8',
      'rule-9',
      'rule-10',
    ]);
    expect(totalCount).toBe(12);
  });

  it('pushes active and principal filters into repository queries', async (): Promise<void> => {
    const find = jest.fn((): Promise<readonly DelegationRuleEntity[]> =>
      Promise.resolve([]),
    );
    const count = jest.fn((): Promise<number> => Promise.resolve(0));
    const service = new DelegationService(
      createDelegationRuleRepository({
        count,
        find,
      }),
      new ConditionService(),
    );

    await service.listDelegationRules({
      agentMemberId: 'member-101',
      includeInactive: false,
      principalMemberId: 'member-001',
      scopeType: DelegationScopeTypeEnum.TEMPLATE_LIST,
    });
    await service.countDelegationRules({
      agentMemberId: 'member-101',
      includeInactive: false,
      principalMemberId: 'member-001',
      scopeType: DelegationScopeTypeEnum.TEMPLATE_LIST,
    });

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          agentMemberId: 'member-101',
          principalMemberId: 'member-001',
          scopeType: DelegationScopeTypeEnum.TEMPLATE_LIST,
          status: DelegationRuleStatusEnum.ACTIVE,
        },
      }),
    );
    expect(count).toHaveBeenCalledWith({
      where: {
        agentMemberId: 'member-101',
        principalMemberId: 'member-001',
        scopeType: DelegationScopeTypeEnum.TEMPLATE_LIST,
        status: DelegationRuleStatusEnum.ACTIVE,
      },
    });
  });

  it('uses explicit status filter for paginated delegation lists and counts', async (): Promise<void> => {
    const find = jest.fn((): Promise<readonly DelegationRuleEntity[]> =>
      Promise.resolve([]),
    );
    const count = jest.fn((): Promise<number> => Promise.resolve(0));
    const service = new DelegationService(
      createDelegationRuleRepository({
        count,
        find,
      }),
      new ConditionService(),
    );

    await service.listDelegationRules({
      includeInactive: true,
      status: DelegationRuleStatusEnum.REVOKED,
    });
    await service.countDelegationRules({
      includeInactive: true,
      status: DelegationRuleStatusEnum.REVOKED,
    });

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: DelegationRuleStatusEnum.REVOKED,
        },
      }),
    );
    expect(count).toHaveBeenCalledWith({
      where: {
        status: DelegationRuleStatusEnum.REVOKED,
      },
    });
  });

  it('resolves an active delegation chain in priority order', async (): Promise<void> => {
    const rules = [
      createDelegationRule({
        agentMemberId: 'member-101',
        id: 'rule-1',
        principalMemberId: 'member-001',
        priority: 10,
      }),
      createDelegationRule({
        agentMemberId: 'member-102',
        id: 'rule-2',
        principalMemberId: 'member-101',
        priority: 10,
      }),
    ];
    const repository = createDelegationRuleRepository({
      find: jest.fn(
        ({
          where,
        }: Readonly<{
          readonly where: Readonly<{
            readonly principalMemberId: string;
            readonly status: DelegationRuleStatusEnum;
          }>;
        }>) =>
          Promise.resolve(
            rules.filter(
              (rule) =>
                rule.status === where.status &&
                rule.principalMemberId === where.principalMemberId,
            ),
          ),
      ),
    });
    const service = new DelegationService(repository, new ConditionService());

    const resolution = await service.resolveAssignee('member-001', {
      formData: {},
      initiatorMemberId: 'member-000',
      initiatorMetadataSnapshot: {},
      instanceId: 'instance-1',
      nodeId: 'task-1',
      state: 'RUNNING',
      templateId: 'template-1',
      templateVersionId: 'template-version-1',
      title: '費用申請',
    });

    expect(resolution).toEqual({
      delegationChain: [
        {
          from: 'member-001',
          reason: 'ALL',
          ruleId: 'rule-1',
          to: 'member-101',
        },
        {
          from: 'member-101',
          reason: 'ALL',
          ruleId: 'rule-2',
          to: 'member-102',
        },
      ],
      finalAssigneeMemberId: 'member-102',
    });
  });

  describe('choosing between rules of one principal', (): void => {
    // Sorts the way the database would: by each `order` key in turn, in the
    // order the keys were written.
    const sortByOrder = (
      rules: readonly DelegationRuleEntity[],
      order: Readonly<Record<string, 'ASC' | 'DESC'>>,
    ): readonly DelegationRuleEntity[] =>
      [...rules].sort((left, right) =>
        Object.entries(order).reduce((result, [key, direction]) => {
          if (result !== 0) {
            return result;
          }

          const leftValue = Number(left[key as keyof DelegationRuleEntity]);
          const rightValue = Number(right[key as keyof DelegationRuleEntity]);
          const diff = leftValue - rightValue;

          return direction === 'ASC' ? diff : -diff;
        }, 0),
      );
    const resolveWith = (
      rules: readonly DelegationRuleEntity[],
    ): Promise<string> =>
      new DelegationService(
        createDelegationRuleRepository({
          find: jest.fn(
            ({
              order,
              where,
            }: Readonly<{
              readonly order: Readonly<Record<string, 'ASC' | 'DESC'>>;
              readonly where: Readonly<{ readonly principalMemberId: string }>;
            }>): Promise<readonly DelegationRuleEntity[]> =>
              Promise.resolve(
                sortByOrder(
                  rules.filter(
                    (rule) =>
                      rule.principalMemberId === where.principalMemberId,
                  ),
                  order,
                ),
              ),
          ),
        }),
        new ConditionService(),
      )
        .resolveAssignee('member-001', {
          formData: {},
          initiatorMemberId: 'member-000',
          initiatorMetadataSnapshot: {},
          instanceId: 'instance-1',
          nodeId: 'task-1',
          state: 'RUNNING',
          templateId: 'template-1',
          templateVersionId: 'template-version-1',
          title: '費用申請',
        })
        .then((resolution) => resolution.finalAssigneeMemberId);

    it('applies the higher priority even when it was created later', async (): Promise<void> => {
      // Creation time used to be the first sort key, so the older rule won
      // whatever the 優先序 field said.
      await expect(
        resolveWith([
          createDelegationRule({
            agentMemberId: 'member-101',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            id: 'rule-old-low',
            principalMemberId: 'member-001',
            priority: 10,
          }),
          createDelegationRule({
            agentMemberId: 'member-102',
            createdAt: new Date('2026-02-01T00:00:00.000Z'),
            id: 'rule-new-high',
            principalMemberId: 'member-001',
            priority: 50,
          }),
        ]),
      ).resolves.toBe('member-102');
    });

    it('applies the rule created first when priorities tie', async (): Promise<void> => {
      await expect(
        resolveWith([
          createDelegationRule({
            agentMemberId: 'member-102',
            createdAt: new Date('2026-02-01T00:00:00.000Z'),
            id: 'rule-new',
            principalMemberId: 'member-001',
            priority: 100,
          }),
          createDelegationRule({
            agentMemberId: 'member-101',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            id: 'rule-old',
            principalMemberId: 'member-001',
            priority: 100,
          }),
        ]),
      ).resolves.toBe('member-101');
    });
  });

  describe('a rule whose agent the host has deactivated', (): void => {
    const context = {
      formData: {},
      initiatorMemberId: 'member-000',
      initiatorMetadataSnapshot: {},
      instanceId: 'instance-1',
      nodeId: 'task-1',
      state: 'RUNNING',
      templateId: 'template-1',
      templateVersionId: 'template-version-1',
      title: '費用申請',
    };
    const findByPrincipal = (
      rules: readonly DelegationRuleEntity[],
    ): jest.Mock =>
      jest.fn(
        ({
          where,
        }: Readonly<{
          readonly where: Readonly<{ readonly principalMemberId: string }>;
        }>): Promise<readonly DelegationRuleEntity[]> =>
          Promise.resolve(
            rules.filter(
              (rule) => rule.principalMemberId === where.principalMemberId,
            ),
          ),
      );
    // Answers like a host resolver: only the deactivated ids it was asked about.
    const createIdentityService = (
      deactivatedMemberIds: readonly string[],
    ): Readonly<{
      readonly resolveInactiveMembers: jest.Mock;
    }> => ({
      resolveInactiveMembers: jest.fn(
        (memberIds: readonly string[]): Promise<readonly MemberMetadata[]> =>
          Promise.resolve(
            memberIds
              .filter((memberId) => deactivatedMemberIds.includes(memberId))
              .map((memberId) => ({
                customFields: {},
                email: `${memberId}@example.com`,
                memberId,
                name: memberId,
              })),
          ),
      ),
    });
    const createModuleRef = (get: jest.Mock): ModuleRef =>
      ({ get }) as unknown as ModuleRef;
    const createService = (
      rules: readonly DelegationRuleEntity[],
      moduleRef?: ModuleRef,
    ): DelegationService =>
      new DelegationService(
        createDelegationRuleRepository({ find: findByPrincipal(rules) }),
        new ConditionService(),
        moduleRef,
      );
    const singleRule = [
      createDelegationRule({
        agentMemberId: 'member-101',
        id: 'rule-1',
        principalMemberId: 'member-001',
      }),
    ];

    it('leaves the task with the principal', async (): Promise<void> => {
      const identityService = createIdentityService(['member-101']);
      const service = createService(
        singleRule,
        createModuleRef(jest.fn(() => identityService)),
      );

      await expect(
        service.resolveAssignee('member-001', context),
      ).resolves.toEqual({
        delegationChain: [],
        finalAssigneeMemberId: 'member-001',
      });
      expect(identityService.resolveInactiveMembers).toHaveBeenCalledWith([
        'member-101',
      ]);
    });

    it('still delegates when the agent is active', async (): Promise<void> => {
      const service = createService(
        singleRule,
        createModuleRef(jest.fn(() => createIdentityService(['member-999']))),
      );

      await expect(
        service.resolveAssignee('member-001', context),
      ).resolves.toMatchObject({ finalAssigneeMemberId: 'member-101' });
    });

    // Rules listed in the order the repository returns them: priority first.
    const twoRules = [
      createDelegationRule({
        agentMemberId: 'member-101',
        id: 'rule-high',
        principalMemberId: 'member-001',
        priority: 50,
      }),
      createDelegationRule({
        agentMemberId: 'member-102',
        id: 'rule-low',
        principalMemberId: 'member-001',
        priority: 10,
      }),
    ];

    it('falls through to the next rule of the principal', async (): Promise<void> => {
      const service = createService(
        twoRules,
        createModuleRef(jest.fn(() => createIdentityService(['member-101']))),
      );

      await expect(
        service.resolveAssignee('member-001', context),
      ).resolves.toEqual({
        delegationChain: [
          {
            from: 'member-001',
            reason: 'ALL',
            ruleId: 'rule-low',
            to: 'member-102',
          },
        ],
        finalAssigneeMemberId: 'member-102',
      });
    });

    it('leaves the task with the principal when every agent is deactivated', async (): Promise<void> => {
      const service = createService(
        twoRules,
        createModuleRef(
          jest.fn(() => createIdentityService(['member-101', 'member-102'])),
        ),
      );

      await expect(
        service.resolveAssignee('member-001', context),
      ).resolves.toEqual({
        delegationChain: [],
        finalAssigneeMemberId: 'member-001',
      });
    });

    it('stops the chain at the last active agent', async (): Promise<void> => {
      const service = createService(
        [
          ...singleRule,
          createDelegationRule({
            agentMemberId: 'member-102',
            id: 'rule-2',
            principalMemberId: 'member-101',
          }),
        ],
        createModuleRef(jest.fn(() => createIdentityService(['member-102']))),
      );

      await expect(
        service.resolveAssignee('member-001', context),
      ).resolves.toEqual({
        delegationChain: [
          {
            from: 'member-001',
            reason: 'ALL',
            ruleId: 'rule-1',
            to: 'member-101',
          },
        ],
        finalAssigneeMemberId: 'member-101',
      });
    });

    it('does not ask the host when the principal has no current rule', async (): Promise<void> => {
      const get = jest.fn();
      const service = createService([], createModuleRef(get));

      await expect(
        service.resolveAssignee('member-001', context),
      ).resolves.toMatchObject({ finalAssigneeMemberId: 'member-001' });
      expect(get).not.toHaveBeenCalled();
    });

    it('delegates as before when the host wires no identity module', async (): Promise<void> => {
      const service = createService(
        singleRule,
        createModuleRef(
          jest.fn(() => {
            throw new UnknownElementException('IdentityService');
          }),
        ),
      );

      await expect(
        service.resolveAssignee('member-001', context),
      ).resolves.toMatchObject({ finalAssigneeMemberId: 'member-101' });
    });

    it('surfaces any other failure to look the identity module up', async (): Promise<void> => {
      const service = createService(
        singleRule,
        createModuleRef(
          jest.fn(() => {
            throw new Error('module graph broken');
          }),
        ),
      );

      await expect(
        service.resolveAssignee('member-001', context),
      ).rejects.toThrow('module graph broken');
    });
  });

  it('rejects direct delegation cycles when creating a rule', async (): Promise<void> => {
    const repository = createDelegationRuleRepository({
      create: jest.fn((entity: Partial<DelegationRuleEntity>) =>
        Object.assign(new DelegationRuleEntity(), entity),
      ),
      find: jest.fn(() =>
        Promise.resolve([
          createDelegationRule({
            agentMemberId: 'member-001',
            id: 'rule-1',
            principalMemberId: 'member-101',
          }),
        ]),
      ),
      save: jest.fn((rule: DelegationRuleEntity) => Promise.resolve(rule)),
    });
    const service = new DelegationService(repository, new ConditionService());

    await expect(
      service.createDelegationRule({
        agentMemberId: 'member-101',
        createdByMemberId: 'member-001',
        principalMemberId: 'member-001',
        priority: 100,
        requiresConfirmation: false,
        scopeConditionCel: null,
        scopeTemplateIds: [],
        scopeType: DelegationScopeTypeEnum.ALL,
        startAt: null,
        endAt: null,
      }),
    ).rejects.toThrow('Delegation cycle detected');
  });

  describe('scope condition roots', (): void => {
    const createConditionRule = (
      scopeConditionCel: string,
    ): Promise<DelegationRuleEntity> =>
      new DelegationService(
        createDelegationRuleRepository({
          create: jest.fn((entity: Partial<DelegationRuleEntity>) =>
            Object.assign(new DelegationRuleEntity(), entity),
          ),
          find: jest.fn((): Promise<readonly DelegationRuleEntity[]> =>
            Promise.resolve([]),
          ),
          save: jest.fn((rule: DelegationRuleEntity) => Promise.resolve(rule)),
        }),
        new ConditionService(),
      ).createDelegationRule({
        agentMemberId: 'member-101',
        createdByMemberId: 'member-001',
        principalMemberId: 'member-001',
        priority: 100,
        requiresConfirmation: false,
        scopeConditionCel,
        scopeTemplateIds: [],
        scopeType: DelegationScopeTypeEnum.CONDITION_BASED,
        startAt: null,
        endAt: null,
      });

    it('refuses a root the delegation context never provides', async (): Promise<void> => {
      // Saving used to check syntax only, so this rule was stored and then
      // threw on every task its principal was assigned.
      await expect(
        createConditionRule('task.nodeId == "review"'),
      ).rejects.toThrow(
        'scopeConditionCel references unsupported identifier task',
      );
    });

    it('accepts every root the delegation context provides', async (): Promise<void> => {
      await expect(
        createConditionRule(
          'form.amount > 0 && formData.amount > 0 && initiator.memberId != principal.memberId && instance.templateId != "" && env.now != ""',
        ),
      ).resolves.toMatchObject({
        scopeType: DelegationScopeTypeEnum.CONDITION_BASED,
      });
    });
  });

  // `save` here returns exactly what it was handed, which is what real TypeORM
  // does — so these two assertions genuinely check the shape the service
  // passed in. A row spread into a plain object loses the prototype, and with
  // it any getter-backed `@Field` the entity grows later; both of these rows
  // are the return value of a mutation.
  it('hands back an entity when a rule is updated', async (): Promise<void> => {
    const repository = createDelegationRuleRepository({
      find: jest.fn((): Promise<readonly DelegationRuleEntity[]> =>
        Promise.resolve([]),
      ),
      findOne: jest.fn(() =>
        Promise.resolve(createDelegationRule({ id: 'delegation-rule-1' })),
      ),
      save: jest.fn((rule: DelegationRuleEntity) => Promise.resolve(rule)),
    });
    const service = new DelegationService(repository, new ConditionService());

    const updatedRule = await service.updateDelegationRule({
      agentMemberId: 'member-102',
      endAt: null,
      id: 'delegation-rule-1',
      priority: 50,
      requiresConfirmation: false,
      scopeConditionCel: null,
      scopeTemplateIds: [],
      scopeType: DelegationScopeTypeEnum.ALL,
      startAt: null,
    });

    expect(updatedRule.agentMemberId).toBe('member-102');
    expect(updatedRule).toBeInstanceOf(DelegationRuleEntity);
  });

  it('hands back an entity when a rule is revoked', async (): Promise<void> => {
    const repository = createDelegationRuleRepository({
      findOne: jest.fn(() => Promise.resolve(createDelegationRule({}))),
      save: jest.fn((rule: DelegationRuleEntity) => Promise.resolve(rule)),
    });
    const service = new DelegationService(repository, new ConditionService());

    const revokedRule = await service.revokeDelegationRule({
      id: 'delegation-rule-1',
      revokedByMemberId: 'member-001',
    });

    expect(revokedRule.status).toBe(DelegationRuleStatusEnum.REVOKED);
    expect(revokedRule.revokedByMemberId).toBe('member-001');
    expect(revokedRule).toBeInstanceOf(DelegationRuleEntity);
  });

  it('validates delegation datetime inputs as ISO strings with timezone', (): void => {
    const input = Object.assign(new CreateDelegationRuleInput(), {
      agentMemberId: 'member-101',
      createdByMemberId: 'member-001',
      endAt: '2026-05-11T18:00',
      principalMemberId: 'member-001',
      priority: 100,
      requiresConfirmation: false,
      scopeConditionCel: null,
      scopeTemplateIds: [],
      scopeType: DelegationScopeTypeEnum.ALL,
      startAt: '2026-05-11T09:00',
    });

    expect(
      validateSync(input).flatMap((error) =>
        Object.values(error.constraints ?? {}),
      ),
    ).toEqual(
      expect.arrayContaining([
        'startAt must be ISO 8601 datetime with timezone',
        'endAt must be ISO 8601 datetime with timezone',
      ]),
    );
  });
});

function createDelegationRule(
  value: Partial<DelegationRuleEntity>,
): DelegationRuleEntity {
  return Object.assign(new DelegationRuleEntity(), {
    agentMemberId: value.agentMemberId ?? 'member-101',
    createdAt: value.createdAt ?? new Date('2026-05-09T00:00:00.000Z'),
    createdByMemberId: value.createdByMemberId ?? 'member-001',
    endAt: value.endAt ?? null,
    id: value.id ?? 'delegation-rule-1',
    principalMemberId: value.principalMemberId ?? 'member-001',
    priority: value.priority ?? 100,
    requiresConfirmation: value.requiresConfirmation ?? false,
    revokedAt: value.revokedAt ?? null,
    revokedByMemberId: value.revokedByMemberId ?? null,
    scopeConditionCel: value.scopeConditionCel ?? null,
    scopeTemplateIds: value.scopeTemplateIds ?? [],
    scopeType: value.scopeType ?? DelegationScopeTypeEnum.ALL,
    startAt: value.startAt ?? new Date('2026-05-09T00:00:00.000Z'),
    status: value.status ?? DelegationRuleStatusEnum.ACTIVE,
    updatedAt: value.updatedAt ?? new Date('2026-05-09T00:00:00.000Z'),
  });
}

function createDelegationRuleRepository(
  value: Readonly<Record<string, unknown>>,
): Repository<DelegationRuleEntity> {
  return value as unknown as Repository<DelegationRuleEntity>;
}
