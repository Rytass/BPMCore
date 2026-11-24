import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { EntityManager, FindOperator } from 'typeorm';
import { SIGNER_RECALL_ERROR_CODES } from '@rytass/bpm-core-shared/status';
import type { WorkflowDefinition } from '@rytass/bpm-core-shared/workflow';
import { ActivityLogEntity } from './activity-log.entity';
import { AdhocDirectiveEntity } from './adhoc-directive.entity';
import { ApprovalInstanceEntity } from './approval-instance.entity';
import {
  planSignerRecall,
  type SignerRecallPlanResult,
} from './signer-recall-planner';
import { TaskCandidateEntity } from './task-candidate.entity';
import { TaskDecisionEntity } from './task-decision.entity';
import { TaskEntity } from './task.entity';
import { WorkflowTokenEntity } from './workflow-token.entity';
import {
  ActivityLogEventTypeEnum,
  ApprovalInstanceStateEnum,
  TaskAssignmentTypeEnum,
  TaskCandidateStatusEnum,
  TaskDecisionActionEnum,
  TaskStatusEnum,
  WorkflowTokenStatusEnum,
} from './workflow-engine.enums';
import {
  ADMIN_REASSIGN_DELEGATION_REASON,
  MANUAL_TRANSFER_DELEGATION_REASON,
} from './workflow-engine.service';

/*
 * Rows are seeded, not produced by the engine, so the states here are the
 * ones only a seed can reach (a decision with no `decisionId`, a task already
 * taken back). What the engine itself writes is covered through the real
 * service in `workflow-engine.service.spec.ts`.
 */

const INSTANCE_ID = 'instance-1';
const SIGNER = 'member-finance';
const STAGE_NODE = 'task_finance';
const NEXT_NODE = 'task_next';
const TOKEN_ID = 'token-1';
const STAGE_TASK_ID = 'task-x';
const NEXT_TASK_ID = 'task-n';
const DECISION_ID = 'decision-1';
const DECIDED_AT = new Date('2026-11-20T10:00:00.000Z');

interface PlannerSeed {
  readonly activityLogs: readonly ActivityLogEntity[];
  readonly candidates: readonly TaskCandidateEntity[];
  readonly decisions: readonly TaskDecisionEntity[];
  readonly directives: readonly AdhocDirectiveEntity[];
  readonly instance: ApprovalInstanceEntity;
  readonly tasks: readonly TaskEntity[];
  readonly tokens: readonly WorkflowTokenEntity[];
}

/**
 * An in-memory `EntityManager` for the planner. `find` and `findOne` take a
 * `where` of equality, `In` and `IsNull` and nothing else: any other
 * operator, and any other option such as `order`, throws, so the planner's
 * "equality only, sort in JavaScript" rule is enforced here instead of being
 * ignored the way the service spec's double ignores it.
 */
const createPlannerManager = (seed: PlannerSeed): EntityManager => {
  const matches = (
    row: object,
    where?: Readonly<Record<string, unknown>>,
  ): boolean =>
    Object.entries(where ?? {}).every(([key, expected]): boolean => {
      const actual = (row as Readonly<Record<string, unknown>>)[key];

      if (expected instanceof FindOperator) {
        if (expected.type === 'in') {
          return (expected.value as readonly unknown[]).includes(actual);
        }

        if (expected.type === 'isNull') {
          return actual === null || actual === undefined;
        }

        throw new Error(
          `planner manager: unsupported operator ${expected.type}`,
        );
      }

      return actual === expected;
    });

  const createRepository = <TRow extends object>(
    rows: readonly TRow[],
  ): {
    readonly find: (options?: {
      readonly where?: Readonly<Record<string, unknown>>;
    }) => Promise<readonly TRow[]>;
    readonly findOne: (options?: {
      readonly where?: Readonly<Record<string, unknown>>;
    }) => Promise<TRow | null>;
  } => {
    const readWhere = (
      options: object | undefined,
    ): Readonly<Record<string, unknown>> | undefined => {
      const unsupported = Object.keys(options ?? {}).filter(
        (key): boolean => key !== 'where',
      );

      if (unsupported.length > 0) {
        throw new Error(
          `planner manager: unsupported option ${unsupported[0]}`,
        );
      }

      return (
        options as { where?: Readonly<Record<string, unknown>> } | undefined
      )?.where;
    };

    return {
      find: (options): Promise<readonly TRow[]> =>
        Promise.resolve(
          rows.filter((row): boolean => matches(row, readWhere(options))),
        ),
      findOne: (options): Promise<TRow | null> =>
        Promise.resolve(
          rows.find((row): boolean => matches(row, readWhere(options))) ?? null,
        ),
    };
  };

  const repositories = new Map<unknown, unknown>([
    [ActivityLogEntity, createRepository(seed.activityLogs)],
    [AdhocDirectiveEntity, createRepository(seed.directives)],
    [ApprovalInstanceEntity, createRepository([seed.instance])],
    [TaskCandidateEntity, createRepository(seed.candidates)],
    [TaskDecisionEntity, createRepository(seed.decisions)],
    [TaskEntity, createRepository(seed.tasks)],
    [WorkflowTokenEntity, createRepository(seed.tokens)],
  ]);

  return {
    getRepository: (target: unknown): unknown => {
      if (!repositories.has(target)) {
        throw new Error('planner manager: unexpected repository');
      }

      return repositories.get(target);
    },
  } as unknown as EntityManager;
};

