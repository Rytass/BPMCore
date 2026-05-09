import { WorkflowDefinition } from '@bpm/shared/workflow';
import { ConditionService } from '../condition/condition.service';
import { FormDefinitionVersionEntity } from '../form/form-definition-version.entity';
import { FormDefinitionVersionStatusEnum } from '../form/form.enums';
import { ApprovalTemplateVersionEntity } from '../template/approval-template-version.entity';
import { ApprovalTemplateEntity } from '../template/approval-template.entity';
import { ApprovalTemplateVersionStatusEnum } from '../template/template.enums';
import { ActivityLogEntity } from './activity-log.entity';
import { ApprovalInstanceEntity } from './approval-instance.entity';
import { TaskDecisionEntity } from './task-decision.entity';
import { TaskEntity } from './task.entity';
import {
  ActivityLogEventTypeEnum,
  ApprovalInstanceStateEnum,
  TaskDecisionActionEnum,
  TaskStatusEnum,
  WorkflowTokenStatusEnum,
} from './workflow-engine.enums';
import { WorkflowEngineService } from './workflow-engine.service';
import { WorkflowTokenEntity } from './workflow-token.entity';

describe('WorkflowEngineService', () => {
  it('submits an approval instance with snapshots, start token, and activity logs', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    const instance = await fixture.service.submitApprovalInstance({
      formDataJson: '{"amount":1000}',
      initiatorMemberId: 'member-001',
      initiatorMetadataSnapshotJson: '{"memberId":"member-001","roles":["IT"]}',
      templateId: 'template-1',
      title: null,
    });

    expect(instance.state).toBe(ApprovalInstanceStateEnum.RUNNING);
    expect(instance.workflowSnapshot.nodes[0]?.id).toBe('start');
    expect(instance.formDefinitionSnapshot).toMatchObject({
      formDefinitionVersionId: 'form-version-1',
      version: 1,
    });
    expect(instance.formData).toEqual({ amount: 1000 });
    expect(fixture.savedToken).toMatchObject({
      currentNodeId: 'start',
      instanceId: 'instance-1',
      status: WorkflowTokenStatusEnum.ACTIVE,
    });
    expect(fixture.savedActivityLogs.map((log) => log.eventType)).toEqual([
      ActivityLogEventTypeEnum.INSTANCE_STARTED,
      ActivityLogEventTypeEnum.TOKEN_CREATED,
    ]);
  });

  it('rejects submit when the template has no published current version', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: null,
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(
      fixture.service.submitApprovalInstance({
        formDataJson: '{}',
        initiatorMemberId: 'member-001',
        initiatorMetadataSnapshotJson: null,
        templateId: 'template-1',
        title: 'Request',
      }),
    ).rejects.toThrow('Approval template does not have a published version');
  });

  it('uses an advisory lock when processing an instance', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(fixture.managerQuery).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      ['instance-1'],
    );
    expect(fixture.savedProcessLog?.eventType).toBe(
      ActivityLogEventTypeEnum.ENGINE_PROCESS_REQUESTED,
    );
  });

  it('advances a start token and creates a direct user task', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow(),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(fixture.savedProcessToken).toMatchObject({
      currentNodeId: 'task_finance',
      status: WorkflowTokenStatusEnum.WAITING,
    });
    expect(fixture.savedTasks).toEqual([
      expect.objectContaining({
        assigneeMemberId: 'member-finance',
        instanceId: 'instance-1',
        nodeId: 'task_finance',
        originalAssigneeMemberId: 'member-finance',
        status: TaskStatusEnum.PENDING,
        tokenId: 'token-1',
      }),
    ]);
    expect(fixture.savedSingleActivityLogs.map((log) => log.eventType)).toEqual(
      [
        ActivityLogEventTypeEnum.ENGINE_PROCESS_REQUESTED,
        ActivityLogEventTypeEnum.TOKEN_ADVANCED,
        ActivityLogEventTypeEnum.TASK_CREATED,
      ],
    );
  });

  it('approves a task and completes the linear instance', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      decisionTask: createTask({
        nodeId: 'task_finance',
        status: TaskStatusEnum.PENDING,
        tokenId: 'token-1',
      }),
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow(),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    const decision = await fixture.service.decideTask({
      action: TaskDecisionActionEnum.APPROVED,
      comment: '同意',
      decidedByMemberId: 'member-finance',
      taskId: 'task-1',
    });

    expect(decision).toMatchObject({
      action: TaskDecisionActionEnum.APPROVED,
      comment: '同意',
      decidedByMemberId: 'member-finance',
      taskId: 'task-1',
    });
    expect(fixture.savedProcessToken).toMatchObject({
      currentNodeId: 'end',
      status: WorkflowTokenStatusEnum.CONSUMED,
    });
    expect(fixture.savedInstance).toMatchObject({
      completedAt: expect.any(Date),
      state: ApprovalInstanceStateEnum.APPROVED,
    });
  });

  it('requires a rejection comment before rejecting a task', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      decisionTask: createTask({
        nodeId: 'task_finance',
        status: TaskStatusEnum.PENDING,
        tokenId: 'token-1',
      }),
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow(),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await expect(
      fixture.service.decideTask({
        action: TaskDecisionActionEnum.REJECTED,
        comment: '   ',
        decidedByMemberId: 'member-finance',
        taskId: 'task-1',
      }),
    ).rejects.toThrow('Reject decision comment is required');
  });

  it('rejects a task with a rejection comment', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      decisionTask: createTask({
        nodeId: 'task_finance',
        status: TaskStatusEnum.PENDING,
        tokenId: 'token-1',
      }),
      decisionToken: createWorkflowToken({
        currentNodeId: 'task_finance',
        status: WorkflowTokenStatusEnum.WAITING,
      }),
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createLinearUserTaskWorkflow(),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    const decision = await fixture.service.decideTask({
      action: TaskDecisionActionEnum.REJECTED,
      comment: '  資料不足，請補件  ',
      decidedByMemberId: 'member-finance',
      taskId: 'task-1',
    });

    expect(decision).toMatchObject({
      action: TaskDecisionActionEnum.REJECTED,
      comment: '資料不足，請補件',
      decidedByMemberId: 'member-finance',
      taskId: 'task-1',
    });
    expect(fixture.savedSingleActivityLogs).toContainEqual(
      expect.objectContaining({
        eventType: ActivityLogEventTypeEnum.TASK_DECIDED,
        payload: expect.objectContaining({
          action: TaskDecisionActionEnum.REJECTED,
          comment: '資料不足，請補件',
        }),
      }),
    );
    expect(fixture.savedInstance).toMatchObject({
      completedAt: expect.any(Date),
      state: ApprovalInstanceStateEnum.REJECTED,
    });
  });

  it('lists pending inbox tasks by assignee', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.listInboxTasks('member-finance');

    expect(fixture.rootTaskFind).toHaveBeenCalledWith({
      order: { createdAt: 'DESC' },
      where: {
        assigneeMemberId: 'member-finance',
        status: expect.any(Object),
      },
    });
  });

  it('lists completed approval history tasks by assignee', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.listApprovalHistoryTasks('member-finance');

    expect(fixture.rootTaskFind).toHaveBeenCalledWith({
      order: { completedAt: 'DESC', createdAt: 'DESC' },
      where: {
        assigneeMemberId: 'member-finance',
        status: TaskStatusEnum.COMPLETED,
      },
    });
  });

  it('routes an exclusive gateway through the first matching condition', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processFormData: { amount: 1500 },
      processWorkflowSnapshot: createExclusiveGatewayWorkflow(),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(fixture.savedTasks).toEqual([
      expect.objectContaining({
        assigneeMemberId: 'member-high',
        nodeId: 'task_high',
        status: TaskStatusEnum.PENDING,
      }),
    ]);
  });

  it('routes an exclusive gateway through the default edge when no condition matches', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processFormData: { amount: 500 },
      processWorkflowSnapshot: createExclusiveGatewayWorkflow(),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(fixture.savedTasks).toEqual([
      expect.objectContaining({
        assigneeMemberId: 'member-default',
        nodeId: 'task_default',
        status: TaskStatusEnum.PENDING,
      }),
    ]);
  });

  it('reports dry run edge labels, default routing, and entry condition results', (): void => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    const result = fixture.service.dryRunApprovalWorkflow({
      formDataJson: '{"amount":500}',
      initiatorMemberId: 'member-001',
      initiatorMetadataSnapshotJson: null,
      workflowDefinitionJson: JSON.stringify(createExclusiveGatewayWorkflow()),
    });

    expect(result.valid).toBe(true);
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          edgeDefault: true,
          edgeLabel: '其他情況',
          edgeMatched: true,
          edgeReason: '其他條件不符合時採用預設路徑。',
          nodeId: 'task_default',
          status: 'WAITING',
        }),
      ]),
    );
  });

  it('resubmits returned instances from the return point when configured', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      instanceState: ApprovalInstanceStateEnum.RETURNED,
      latestReturnActivity: createActivityLog({
        eventType: ActivityLogEventTypeEnum.INSTANCE_RETURNED,
        nodeId: 'task_finance',
        payload: {
          resubmitStrategy: 'FROM_RETURN_POINT',
          returnedFromNodeId: 'task_finance',
          returnToNodeId: 'start',
          taskId: 'task-1',
        },
      }),
      processWorkflowSnapshot: createLinearUserTaskWorkflow(),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.resubmitApprovalInstance({
      formDataJson: '{"amount":1200}',
      initiatorMemberId: 'member-001',
      instanceId: 'instance-1',
      title: null,
    });

    expect(fixture.savedWorkflowTokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currentNodeId: 'task_finance',
          status: WorkflowTokenStatusEnum.WAITING,
        }),
      ]),
    );
    expect(fixture.savedTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: 'task_finance',
          status: TaskStatusEnum.PENDING,
        }),
      ]),
    );
    expect(fixture.savedSingleActivityLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: ActivityLogEventTypeEnum.INSTANCE_RESUBMITTED,
          payload: { resubmitStrategy: 'FROM_RETURN_POINT' },
        }),
      ]),
    );
  });

  it('forks a token across multiple outgoing edges and creates parallel tasks', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createParallelApprovalWorkflow('AND'),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    expect(
      fixture.savedTasks.map((task) => ({
        assigneeMemberId: task.assigneeMemberId,
        nodeId: task.nodeId,
        status: task.status,
      })),
    ).toEqual([
      {
        assigneeMemberId: 'member-a',
        nodeId: 'task_a',
        status: TaskStatusEnum.PENDING,
      },
      {
        assigneeMemberId: 'member-b',
        nodeId: 'task_b',
        status: TaskStatusEnum.PENDING,
      },
    ]);
  });

  it('waits for every incoming branch before triggering an AND predecessor node', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createParallelApprovalWorkflow('AND'),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    const taskA = readTaskByNodeId(fixture.savedTasks, 'task_a');
    const taskB = readTaskByNodeId(fixture.savedTasks, 'task_b');

    await fixture.service.decideTask({
      action: TaskDecisionActionEnum.APPROVED,
      comment: null,
      decidedByMemberId: taskA.assigneeMemberId,
      taskId: taskA.id,
    });

    expect(
      fixture.savedTasks.some((task) => task.nodeId === 'task_final'),
    ).toBe(false);
    expect(
      fixture.savedWorkflowTokens.some(
        (token) =>
          token.currentNodeId === 'task_final' &&
          token.status === WorkflowTokenStatusEnum.WAITING,
      ),
    ).toBe(true);

    await fixture.service.decideTask({
      action: TaskDecisionActionEnum.APPROVED,
      comment: null,
      decidedByMemberId: taskB.assigneeMemberId,
      taskId: taskB.id,
    });

    expect(fixture.savedTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assigneeMemberId: 'member-final',
          nodeId: 'task_final',
          status: TaskStatusEnum.PENDING,
        }),
      ]),
    );
  });

  it('triggers an OR predecessor node from the first completed branch and cancels alternatives', async (): Promise<void> => {
    const fixture = createServiceFixture({
      currentVersionId: 'template-version-1',
      formVersionStatus: FormDefinitionVersionStatusEnum.PUBLISHED,
      processWorkflowSnapshot: createParallelApprovalWorkflow('OR'),
      templateVersionStatus: ApprovalTemplateVersionStatusEnum.PUBLISHED,
    });

    await fixture.service.processInstance('instance-1');

    const taskA = readTaskByNodeId(fixture.savedTasks, 'task_a');
    const taskB = readTaskByNodeId(fixture.savedTasks, 'task_b');

    await fixture.service.decideTask({
      action: TaskDecisionActionEnum.APPROVED,
      comment: null,
      decidedByMemberId: taskA.assigneeMemberId,
      taskId: taskA.id,
    });

    expect(fixture.savedTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assigneeMemberId: 'member-final',
          nodeId: 'task_final',
          status: TaskStatusEnum.PENDING,
        }),
        expect.objectContaining({
          id: taskB.id,
          nodeId: 'task_b',
          status: TaskStatusEnum.CANCELLED,
        }),
      ]),
    );
  });
});

