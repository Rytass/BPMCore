import { validateSync } from 'class-validator';
import { WorkflowDefinition } from '@rytass/bpm-core-shared/workflow';
import { ModuleRef } from '@nestjs/core';
import { ObjectLiteral, Repository } from 'typeorm';
import { ActivityLogEntity } from '../workflow-engine/activity-log.entity';
import { ApprovalInstanceEntity } from '../workflow-engine/approval-instance.entity';
import { TaskCandidateEntity } from '../workflow-engine/task-candidate.entity';
import { TaskEntity } from '../workflow-engine/task.entity';
import {
  TaskCandidateStatusEnum,
  TaskStatusEnum,
} from '../workflow-engine/workflow-engine.enums';
import { UpdateNotificationPreferenceInput } from './dto/notification-preference.input';
import { NotificationPreferenceEntity } from './notification-preference.entity';
import { NotificationEntity } from './notification.entity';
import {
  NotificationChannelEnum,
  NotificationDigestModeEnum,
  NotificationStatusEnum,
  NotificationTypeEnum,
} from './notification.enums';
import { NotificationService } from './notification.service';
import { NotificationDeliveryService } from './notification-delivery.service';
import { DEFAULT_BPM_NOTIFICATION_OPTIONS } from './notification-options';

describe('NotificationService', () => {
  it('validates quiet hours as time-only values', (): void => {
    const input = Object.assign(new UpdateNotificationPreferenceInput(), {
      emailDigestMode: 'INSTANT',
      emailEnabled: true,
      inAppEnabled: true,
      memberId: 'member-001',
      quietHoursEnd: '25:00',
      quietHoursStart: '09:00Z',
    });

    expect(
      validateSync(input).flatMap((error) =>
        Object.values(error.constraints ?? {}),
      ),
    ).toEqual(
      expect.arrayContaining([
        'quietHoursStart must use HH:mm or HH:mm:ss format',
        'quietHoursEnd must use HH:mm or HH:mm:ss format',
      ]),
    );
  });

  it('applies pagination when listing notifications and counts matching records', async (): Promise<void> => {
    const notifications = Array.from({ length: 12 }, (_, index) =>
      createNotification(`notification-${index + 1}`),
    );
    const find = jest.fn(
      ({
        skip = 0,
        take = 10,
      }: {
        readonly skip?: number;
        readonly take?: number;
      }): Promise<readonly NotificationEntity[]> =>
        Promise.resolve(notifications.slice(skip, skip + take)),
    );
    const count = jest.fn(
      (): Promise<number> => Promise.resolve(notifications.length),
    );
    const service = new NotificationService(
      {
        count,
        find,
      } as unknown as Repository<NotificationEntity>,
      createRepository<NotificationPreferenceEntity>(),
      createRepository<TaskEntity>(),
      createRepository<TaskCandidateEntity>(),
      createRepository<ApprovalInstanceEntity>(),
      createRepository<ActivityLogEntity>(),
      createDeliveryService(),
      createModuleRef(),
    );

    const pageTwo = await service.listNotifications({
      includeRead: true,
      page: 2,
      pageSize: 5,
      recipientMemberId: 'member-001',
    });
    const totalCount = await service.countNotifications({
      includeRead: true,
      recipientMemberId: 'member-001',
    });

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 5, take: 5 }),
    );
    expect(pageTwo.map((notification) => notification.id)).toEqual([
      'notification-6',
      'notification-7',
      'notification-8',
      'notification-9',
      'notification-10',
    ]);
    expect(totalCount).toBe(12);
  });

  it('returns an entity instance with payloadJson after marking a notification as read', async (): Promise<void> => {
    const notification = createNotification('notification-001');
    notification.payload = null as unknown as Readonly<Record<string, unknown>>;
    const notificationRepository = createNotificationRepository(notification);
    const service = new NotificationService(
      notificationRepository,
      createRepository<NotificationPreferenceEntity>(),
      createRepository<TaskEntity>(),
      createRepository<TaskCandidateEntity>(),
      createRepository<ApprovalInstanceEntity>(),
      createRepository<ActivityLogEntity>(),
      createDeliveryService(),
      createModuleRef(),
    );

    const readNotification = await service.markNotificationRead({
      id: notification.id,
      readerMemberId: 'member-001',
    });

    expect(readNotification).toBeInstanceOf(NotificationEntity);
    expect(readNotification.payloadJson).toBe('{}');
    expect(readNotification.status).toBe(NotificationStatusEnum.READ);
  });

  it('uses configured defaults for missing notification preferences', async (): Promise<void> => {
    const service = new NotificationService(
      createRepository<NotificationEntity>(),
      {
        findOne: (): Promise<NotificationPreferenceEntity | null> =>
          Promise.resolve(null),
      } as unknown as Repository<NotificationPreferenceEntity>,
      createRepository<TaskEntity>(),
      createRepository<TaskCandidateEntity>(),
      createRepository<ApprovalInstanceEntity>(),
      createRepository<ActivityLogEntity>(),
      createDeliveryService(),
      createModuleRef(),
      {
        ...DEFAULT_BPM_NOTIFICATION_OPTIONS,
        defaultEmailDigestMode: NotificationDigestModeEnum.DAILY,
        defaultEmailPreferenceEnabled: false,
        defaultInAppPreferenceEnabled: false,
      },
    );

    await expect(service.getPreference('member-001')).resolves.toMatchObject({
      emailDigestMode: NotificationDigestModeEnum.DAILY,
      emailEnabled: false,
      inAppEnabled: false,
      memberId: 'member-001',
    });
  });

  it('creates SLA notifications for candidate group task members', async (): Promise<void> => {
    const savedNotifications: NotificationEntity[] = [];
    const notificationRepository = {
      create: (entity: Partial<NotificationEntity>): NotificationEntity =>
        Object.assign(new NotificationEntity(), entity),
      findOne: (): Promise<NotificationEntity | null> =>
        Promise.resolve(null),
      save: (
        entityOrEntities: NotificationEntity | NotificationEntity[],
      ): Promise<NotificationEntity | NotificationEntity[]> => {
        const entities = Array.isArray(entityOrEntities)
          ? entityOrEntities
          : [entityOrEntities];

        savedNotifications.push(...entities);

        return Promise.resolve(entityOrEntities);
      },
    } as unknown as Repository<NotificationEntity>;
    const task = Object.assign(new TaskEntity(), {
      assigneeMemberId: null,
      createdAt: new Date('2026-05-10T08:00:00.000Z'),
      id: 'f4fae7b0-eab0-40de-8dfa-7dfbff746980',
      instanceId: 'd6f61a56-8b12-4ab8-9424-a2f7c27874e2',
      nodeId: 'task_review',
      slaDueAt: new Date('2026-05-10T09:00:00.000Z'),
      status: TaskStatusEnum.PENDING,
    });
    const service = new NotificationService(
      notificationRepository,
      {
        findOne: (): Promise<NotificationPreferenceEntity | null> =>
          Promise.resolve(null),
      } as unknown as Repository<NotificationPreferenceEntity>,
      {
        find: (): Promise<readonly TaskEntity[]> => Promise.resolve([task]),
      } as unknown as Repository<TaskEntity>,
      {
        find: (): Promise<readonly TaskCandidateEntity[]> =>
          Promise.resolve([
            createTaskCandidate('candidate-1', 'member-a'),
            createTaskCandidate('candidate-2', 'member-b'),
            createTaskCandidate(
              'candidate-3',
              'member-cancelled',
              TaskCandidateStatusEnum.CANCELLED,
            ),
          ]),
      } as unknown as Repository<TaskCandidateEntity>,
      {
        findOne: (): Promise<ApprovalInstanceEntity> =>
          Promise.resolve(createApprovalInstance()),
      } as unknown as Repository<ApprovalInstanceEntity>,
      {
        create: (entity: Partial<ActivityLogEntity>): ActivityLogEntity =>
          Object.assign(new ActivityLogEntity(), entity),
        save: (entity: ActivityLogEntity): Promise<ActivityLogEntity> =>
          Promise.resolve(entity),
      } as unknown as Repository<ActivityLogEntity>,
      createDeliveryService(),
      createModuleRef(),
    );

    await expect(
      service.runSlaScan(new Date('2026-05-10T09:01:00.000Z')),
    ).resolves.toEqual({ overdueCount: 1, warningCount: 0 });
    expect(savedNotifications.map((notification) => notification.recipientMemberId)).toEqual([
      'member-a',
      'member-b',
    ]);
    expect(savedNotifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({ recipientMemberId: 'member-a' }),
          type: NotificationTypeEnum.SLA_OVERDUE,
        }),
        expect.objectContaining({
          payload: expect.objectContaining({ recipientMemberId: 'member-b' }),
          type: NotificationTypeEnum.SLA_OVERDUE,
        }),
      ]),
    );
  });
});