const SERVICE_NODE = 'webhook_erp';

/**
 * start -> M -> N -> end; with `withServiceTask`, a serviceTask sits between
 * M and N (start -> M -> service -> N -> end).
 */
const createWorkflow = (
  options: { readonly withServiceTask?: boolean } = {},
): WorkflowDefinition => {
  const node = (id: string, type: string): unknown => ({
    data: { label: id },
    id,
    position: { x: 0, y: 0 },
    type,
  });
  const edge = (id: string, source: string, target: string): unknown => ({
    data: {},
    id,
    source,
    target,
  });

  return {
    edges: options.withServiceTask
      ? [
          edge('e1', 'start', STAGE_NODE),
          edge('e2a', STAGE_NODE, SERVICE_NODE),
          edge('e2b', SERVICE_NODE, NEXT_NODE),
          edge('e3', NEXT_NODE, 'end'),
        ]
      : [
          edge('e1', 'start', STAGE_NODE),
          edge('e2', STAGE_NODE, NEXT_NODE),
          edge('e3', NEXT_NODE, 'end'),
        ],
    meta: { schemaVersion: 1 },
    nodes: [
      node('start', 'startEvent'),
      node(STAGE_NODE, 'userTask'),
      ...(options.withServiceTask ? [node(SERVICE_NODE, 'serviceTask')] : []),
      node(NEXT_NODE, 'userTask'),
      node('end', 'endEvent'),
    ],
  } as unknown as WorkflowDefinition;
};

const createTask = (
  fields: Partial<TaskEntity> & Pick<TaskEntity, 'id'>,
): TaskEntity =>
  Object.assign(new TaskEntity(), {
    adhocDirectiveId: null,
    adhocOriginTaskId: null,
    adhocType: null,
    assigneeMemberId: SIGNER,
    assignmentType: TaskAssignmentTypeEnum.DIRECT_MEMBER,
    completedAt: null,
    createdAt: new Date('2026-11-20T09:00:00.000Z'),
    decisionPolicySnapshot: { type: 'SINGLE' },
    delegationChain: [],
    instanceId: INSTANCE_ID,
    isAdhoc: false,
    nodeId: STAGE_NODE,
    openedAt: null,
    originalAssigneeMemberId: null,
    slaDueAt: null,
    slaStartedAt: null,
    status: TaskStatusEnum.COMPLETED,
    tokenId: TOKEN_ID,
    ...fields,
  });

const createToken = (
  fields: Partial<WorkflowTokenEntity> & Pick<WorkflowTokenEntity, 'id'>,
): WorkflowTokenEntity =>
  Object.assign(new WorkflowTokenEntity(), {
    consumedAt: null,
    createdAt: new Date('2026-11-20T09:00:00.000Z'),
    currentNodeId: NEXT_NODE,
    instanceId: INSTANCE_ID,
    parentTokenId: null,
    status: WorkflowTokenStatusEnum.WAITING,
    ...fields,
  });

const createLog = (
  seq: number,
  fields: Partial<ActivityLogEntity> & Pick<ActivityLogEntity, 'eventType'>,
): ActivityLogEntity =>
  Object.assign(new ActivityLogEntity(), {
    actorMemberId: null,
    createdAt: new Date('2026-11-20T10:00:00.000Z'),
    instanceId: INSTANCE_ID,
    nodeId: null,
    payload: {},
    seq: String(seq),
    taskId: null,
    ...fields,
  });

/**
 * The state right after the signer's approval: M done, the token waiting on
 * N, N's task open and untouched, nothing logged but the movement.
 */