interface ServiceFixture {
  readonly managerQuery: jest.Mock<
    Promise<unknown>,
    [string, readonly unknown[]]
  >;
  readonly rootTaskFind: jest.Mock<
    Promise<readonly TaskEntity[]>,
    [Readonly<Record<string, unknown>>]
  >;
  readonly savedDecision: TaskDecisionEntity | null;
  readonly savedActivityLogs: readonly ActivityLogEntity[];
  readonly savedInstance: ApprovalInstanceEntity | null;
  readonly savedProcessLog: ActivityLogEntity | null;
  readonly savedProcessToken: WorkflowTokenEntity | null;
  readonly savedSingleActivityLogs: readonly ActivityLogEntity[];
  readonly savedTasks: readonly TaskEntity[];
  readonly savedWorkflowTokens: readonly WorkflowTokenEntity[];
  readonly savedToken: WorkflowTokenEntity | null;
  readonly service: WorkflowEngineService;
}

function createServiceFixture({
  currentVersionId,
  decisionTask,
  decisionToken,
  formVersionStatus,
  instanceState,
  latestReturnActivity,
  processFormData,
  processWorkflowSnapshot,
  templateVersionStatus,
}: {
  readonly currentVersionId: string | null;
  readonly decisionTask?: TaskEntity;
  readonly decisionToken?: WorkflowTokenEntity;
  readonly formVersionStatus: FormDefinitionVersionStatusEnum;
  readonly instanceState?: ApprovalInstanceStateEnum;
  readonly latestReturnActivity?: ActivityLogEntity | null;
  readonly processFormData?: Readonly<Record<string, unknown>>;
  readonly processWorkflowSnapshot?: WorkflowDefinition;
  readonly templateVersionStatus: ApprovalTemplateVersionStatusEnum;
}): ServiceFixture {
  let savedToken: WorkflowTokenEntity | null = null;
  let tokenSequence = 1;
  let taskSequence = 1;
  let processTokens: readonly WorkflowTokenEntity[] = processWorkflowSnapshot
    ? [
        decisionToken ??
          createWorkflowToken({
            currentNodeId: 'start',
            status: WorkflowTokenStatusEnum.ACTIVE,
          }),
      ]
    : [];
  let processTasks: readonly TaskEntity[] = decisionTask ? [decisionTask] : [];
  let savedProcessToken: WorkflowTokenEntity | null = null;
  let savedDecision: TaskDecisionEntity | null = null;
  let savedInstance: ApprovalInstanceEntity | null = null;
  let savedProcessLog: ActivityLogEntity | null = null;
  let savedActivityLogs: readonly ActivityLogEntity[] = [];
  let savedSingleActivityLogs: readonly ActivityLogEntity[] = [];
  let savedTasks: readonly TaskEntity[] = [];
  const template = createTemplate(currentVersionId);
  const templateVersion = createTemplateVersion(templateVersionStatus);
  const formVersion = createFormVersion(formVersionStatus);
  const rootTaskFind = jest.fn<
    Promise<readonly TaskEntity[]>,
    [Readonly<Record<string, unknown>>]
  >(() => Promise.resolve([]));
  const instanceRepository = createRepository<ApprovalInstanceEntity>({
    findOne: jest.fn(() => Promise.resolve(createApprovalInstance())),
  });
  const tokenRepository = createRepository<WorkflowTokenEntity>({});
  const taskRepository = createRepository<TaskEntity>({
    find: rootTaskFind,
  });
  const taskDecisionRepository = createRepository<TaskDecisionEntity>({});
  const activityLogRepository = createRepository<ActivityLogEntity>({});
  const templateRepository = createRepository<ApprovalTemplateEntity>({
    findOne: jest.fn(() => Promise.resolve(template)),
  });
  const templateVersionRepository =
    createRepository<ApprovalTemplateVersionEntity>({
      findOne: jest.fn(() => Promise.resolve(templateVersion)),
    });
  const formVersionRepository = createRepository<FormDefinitionVersionEntity>({
    findOne: jest.fn(() => Promise.resolve(formVersion)),
  });
  const transactionalInstanceRepository =
    createRepository<ApprovalInstanceEntity>({
      create: jest.fn(
        (entity: Partial<ApprovalInstanceEntity>): ApprovalInstanceEntity =>
          Object.assign(createApprovalInstance(), entity),
      ),
      findOne: jest.fn(() =>
        Promise.resolve(
          createApprovalInstance({
            formData: processFormData,
            state: instanceState,
            workflowSnapshot: processWorkflowSnapshot,
          }),
        ),
      ),
      save: jest.fn((entity: ApprovalInstanceEntity) => {
        savedInstance = entity;

        return Promise.resolve(entity);
      }),
    });
  const transactionalTokenRepository = createRepository<WorkflowTokenEntity>({
    create: jest.fn(
      (entity: Partial<WorkflowTokenEntity>): WorkflowTokenEntity => ({
        consumedAt: null,
        createdAt: new Date('2026-05-04T09:00:00.000Z'),
        currentNodeId: entity.currentNodeId ?? 'start',
        id: entity.id ?? `token-${(tokenSequence += 1)}`,
        instanceId: entity.instanceId ?? 'instance-1',
        parentTokenId: entity.parentTokenId ?? null,
        status: entity.status ?? WorkflowTokenStatusEnum.ACTIVE,
      }),
    ),
    save: jest.fn(
      (
        entityOrEntities: WorkflowTokenEntity | WorkflowTokenEntity[],
      ): Promise<WorkflowTokenEntity | WorkflowTokenEntity[]> => {
        if (processWorkflowSnapshot) {
          const entities = Array.isArray(entityOrEntities)
            ? entityOrEntities
            : [entityOrEntities];
          const entitiesWithIds = entities.map((entity) => {
            const token = { ...entity };

            if (!token.id) {
              tokenSequence += 1;

              return { ...token, id: `token-${tokenSequence}` };
            }

            if (/^token-\d+$/u.test(token.id)) {
              const idNumber = Number(token.id.replace('token-', ''));

              tokenSequence = Math.max(tokenSequence, idNumber);
            }

            return token;
          });
          const entityIds = new Set(entitiesWithIds.map((entity) => entity.id));

          processTokens = [
            ...processTokens.filter((token) => !entityIds.has(token.id)),
            ...entitiesWithIds,
          ];
          savedProcessToken =
            entitiesWithIds[entitiesWithIds.length - 1] ?? null;

          return Promise.resolve(
            Array.isArray(entityOrEntities)
              ? entitiesWithIds
              : (entitiesWithIds[0] ?? entityOrEntities),
          );
        } else {
          savedToken = entityOrEntities as WorkflowTokenEntity;
        }

        return Promise.resolve(entityOrEntities);
      },
    ),
    find: jest.fn(() =>
      Promise.resolve([...processTokens].sort(compareTokenCreatedAt)),
    ),
    findOne: jest.fn(
      (
        options?: Readonly<{
          where?: Readonly<{ id?: string }>;
        }>,
      ) =>
        Promise.resolve(
          options?.where?.id
            ? (processTokens.find((token) => token.id === options.where?.id) ??
                null)
            : (processTokens
                .filter(
                  (token) => token.status === WorkflowTokenStatusEnum.ACTIVE,
                )
                .sort(compareTokenCreatedAt)[0] ?? null),
        ),
    ),
  });
  const transactionalTaskRepository = createRepository<TaskEntity>({
    create: jest.fn(
      (entity: Partial<TaskEntity>): TaskEntity =>
        Object.assign(new TaskEntity(), {
          assigneeMemberId: entity.assigneeMemberId ?? 'member-finance',
          completedAt: entity.completedAt ?? null,
          createdAt: new Date('2026-05-04T09:00:00.000Z'),
          delegationChain: entity.delegationChain ?? [],
          id: entity.id ?? `task-${(taskSequence += 1)}`,
          instanceId: entity.instanceId ?? 'instance-1',
          nodeId: entity.nodeId ?? 'task_finance',
          openedAt: entity.openedAt ?? null,
          originalAssigneeMemberId:
            entity.originalAssigneeMemberId ?? 'member-finance',
          slaDueAt: entity.slaDueAt ?? null,
          status: entity.status ?? TaskStatusEnum.PENDING,
          tokenId: entity.tokenId ?? 'token-1',
        }),
    ),
    find: jest.fn(() => Promise.resolve(processTasks)),
    findOne: jest.fn(
      (
        options?: Readonly<{
          where?: Readonly<{ id?: string; nodeId?: string; tokenId?: string }>;
        }>,
      ) =>
        Promise.resolve(
          options?.where?.id
            ? (processTasks.find((task) => task.id === options.where?.id) ??
                null)
            : options?.where?.tokenId
              ? (processTasks.find(
                  (task) =>
                    task.tokenId === options.where?.tokenId &&
                    (!options.where?.nodeId ||
                      task.nodeId === options.where.nodeId),
                ) ?? null)
              : null,
        ),
    ),
    save: jest.fn(
      (
        entityOrEntities: TaskEntity | TaskEntity[],
      ): Promise<TaskEntity | TaskEntity[]> => {
        const entities = Array.isArray(entityOrEntities)
          ? entityOrEntities
          : [entityOrEntities];
        const entitiesWithIds = entities.map((entity) => {
          const task = Object.assign(new TaskEntity(), entity);

          if (!task.id) {
            taskSequence += 1;

            return Object.assign(new TaskEntity(), task, {
              id: `task-${taskSequence}`,
            });
          }

          if (/^task-\d+$/u.test(task.id)) {
            const idNumber = Number(task.id.replace('task-', ''));

            taskSequence = Math.max(taskSequence, idNumber);
          }

          return task;
        });
        const entityIds = new Set(entitiesWithIds.map((entity) => entity.id));

        processTasks = [
          ...processTasks.filter((task) => !entityIds.has(task.id)),
          ...entitiesWithIds,
        ];
        savedTasks = [...savedTasks, ...entitiesWithIds];

        return Promise.resolve(
          Array.isArray(entityOrEntities)
            ? entitiesWithIds
            : (entitiesWithIds[0] ?? entityOrEntities),
        );
      },
    ),
  });
  const transactionalTaskDecisionRepository =
    createRepository<TaskDecisionEntity>({
      create: jest.fn(
        (entity: Partial<TaskDecisionEntity>): TaskDecisionEntity =>
          Object.assign(new TaskDecisionEntity(), {
            action: entity.action ?? TaskDecisionActionEnum.APPROVED,
            comment: entity.comment ?? null,
            decidedAt: entity.decidedAt ?? new Date('2026-05-04T09:00:00.000Z'),
            decidedByMemberId: entity.decidedByMemberId ?? 'member-finance',
            id: entity.id ?? 'decision-1',
            returnToNodeId: entity.returnToNodeId ?? null,
            signatureId: entity.signatureId ?? null,
            taskId: entity.taskId ?? 'task-1',
            transferToMemberId: entity.transferToMemberId ?? null,
          }),
      ),
      save: jest.fn((entity: TaskDecisionEntity) => {
        savedDecision = entity;

        return Promise.resolve(entity);
      }),
    });
  const transactionalActivityRepository = createRepository<ActivityLogEntity>({
    create: jest.fn(
      (entity: Partial<ActivityLogEntity>): ActivityLogEntity =>
        Object.assign(new ActivityLogEntity(), {
          actorMemberId: entity.actorMemberId ?? null,
          createdAt: new Date('2026-05-04T09:00:00.000Z'),
          eventType:
            entity.eventType ??
            ActivityLogEventTypeEnum.ENGINE_PROCESS_REQUESTED,
          id: entity.id ?? 'activity-log',
          instanceId: entity.instanceId ?? 'instance-1',
          nodeId: entity.nodeId ?? null,
          payload: entity.payload ?? {},
          taskId: entity.taskId ?? null,
        }),
    ),
    findOne: jest.fn(() => Promise.resolve(latestReturnActivity ?? null)),
    save: jest.fn(
      (
        entityOrEntities: ActivityLogEntity | ActivityLogEntity[],
      ): Promise<ActivityLogEntity | ActivityLogEntity[]> => {
        if (Array.isArray(entityOrEntities)) {
          savedActivityLogs = [...entityOrEntities];

          return Promise.resolve(entityOrEntities);
        }

        savedProcessLog = entityOrEntities;
        savedSingleActivityLogs = [
          ...savedSingleActivityLogs,
          entityOrEntities,
        ];

        return Promise.resolve(entityOrEntities);
      },
    ),
  });
  const managerQuery = jest.fn<Promise<unknown>, [string, readonly unknown[]]>(
    () => Promise.resolve([]),
  );
  const transactionManager = {
    getRepository: jest.fn((target: unknown): unknown => {
      if (target === ApprovalInstanceEntity) {
        return transactionalInstanceRepository;
      }

      if (target === WorkflowTokenEntity) {
        return transactionalTokenRepository;
      }

      if (target === ActivityLogEntity) {
        return transactionalActivityRepository;
      }

      if (target === TaskEntity) {
        return transactionalTaskRepository;
      }

      if (target === TaskDecisionEntity) {
        return transactionalTaskDecisionRepository;
      }

      return createRepository<unknown>({});
    }),
    query: managerQuery,
  };
  const transaction = jest.fn(
    <TResult>(
      callback: (manager: typeof transactionManager) => Promise<TResult>,
    ) => callback(transactionManager),
  );
  Object.assign(instanceRepository, {
    manager: {
      transaction,
    },
  });

  return {
    managerQuery,
    rootTaskFind,
    get savedDecision(): TaskDecisionEntity | null {
      return savedDecision;
    },
    get savedActivityLogs(): readonly ActivityLogEntity[] {
      return savedActivityLogs;
    },
    get savedInstance(): ApprovalInstanceEntity | null {
      return savedInstance;
    },
    get savedProcessLog(): ActivityLogEntity | null {
      return savedProcessLog;
    },
    get savedProcessToken(): WorkflowTokenEntity | null {
      return savedProcessToken;
    },
    get savedSingleActivityLogs(): readonly ActivityLogEntity[] {
      return savedSingleActivityLogs;
    },
    get savedTasks(): readonly TaskEntity[] {
      return savedTasks;
    },
    get savedWorkflowTokens(): readonly WorkflowTokenEntity[] {
      return processTokens;
    },
    get savedToken(): WorkflowTokenEntity | null {
      return savedToken;
    },
    service: new WorkflowEngineService(
      instanceRepository,
      tokenRepository,
      taskRepository,
      taskDecisionRepository,
      activityLogRepository,
      templateRepository,
      templateVersionRepository,
      formVersionRepository,
      new ConditionService(),
    ),
  };
}