function createNotification(id: string): NotificationEntity {
  return Object.assign(new NotificationEntity(), {
    body: '待簽通知',
    channel: NotificationChannelEnum.IN_APP,
    createdAt: new Date('2026-05-10T00:00:00.000Z'),
    attemptCount: 0,
    deliveredAt: new Date('2026-05-10T00:00:00.000Z'),
    deliveryError: null,
    deliveryTarget: null,
    id,
    instanceId: 'd6f61a56-8b12-4ab8-9424-a2f7c27874e2',
    lastAttemptAt: null,
    nextRetryAt: null,
    payload: {},
    readAt: null,
    recipientMemberId: 'member-001',
    sentAt: new Date('2026-05-10T00:00:00.000Z'),
    status: NotificationStatusEnum.SENT,
    taskId: 'f4fae7b0-eab0-40de-8dfa-7dfbff746980',
    title: '新的待簽任務',
    type: NotificationTypeEnum.TASK_ASSIGNED,
  });
}

function createTaskCandidate(
  id: string,
  memberId: string,
  status: TaskCandidateStatusEnum = TaskCandidateStatusEnum.PENDING,
): TaskCandidateEntity {
  return Object.assign(new TaskCandidateEntity(), {
    createdAt: new Date('2026-05-10T08:00:00.000Z'),
    id,
    memberId,
    status,
    taskId: 'f4fae7b0-eab0-40de-8dfa-7dfbff746980',
  });
}