const seedBaselineApprovedState = (): PlannerSeed => ({
  activityLogs: [
    createLog(10, {
      actorMemberId: SIGNER,
      eventType: ActivityLogEventTypeEnum.TASK_DECIDED,
      nodeId: STAGE_NODE,
      payload: { action: 'APPROVED', decisionId: DECISION_ID },
      taskId: STAGE_TASK_ID,
    }),
    createLog(11, {
      eventType: ActivityLogEventTypeEnum.TOKEN_ADVANCED,
      nodeId: NEXT_NODE,
      payload: {
        edgeId: 'e2',
        fromNodeId: STAGE_NODE,
        toNodeId: NEXT_NODE,
        tokenId: TOKEN_ID,
      },
    }),
    createLog(12, {
      eventType: ActivityLogEventTypeEnum.TASK_CREATED,
      nodeId: NEXT_NODE,
      taskId: NEXT_TASK_ID,
    }),
  ],
  candidates: [
    Object.assign(new TaskCandidateEntity(), {
      claimedAt: null,
      createdAt: new Date('2026-11-20T09:00:00.000Z'),
      decidedAt: DECIDED_AT,
      delegationChain: [],
      id: 'candidate-x',
      memberId: SIGNER,
      originalMemberId: SIGNER,
      sequence: null,
      sourceType: 'DIRECT',
      status: TaskCandidateStatusEnum.COMPLETED,
      taskId: STAGE_TASK_ID,
    }),
  ],
  decisions: [
    Object.assign(new TaskDecisionEntity(), {
      action: TaskDecisionActionEnum.APPROVED,
      comment: null,
      decidedAt: DECIDED_AT,
      decidedByMemberId: SIGNER,
      id: DECISION_ID,
      returnToNodeId: null,
      signatureId: null,
      taskId: STAGE_TASK_ID,
      transferToMemberId: null,
    }),
  ],
  directives: [],
  instance: Object.assign(new ApprovalInstanceEntity(), {
    id: INSTANCE_ID,
    state: ApprovalInstanceStateEnum.RUNNING,
    workflowSnapshot: createWorkflow(),
  }),
  tasks: [
    createTask({ id: STAGE_TASK_ID }),
    createTask({
      assigneeMemberId: 'member-next',
      id: NEXT_TASK_ID,
      nodeId: NEXT_NODE,
      status: TaskStatusEnum.PENDING,
    }),
  ],
  tokens: [createToken({ id: TOKEN_ID })],
});

/**
 * The baseline, but the token walked through a serviceTask between M and N.
 * What the engine writes there is only movement: a WEBHOOK result is written
 * after the commit, so at the moment of a recall there is no execution record
 * (with `skipped`, the node was skipped and never had one).
 */
const seedServiceTaskOnPathState = (options: {
  readonly skipped: boolean;
}): PlannerSeed => {
  const baseline = seedBaselineApprovedState();
  const movement = (
    seq: number,
    fromNodeId: string,
    toNodeId: string,
  ): ActivityLogEntity =>
    createLog(seq, {
      eventType: ActivityLogEventTypeEnum.TOKEN_ADVANCED,
      nodeId: toNodeId,
      payload: { fromNodeId, toNodeId, tokenId: TOKEN_ID },
    });

  return {
    ...baseline,
    activityLogs: [
      ...baseline.activityLogs.filter(
        (log): boolean =>
          log.eventType === ActivityLogEventTypeEnum.TASK_DECIDED,
      ),
      movement(11, STAGE_NODE, SERVICE_NODE),
      ...(options.skipped
        ? [
            createLog(12, {
              eventType: ActivityLogEventTypeEnum.TOKEN_ADVANCED,
              nodeId: SERVICE_NODE,
              payload: { skippedByEntryCondition: true, tokenId: TOKEN_ID },
            }),
          ]
        : []),
      movement(13, SERVICE_NODE, NEXT_NODE),
      createLog(14, {
        eventType: ActivityLogEventTypeEnum.TASK_CREATED,
        nodeId: NEXT_NODE,
        taskId: NEXT_TASK_ID,
      }),
    ],
    instance: Object.assign(new ApprovalInstanceEntity(), {
      id: INSTANCE_ID,
      state: ApprovalInstanceStateEnum.RUNNING,
      workflowSnapshot: createWorkflow({ withServiceTask: true }),
    }),
  };
};