function createRepository<TEntity>(
  value: Readonly<Record<string, unknown>>,
): jest.Mocked<Partial<import('typeorm').Repository<TEntity>>> &
  import('typeorm').Repository<TEntity> {
  return value as unknown as jest.Mocked<
    Partial<import('typeorm').Repository<TEntity>>
  > &
    import('typeorm').Repository<TEntity>;
}

function createTemplate(
  currentVersionId: string | null,
): ApprovalTemplateEntity {
  return {
    category: null,
    createdAt: new Date('2026-05-04T09:00:00.000Z'),
    createdByMemberId: null,
    currentVersionId,
    deletedAt: null,
    description: null,
    id: 'template-1',
    name: '費用申請',
    updatedAt: new Date('2026-05-04T09:00:00.000Z'),
  };
}

function createTemplateVersion(
  status: ApprovalTemplateVersionStatusEnum,
): ApprovalTemplateVersionEntity {
  return {
    archivedAt: null,
    createdAt: new Date('2026-05-04T09:00:00.000Z'),
    formDefinitionVersionId: 'form-version-1',
    id: 'template-version-1',
    initiatorPolicyCel: null,
    notificationConfig: null,
    notificationConfigJson: null,
    publishedAt: new Date('2026-05-04T09:00:00.000Z'),
    publishedByMemberId: null,
    slaDefaults: null,
    slaDefaultsJson: null,
    status,
    templateId: 'template-1',
    updatedAt: new Date('2026-05-04T09:00:00.000Z'),
    version: 1,
    workflowDefinition: {
      edges: [
        {
          data: {},
          id: 'edge_start_end',
          source: 'start',
          target: 'end',
          type: 'smoothstep',
        },
      ],
      meta: { schemaVersion: 1 },
      nodes: [
        {
          data: { label: '開始' },
          id: 'start',
          position: { x: 80, y: 160 },
          type: 'startEvent',
        },
        {
          data: { endState: 'APPROVED', label: '完成' },
          id: 'end',
          position: { x: 520, y: 160 },
          type: 'endEvent',
        },
      ],
    },
    workflowDefinitionJson: '',
  };
}

