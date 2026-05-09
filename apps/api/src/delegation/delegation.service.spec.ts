import { Repository } from 'typeorm';
import { ConditionService } from '../condition/condition.service';
import { DelegationRuleEntity } from './delegation-rule.entity';
import {
  DelegationRuleStatusEnum,
  DelegationScopeTypeEnum,
} from './delegation.enums';
import { DelegationService } from './delegation.service';

describe('DelegationService', () => {
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
