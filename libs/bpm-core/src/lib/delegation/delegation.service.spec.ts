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
    const find = jest.fn(
      (): Promise<readonly DelegationRuleEntity[]> => Promise.resolve([]),
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
    const find = jest.fn(
      (): Promise<readonly DelegationRuleEntity[]> => Promise.resolve([]),
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