function createFormVersion(
  status: FormDefinitionVersionStatusEnum,
): FormDefinitionVersionEntity {
  return {
    archivedAt: null,
    createdAt: new Date('2026-05-04T09:00:00.000Z'),
    formDefinitionId: 'form-1',
    id: 'form-version-1',
    publishedAt: new Date('2026-05-04T09:00:00.000Z'),
    publishedByMemberId: null,
    schema: {
      fields: [],
      schemaVersion: 1,
    },
    schemaJson: '',
    status,
    uiSchema: {
      layout: [],
      schemaVersion: 1,
    },
    uiSchemaJson: '',
    updatedAt: new Date('2026-05-04T09:00:00.000Z'),
    version: 1,
  };
}

function createApprovalInstance({
  formData,
  state,
  workflowSnapshot,
}: {
  readonly formData?: Readonly<Record<string, unknown>>;
  readonly state?: ApprovalInstanceStateEnum;
  readonly workflowSnapshot?: WorkflowDefinition;
} = {}): ApprovalInstanceEntity {
  return Object.assign(new ApprovalInstanceEntity(), {
    completedAt: null,
    createdAt: new Date('2026-05-04T09:00:00.000Z'),
    formData: formData ?? {},
    formDefinitionSnapshot: {},
    id: 'instance-1',
    initiatorMemberId: 'member-001',
    initiatorMetadataSnapshot: {},
    startedAt: new Date('2026-05-04T09:00:00.000Z'),
    state: state ?? ApprovalInstanceStateEnum.RUNNING,
    templateId: 'template-1',
    templateVersionId: 'template-version-1',
    title: '費用申請',
    updatedAt: new Date('2026-05-04T09:00:00.000Z'),
    workflowSnapshot: workflowSnapshot ?? {
      edges: [],
      meta: { schemaVersion: 1 },
      nodes: [],
    },
  });
}

