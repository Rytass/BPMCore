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
});

interface ServiceFixture {
  readonly managerQuery: jest.Mock<
    Promise<unknown>,
    [string, readonly unknown[]]
  >;
  readonly savedActivityLogs: readonly ActivityLogEntity[];
  readonly savedProcessLog: ActivityLogEntity | null;
  readonly savedToken: WorkflowTokenEntity | null;
  readonly service: WorkflowEngineService;
}

function createServiceFixture({
  currentVersionId,
  formVersionStatus,
  templateVersionStatus,
}: {
  readonly currentVersionId: string | null;
  readonly formVersionStatus: FormDefinitionVersionStatusEnum;
  readonly templateVersionStatus: ApprovalTemplateVersionStatusEnum;
}): ServiceFixture {
  let savedToken: WorkflowTokenEntity | null = null;
  let savedProcessLog: ActivityLogEntity | null = null;
  let savedActivityLogs: readonly ActivityLogEntity[] = [];
  const template = createTemplate(currentVersionId);
  const templateVersion = createTemplateVersion(templateVersionStatus);
  const formVersion = createFormVersion(formVersionStatus);
  const instanceRepository = createRepository<ApprovalInstanceEntity>({
    findOne: jest.fn(() => Promise.resolve(createApprovalInstance())),
  });
  const tokenRepository = createRepository<WorkflowTokenEntity>({});
  const taskRepository = createRepository<TaskEntity>({});
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
      findOne: jest.fn(() => Promise.resolve(createApprovalInstance())),
      save: jest.fn((entity: ApprovalInstanceEntity) =>
        Promise.resolve(entity),
      ),
    });
  const transactionalTokenRepository = createRepository<WorkflowTokenEntity>({
    create: jest.fn(
      (entity: Partial<WorkflowTokenEntity>): WorkflowTokenEntity => ({
        consumedAt: null,
        createdAt: new Date('2026-05-04T09:00:00.000Z'),
        currentNodeId: entity.currentNodeId ?? 'start',
        id: 'token-1',
        instanceId: entity.instanceId ?? 'instance-1',
        parentTokenId: entity.parentTokenId ?? null,
        status: entity.status ?? WorkflowTokenStatusEnum.ACTIVE,
      }),
    ),
    save: jest.fn((entity: WorkflowTokenEntity) => {
      savedToken = entity;

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
    save: jest.fn(
      (
        entityOrEntities: ActivityLogEntity | ActivityLogEntity[],
      ): Promise<ActivityLogEntity | ActivityLogEntity[]> => {
        if (Array.isArray(entityOrEntities)) {
          savedActivityLogs = [...entityOrEntities];

          return Promise.resolve(entityOrEntities);
        }

        savedProcessLog = entityOrEntities;

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
    get savedActivityLogs(): readonly ActivityLogEntity[] {
      return savedActivityLogs;
    },
    get savedProcessLog(): ActivityLogEntity | null {
      return savedProcessLog;
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

function createApprovalInstance(): ApprovalInstanceEntity {
  return Object.assign(new ApprovalInstanceEntity(), {
    completedAt: null,
    createdAt: new Date('2026-05-04T09:00:00.000Z'),
    formData: {},
    formDefinitionSnapshot: {},
    id: 'instance-1',
    initiatorMemberId: 'member-001',
    initiatorMetadataSnapshot: {},
    startedAt: new Date('2026-05-04T09:00:00.000Z'),
    state: ApprovalInstanceStateEnum.RUNNING,
    templateId: 'template-1',
    templateVersionId: 'template-version-1',
    title: '費用申請',
    updatedAt: new Date('2026-05-04T09:00:00.000Z'),
    workflowSnapshot: {
      edges: [],
      meta: { schemaVersion: 1 },
      nodes: [],
    },
  });
}