describe('signer recall planner', (): void => {
  const plan = (
    seed: PlannerSeed,
    overrides: { readonly enabled?: boolean; readonly taskId?: string } = {},
  ): Promise<SignerRecallPlanResult> =>
    planSignerRecall(createPlannerManager(seed), {
      adminReassignReason: ADMIN_REASSIGN_DELEGATION_REASON,
      enabled: overrides.enabled ?? true,
      manualTransferReason: MANUAL_TRANSFER_DELEGATION_REASON,
      memberId: SIGNER,
      taskId: overrides.taskId ?? STAGE_TASK_ID,
    });

  it('allows the baseline: the signer approved and the next stage is untouched', async (): Promise<void> => {
    const result = await plan(seedBaselineApprovedState());

    expect(result).toMatchObject({
      plan: {
        cancelledTaskIds: [NEXT_TASK_ID],
        nextNodeId: NEXT_NODE,
        startSeq: BigInt(10),
      },
    });
    expect(result).toHaveProperty('plan.task.id', STAGE_TASK_ID);
    expect(result).toHaveProperty('plan.decision.id', DECISION_ID);
    expect(result).toHaveProperty('plan.token.id', TOKEN_ID);
    expect(result).toHaveProperty('plan.seat.id', 'candidate-x');
  });

  it('refuses with DISABLED when the host has not turned the feature on', async (): Promise<void> => {
    await expect(
      plan(seedBaselineApprovedState(), { enabled: false }),
    ).resolves.toEqual({ refusalCode: SIGNER_RECALL_ERROR_CODES.DISABLED });
  });

  it('refuses a decision whose record has no decisionId: that is no proof of a personal approval', async (): Promise<void> => {
    const baseline = seedBaselineApprovedState();
    const seed: PlannerSeed = {
      ...baseline,
      activityLogs: baseline.activityLogs.map((log): ActivityLogEntity =>
        log.eventType === ActivityLogEventTypeEnum.TASK_DECIDED
          ? createLog(Number(log.seq), {
              actorMemberId: SIGNER,
              eventType: ActivityLogEventTypeEnum.TASK_DECIDED,
              nodeId: STAGE_NODE,
              payload: { action: 'APPROVED' },
              taskId: STAGE_TASK_ID,
            })
          : log,
      ),
    };

    await expect(plan(seed)).resolves.toEqual({
      refusalCode: SIGNER_RECALL_ERROR_CODES.NOT_A_PERSONAL_APPROVAL,
    });
  });

  it('says ALREADY_RECALLED for a task whose approval was taken back, though every later check fails too', async (): Promise<void> => {
    const baseline = seedBaselineApprovedState();
    // The state a recall leaves: T consumed, N's task cancelled, a new token
    // back on M holding a new task for the signer.
    const seed: PlannerSeed = {
      ...baseline,
      activityLogs: [
        ...baseline.activityLogs,
        createLog(13, {
          actorMemberId: SIGNER,
          eventType: ActivityLogEventTypeEnum.TASK_RECALLED,
          nodeId: STAGE_NODE,
          payload: { decisionId: DECISION_ID, recalledTaskId: STAGE_TASK_ID },
          taskId: STAGE_TASK_ID,
        }),
        createLog(14, {
          eventType: ActivityLogEventTypeEnum.TOKEN_CREATED,
          nodeId: STAGE_NODE,
        }),
        createLog(15, {
          actorMemberId: SIGNER,
          eventType: ActivityLogEventTypeEnum.TASK_CREATED,
          nodeId: STAGE_NODE,
          taskId: 'task-x2',
        }),
      ],
      tasks: [
        createTask({ id: STAGE_TASK_ID }),
        createTask({
          assigneeMemberId: 'member-next',
          id: NEXT_TASK_ID,
          nodeId: NEXT_NODE,
          status: TaskStatusEnum.CANCELLED,
        }),
        createTask({
          id: 'task-x2',
          status: TaskStatusEnum.PENDING,
          tokenId: 'token-2',
        }),
      ],
      tokens: [
        createToken({
          consumedAt: new Date('2026-11-20T11:00:00.000Z'),
          id: TOKEN_ID,
          status: WorkflowTokenStatusEnum.CONSUMED,
        }),
        createToken({
          currentNodeId: STAGE_NODE,
          id: 'token-2',
          status: WorkflowTokenStatusEnum.WAITING,
        }),
      ],
    };

    await expect(plan(seed)).resolves.toEqual({
      refusalCode: SIGNER_RECALL_ERROR_CODES.ALREADY_RECALLED,
    });
  });

  it('throws NotFoundException for an unknown task, not a refusal code', async (): Promise<void> => {
    await expect(
      plan(seedBaselineApprovedState(), { taskId: 'task-missing' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('a service task on the path between the two stages', (): void => {
    const cases: ReadonlyArray<readonly [string, boolean]> = [
      [
        'the token passed a WEBHOOK node whose result is not written yet',
        false,
      ],
      ['the token skipped a service node that left no execution record', true],
    ];

    it.each(cases)('%s', async (_name, skipped): Promise<void> => {
      const seed = seedServiceTaskOnPathState({ skipped });

      // Nothing but movement is on record after D, so R6 lets it through and
      // only the node the token walked through can be what refuses.
      expect(
        seed.activityLogs.some(
          (log) =>
            log.eventType === ActivityLogEventTypeEnum.SERVICE_TASK_EXECUTED,
        ),
      ).toBe(false);

      await expect(plan(seed)).resolves.toEqual({
        refusalCode: SIGNER_RECALL_ERROR_CODES.PASSED_SERVICE_TASK,
      });
    });
  });
});