function createActivityLog(
  value: Partial<ActivityLogEntity>,
): ActivityLogEntity {
  return Object.assign(new ActivityLogEntity(), {
    actorMemberId: value.actorMemberId ?? null,
    createdAt: value.createdAt ?? new Date('2026-05-04T09:00:00.000Z'),
    eventType:
      value.eventType ?? ActivityLogEventTypeEnum.ENGINE_PROCESS_REQUESTED,
    id: value.id ?? 'activity-log',
    instanceId: value.instanceId ?? 'instance-1',
    nodeId: value.nodeId ?? null,
    payload: value.payload ?? {},
    taskId: value.taskId ?? null,
  });
}

function compareTokenCreatedAt(
  left: WorkflowTokenEntity,
  right: WorkflowTokenEntity,
): number {
  return left.createdAt.getTime() - right.createdAt.getTime();
}

function createWorkflowToken(
  value: Partial<WorkflowTokenEntity>,
): WorkflowTokenEntity {
  return {
    consumedAt: value.consumedAt ?? null,
    createdAt: value.createdAt ?? new Date('2026-05-04T09:00:00.000Z'),
    currentNodeId: value.currentNodeId ?? 'start',
    id: value.id ?? 'token-1',
    instanceId: value.instanceId ?? 'instance-1',
    parentTokenId: value.parentTokenId ?? null,
    status: value.status ?? WorkflowTokenStatusEnum.ACTIVE,
  };
}