function createApprovalInstance(): ApprovalInstanceEntity {
  return Object.assign(new ApprovalInstanceEntity(), {
    id: 'd6f61a56-8b12-4ab8-9424-a2f7c27874e2',
    title: '採購申請',
    workflowSnapshot: createSlaWorkflow(),
  });
}

function createSlaWorkflow(): WorkflowDefinition {
  return {
    edges: [],
    meta: { schemaVersion: 1 },
    nodes: [
      {
        data: {
          allowAddSigner: false,
          allowReject: true,
          allowTransfer: false,
          approverResolver: {
            memberIds: ['member-a', 'member-b'],
            type: 'DIRECT',
          },
          decisionPolicy: { type: 'SINGLE' },
          label: '候選簽核',
          returnBehavior: {
            allowReturn: false,
            allowedTargets: 'PREVIOUS',
          },
          sla: {
            duration: 'PT1H',
            onTimeout: 'REMIND',
            warningAt: 0.5,
          },
        },
        id: 'task_review',
        position: { x: 100, y: 100 },
        type: 'userTask',
      },
    ],
  };
}

function createDeliveryService(): NotificationDeliveryService {
  return {
    deliverNotification: (): Promise<boolean> => Promise.resolve(true),
  } as unknown as NotificationDeliveryService;
}

function createModuleRef(): ModuleRef {
  return {
    get: (): never => {
      throw new Error('Unexpected ModuleRef lookup');
    },
  } as unknown as ModuleRef;
}

function createNotificationRepository(
  notification: NotificationEntity,
): Repository<NotificationEntity> {
  const repository = {
    create: (entity: Partial<NotificationEntity>): NotificationEntity =>
      Object.assign(new NotificationEntity(), entity),
    findOne: (): Promise<NotificationEntity> => Promise.resolve(notification),
    save: (entity: NotificationEntity): Promise<NotificationEntity> =>
      Promise.resolve(entity),
  };

  return repository as unknown as Repository<NotificationEntity>;
}

function createRepository<
  TEntity extends ObjectLiteral,
>(): Repository<TEntity> {
  return {} as Repository<TEntity>;
}