function createTask(value: Partial<TaskEntity>): TaskEntity {
  return Object.assign(new TaskEntity(), {
    assigneeMemberId: value.assigneeMemberId ?? 'member-finance',
    completedAt: value.completedAt ?? null,
    createdAt: value.createdAt ?? new Date('2026-05-04T09:00:00.000Z'),
    delegationChain: value.delegationChain ?? [],
    id: value.id ?? 'task-1',
    instanceId: value.instanceId ?? 'instance-1',
    nodeId: value.nodeId ?? 'task_finance',
    openedAt: value.openedAt ?? null,
    originalAssigneeMemberId:
      value.originalAssigneeMemberId ?? 'member-finance',
    slaDueAt: value.slaDueAt ?? null,
    status: value.status ?? TaskStatusEnum.PENDING,
    tokenId: value.tokenId ?? 'token-1',
  });
}

function createLinearUserTaskWorkflow(): WorkflowDefinition {
  return {
    edges: [
      {
        data: {},
        id: 'edge_start_task',
        source: 'start',
        target: 'task_finance',
        type: 'smoothstep',
      },
      {
        data: {},
        id: 'edge_task_end',
        source: 'task_finance',
        target: 'end',
        type: 'smoothstep',
      },
    ],
    meta: { schemaVersion: 1 },
    nodes: [
      {
        data: { label: '開始' },
        id: 'start',
        position: { x: 80, y: 160 },
        type: 'startEvent',
      },
      {
        data: {
          allowAddSigner: false,
          allowReject: true,
          allowTransfer: false,
          approverResolver: {
            memberIds: ['member-finance'],
            type: 'DIRECT',
          },
          decisionPolicy: { type: 'SINGLE' },
          label: '財務簽核',
          returnBehavior: {
            allowReturn: false,
            allowedTargets: 'PREVIOUS',
          },
        },
        id: 'task_finance',
        position: { x: 300, y: 160 },
        type: 'userTask',
      },
      {
        data: { endState: 'APPROVED', label: '完成' },
        id: 'end',
        position: { x: 520, y: 160 },
        type: 'endEvent',
      },
    ],
  };
}

function createExclusiveGatewayWorkflow(): WorkflowDefinition {
  return {
    edges: [
      {
        data: {},
        id: 'edge_start_gateway',
        source: 'start',
        target: 'gateway_amount',
        type: 'smoothstep',
      },
      {
        data: {
          condition: 'form.amount > 1000',
          conditionFieldKey: 'amount',
          conditionOperator: 'GREATER_THAN',
          conditionValue: '1000',
          label: '金額大於 1000',
        },
        id: 'edge_gateway_high',
        source: 'gateway_amount',
        target: 'task_high',
        type: 'smoothstep',
      },
      {
        data: { isDefault: true, label: '其他情況' },
        id: 'edge_gateway_default',
        source: 'gateway_amount',
        target: 'task_default',
        type: 'smoothstep',
      },
      {
        data: {},
        id: 'edge_high_end',
        source: 'task_high',
        target: 'end',
        type: 'smoothstep',
      },
      {
        data: {},
        id: 'edge_default_end',
        source: 'task_default',
        target: 'end',
        type: 'smoothstep',
      },
    ],
    meta: { schemaVersion: 1 },
    nodes: [
      {
        data: { label: '開始' },
        id: 'start',
        position: { x: 80, y: 160 },
        type: 'startEvent',
      },
      {
        data: { direction: 'split', label: '金額分流', triggerMode: 'AND' },
        id: 'gateway_amount',
        position: { x: 260, y: 160 },
        type: 'exclusiveGateway',
      },
      createUserTaskNode('task_high', '高額簽核', 'member-high', 440, 80),
      createUserTaskNode(
        'task_default',
        '一般簽核',
        'member-default',
        440,
        240,
      ),
      {
        data: { endState: 'APPROVED', label: '完成' },
        id: 'end',
        position: { x: 660, y: 160 },
        type: 'endEvent',
      },
    ],
  };
}

function createParallelApprovalWorkflow(
  finalTriggerMode: 'AND' | 'OR',
): WorkflowDefinition {
  return {
    edges: [
      {
        data: {},
        id: 'edge_start_a',
        source: 'start',
        target: 'task_a',
        type: 'smoothstep',
      },
      {
        data: {},
        id: 'edge_start_b',
        source: 'start',
        target: 'task_b',
        type: 'smoothstep',
      },
      {
        data: {},
        id: 'edge_a_final',
        source: 'task_a',
        target: 'task_final',
        type: 'smoothstep',
      },
      {
        data: {},
        id: 'edge_b_final',
        source: 'task_b',
        target: 'task_final',
        type: 'smoothstep',
      },
      {
        data: {},
        id: 'edge_final_end',
        source: 'task_final',
        target: 'end',
        type: 'smoothstep',
      },
    ],
    meta: { schemaVersion: 1 },
    nodes: [
      {
        data: { label: '開始' },
        id: 'start',
        position: { x: 80, y: 160 },
        type: 'startEvent',
      },
      createUserTaskNode('task_a', 'A 簽核', 'member-a', 300, 80),
      createUserTaskNode('task_b', 'B 簽核', 'member-b', 300, 240),
      createUserTaskNode(
        'task_final',
        '彙整簽核',
        'member-final',
        520,
        160,
        finalTriggerMode,
      ),
      {
        data: { endState: 'APPROVED', label: '完成' },
        id: 'end',
        position: { x: 740, y: 160 },
        type: 'endEvent',
      },
    ],
  };
}

function createUserTaskNode(
  id: string,
  label: string,
  memberId: string,
  x: number,
  y: number,
  triggerMode: 'AND' | 'OR' = 'AND',
): WorkflowDefinition['nodes'][number] {
  return {
    data: {
      allowAddSigner: false,
      allowReject: true,
      allowTransfer: false,
      approverResolver: {
        memberIds: [memberId],
        type: 'DIRECT',
      },
      decisionPolicy: { type: 'SINGLE' },
      label,
      returnBehavior: {
        allowReturn: false,
        allowedTargets: 'PREVIOUS',
      },
      triggerMode,
    },
    id,
    position: { x, y },
    type: 'userTask',
  };
}

function readTaskByNodeId(
  tasks: readonly TaskEntity[],
  nodeId: string,
): TaskEntity {
  const task = tasks.find((candidate) => candidate.nodeId === nodeId);

  if (!task) {
    throw new Error(`Task for node ${nodeId} was not found`);
  }

  return task;
}
