import { validateSync } from 'class-validator';
import {
  SlaConfig,
  UserTaskNode,
  WorkflowDefinition,
} from '@rytass/bpm-core-shared/workflow';
import { ModuleRef } from '@nestjs/core';
import {
  EntityManager,
  In,
  IsNull,
  Not,
  ObjectLiteral,
  Repository,
} from 'typeorm';
import {
  BPM_BUSINESS_CALENDAR,
  BPMBusinessCalendar,
} from '../calendar/business-calendar.token';
import { ActivityLogEntity } from '../workflow-engine/activity-log.entity';
import { ApprovalInstanceEntity } from '../workflow-engine/approval-instance.entity';
import { TaskCandidateEntity } from '../workflow-engine/task-candidate.entity';
import { TaskEntity } from '../workflow-engine/task.entity';
import {
  TaskCandidateStatusEnum,
  TaskDecisionActionEnum,
  TaskStatusEnum,
} from '../workflow-engine/workflow-engine.enums';
import { OrganizationService } from '../organization/organization.service';
import { UpdateNotificationPreferenceInput } from './dto/notification-preference.input';
import { NotificationPreferenceEntity } from './notification-preference.entity';
import { NotificationEntity } from './notification.entity';
import {
  BPMNotificationObserver,
  BPMNotificationsCreatedEvent,
  BPM_NOTIFICATION_OBSERVER,
} from './notification-observer.token';
import {
  NotificationChannelEnum,
  NotificationDigestModeEnum,
  NotificationStatusEnum,
  NotificationTypeEnum,
} from './notification.enums';
import { SLA_ESCALATION_DELEGATION_REASON } from './notification.enums';
import { NotificationService } from './notification.service';
import { NotificationDeliveryService } from './notification-delivery.service';
import { DEFAULT_BPM_NOTIFICATION_OPTIONS } from './notification-options';

/** Shape of the `find` / `count` options the service passes to the repository. */
interface FindArgs {
  readonly where: Record<string, unknown>;
}

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

  it('marks every unread in-app notification of a recipient as read in one update', async (): Promise<void> => {
    const update = jest.fn<
      Promise<{ readonly affected: number }>,
      [Record<string, unknown>, Record<string, unknown>]
    >(() => Promise.resolve({ affected: 3 }));
    const service = new NotificationService(
      {
        update,
      } as unknown as Repository<NotificationEntity>,
      createRepository<NotificationPreferenceEntity>(),
      createRepository<TaskEntity>(),
      createRepository<TaskCandidateEntity>(),
      createRepository<ApprovalInstanceEntity>(),
      createRepository<ActivityLogEntity>(),
      createDeliveryService(),
      createModuleRef(),
    );

    const affected = await service.markAllNotificationsRead({
      recipientMemberId: 'member-001',
    });

    expect(affected).toBe(3);
    expect(update).toHaveBeenCalledTimes(1);
    const [criteria, patch] = update.mock.calls[0];

    expect(criteria).toMatchObject({
      channel: NotificationChannelEnum.IN_APP,
      recipientMemberId: 'member-001',
    });
    expect(patch).toMatchObject({
      status: NotificationStatusEnum.READ,
    });
    expect(patch.readAt).toBeInstanceOf(Date);
  });

  it('returns zero affected when the recipient id is blank without touching the repository', async (): Promise<void> => {
    const update = jest.fn();
    const service = new NotificationService(
      {
        update,
      } as unknown as Repository<NotificationEntity>,
      createRepository<NotificationPreferenceEntity>(),
      createRepository<TaskEntity>(),
      createRepository<TaskCandidateEntity>(),
      createRepository<ApprovalInstanceEntity>(),
      createRepository<ActivityLogEntity>(),
      createDeliveryService(),
      createModuleRef(),
    );

    await expect(
      service.markAllNotificationsRead({ recipientMemberId: '   ' }),
    ).resolves.toBe(0);
    expect(update).not.toHaveBeenCalled();
  });

  it('hides archived notifications from the default list and count', async (): Promise<void> => {
    const find = jest.fn<Promise<readonly NotificationEntity[]>, [FindArgs]>(
      () => Promise.resolve([]),
    );
    const count = jest.fn<Promise<number>, [FindArgs]>(() =>
      Promise.resolve(0),
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

    await service.listNotifications({ recipientMemberId: 'member-001' });
    await service.countNotifications({ recipientMemberId: 'member-001' });

    expect(find.mock.calls[0][0].where).toMatchObject({
      archivedAt: IsNull(),
      status: Not(NotificationStatusEnum.READ),
    });
    expect(count.mock.calls[0][0].where).toMatchObject({
      archivedAt: IsNull(),
    });
  });

  it('drops the archived filter when includeArchived is requested', async (): Promise<void> => {
    const find = jest.fn<Promise<readonly NotificationEntity[]>, [FindArgs]>(
      () => Promise.resolve([]),
    );
    const count = jest.fn<Promise<number>, [FindArgs]>(() =>
      Promise.resolve(0),
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

    await service.listNotifications({
      includeArchived: true,
      includeRead: true,
      recipientMemberId: 'member-001',
    });
    await service.countNotifications({
      includeArchived: true,
      includeRead: true,
      recipientMemberId: 'member-001',
    });

    expect(find.mock.calls[0][0].where).not.toHaveProperty('archivedAt');
    expect(find.mock.calls[0][0].where).not.toHaveProperty('status');
    expect(count.mock.calls[0][0].where).not.toHaveProperty('archivedAt');
  });

  it('excludes archived notifications from the unread badge count', async (): Promise<void> => {
    const count = jest.fn<Promise<number>, [FindArgs]>(() =>
      Promise.resolve(2),
    );
    const service = new NotificationService(
      {
        count,
      } as unknown as Repository<NotificationEntity>,
      createRepository<NotificationPreferenceEntity>(),
      createRepository<TaskEntity>(),
      createRepository<TaskCandidateEntity>(),
      createRepository<ApprovalInstanceEntity>(),
      createRepository<ActivityLogEntity>(),
      createDeliveryService(),
      createModuleRef(),
    );

    await expect(service.countUnreadNotifications('member-001')).resolves.toBe(
      2,
    );
    expect(count.mock.calls[0][0].where).toMatchObject({
      archivedAt: IsNull(),
      channel: NotificationChannelEnum.IN_APP,
      recipientMemberId: 'member-001',
      status: Not(NotificationStatusEnum.READ),
    });
  });

  it('archives only the requesting member own notifications', async (): Promise<void> => {
    const update = jest.fn<
      Promise<{ readonly affected: number }>,
      [Record<string, unknown>, Record<string, unknown>]
    >(() => Promise.resolve({ affected: 2 }));
    const service = new NotificationService(
      {
        update,
      } as unknown as Repository<NotificationEntity>,
      createRepository<NotificationPreferenceEntity>(),
      createRepository<TaskEntity>(),
      createRepository<TaskCandidateEntity>(),
      createRepository<ApprovalInstanceEntity>(),
      createRepository<ActivityLogEntity>(),
      createDeliveryService(),
      createModuleRef(),
    );

    const affected = await service.archiveNotifications({
      ids: ['notification-1', 'notification-2', 'notification-1'],
      memberId: ' member-001 ',
    });

    expect(affected).toBe(2);
    const [criteria, patch] = update.mock.calls[0];

    expect(criteria).toMatchObject({
      archivedAt: IsNull(),
      id: In(['notification-1', 'notification-2']),
      recipientMemberId: 'member-001',
    });
    expect(patch.archivedAt).toBeInstanceOf(Date);
  });

  it('clears the archive stamp when unarchiving', async (): Promise<void> => {
    const update = jest.fn<
      Promise<{ readonly affected: number }>,
      [Record<string, unknown>, Record<string, unknown>]
    >(() => Promise.resolve({ affected: 1 }));
    const service = new NotificationService(
      {
        update,
      } as unknown as Repository<NotificationEntity>,
      createRepository<NotificationPreferenceEntity>(),
      createRepository<TaskEntity>(),
      createRepository<TaskCandidateEntity>(),
      createRepository<ApprovalInstanceEntity>(),
      createRepository<ActivityLogEntity>(),
      createDeliveryService(),
      createModuleRef(),
    );

    await expect(
      service.unarchiveNotifications({
        ids: ['notification-1'],
        memberId: 'member-001',
      }),
    ).resolves.toBe(1);

    const [criteria, patch] = update.mock.calls[0];

    expect(criteria).toMatchObject({
      archivedAt: Not(IsNull()),
      recipientMemberId: 'member-001',
    });
    expect(patch).toEqual({ archivedAt: null });
  });

  it('returns zero affected when archiving without usable ids', async (): Promise<void> => {
    const update = jest.fn();
    const service = new NotificationService(
      {
        update,
      } as unknown as Repository<NotificationEntity>,
      createRepository<NotificationPreferenceEntity>(),
      createRepository<TaskEntity>(),
      createRepository<TaskCandidateEntity>(),
      createRepository<ApprovalInstanceEntity>(),
      createRepository<ActivityLogEntity>(),
      createDeliveryService(),
      createModuleRef(),
    );

    await expect(
      service.archiveNotifications({ ids: ['  '], memberId: 'member-001' }),
    ).resolves.toBe(0);
    await expect(
      service.unarchiveNotifications({
        ids: ['notification-1'],
        memberId: '   ',
      }),
    ).resolves.toBe(0);
    expect(update).not.toHaveBeenCalled();
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

  it('stores the task rejection policy in assigned notification payloads', async (): Promise<void> => {
    const savedNotifications: NotificationEntity[] = [];
    const notificationRepository = {
      create: (entity: Partial<NotificationEntity>): NotificationEntity =>
        Object.assign(new NotificationEntity(), entity),
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
    const service = new NotificationService(
      notificationRepository,
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
    );
    const baseInstance = createApprovalInstance();
    const sourceNode = baseInstance.workflowSnapshot.nodes.find(
      (node): node is UserTaskNode => node.type === 'userTask',
    );

    if (!sourceNode) {
      throw new Error('Notification test fixture must contain a user task');
    }

    const disabledNode: UserTaskNode = {
      ...sourceNode,
      data: { ...sourceNode.data, allowReject: false },
    };
    const instance = Object.assign(new ApprovalInstanceEntity(), {
      ...baseInstance,
      workflowSnapshot: {
        ...baseInstance.workflowSnapshot,
        nodes: baseInstance.workflowSnapshot.nodes.map((node) =>
          node.id === disabledNode.id ? disabledNode : node,
        ),
      },
    });
    const task = Object.assign(new TaskEntity(), {
      assigneeMemberId: 'member-a',
      id: 'task-assigned-policy',
      instanceId: instance.id,
      nodeId: disabledNode.id,
      originalAssigneeMemberId: 'member-a',
    });

    await service.createTaskAssignedNotification({
      instance,
      manager: undefined as unknown as EntityManager,
      node: disabledNode,
      task,
    });

    expect(savedNotifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          allowReject: false,
          payload: expect.objectContaining({ allowReject: false }),
        }),
      ]),
    );
  });

  describe('recipient preferences', () => {
    interface PreferenceHarness {
      readonly delivered: NotificationEntity[];
      readonly events: BPMNotificationsCreatedEvent[];
      readonly saved: NotificationEntity[];
      readonly service: NotificationService;
    }

    function createPreferenceHarness({
      calendarTimeZone,
      channels = [NotificationChannelEnum.IN_APP],
      options = {},
      preference = {},
    }: {
      /** Registers a business calendar and leaves the zone option unset. */
      readonly calendarTimeZone?: string;
      readonly channels?: readonly NotificationChannelEnum[];
      readonly options?: Partial<typeof DEFAULT_BPM_NOTIFICATION_OPTIONS>;
      readonly preference?: Partial<NotificationPreferenceEntity>;
    } = {}): PreferenceHarness & {
      readonly assign: () => Promise<void>;
    } {
      const saved: NotificationEntity[] = [];
      const delivered: NotificationEntity[] = [];
      const events: BPMNotificationsCreatedEvent[] = [];
      const notificationRepository = {
        create: (entity: Partial<NotificationEntity>): NotificationEntity =>
          Object.assign(new NotificationEntity(), entity),
        save: (
          entityOrEntities: NotificationEntity | NotificationEntity[],
        ): Promise<NotificationEntity | NotificationEntity[]> => {
          saved.push(
            ...(Array.isArray(entityOrEntities)
              ? entityOrEntities
              : [entityOrEntities]),
          );

          return Promise.resolve(entityOrEntities);
        },
      } as unknown as Repository<NotificationEntity>;
      const service = new NotificationService(
        notificationRepository,
        {
          findOne: (): Promise<NotificationPreferenceEntity | null> =>
            Promise.resolve(
              Object.assign(new NotificationPreferenceEntity(), {
                emailDigestMode: NotificationDigestModeEnum.INSTANT,
                emailEnabled: true,
                inAppEnabled: true,
                memberId: 'member-a',
                quietHoursEnd: null,
                quietHoursStart: null,
                ...preference,
              }),
            ),
        } as unknown as Repository<NotificationPreferenceEntity>,
        createRepository<TaskEntity>(),
        createRepository<TaskCandidateEntity>(),
        createRepository<ApprovalInstanceEntity>(),
        createRepository<ActivityLogEntity>(),
        {
          deliverNotification: (
            notification: NotificationEntity,
          ): Promise<boolean> => {
            delivered.push(notification);

            return Promise.resolve(true);
          },
        } as unknown as NotificationDeliveryService,
        {
          get: (
            token: unknown,
          ): BPMNotificationObserver | BPMBusinessCalendar => {
            if (token === BPM_NOTIFICATION_OBSERVER) {
              return {
                onNotificationsCreated: (event): void => {
                  events.push(event);
                },
              };
            }

            if (token === BPM_BUSINESS_CALENDAR && calendarTimeZone) {
              return {
                isBusinessDay: (): boolean => true,
                timeZone: calendarTimeZone,
              };
            }

            throw new Error('Unexpected ModuleRef lookup');
          },
        } as unknown as ModuleRef,
        {
          ...DEFAULT_BPM_NOTIFICATION_OPTIONS,
          emailEnabled: true,
          // Explicit unless a test is exercising the calendar fallback.
          quietHoursTimeZone: calendarTimeZone ? null : 'Asia/Taipei',
          ...options,
        },
      );

      const assign = async (): Promise<void> => {
        const instance = createApprovalInstance();
        const sourceNode = instance.workflowSnapshot.nodes.find(
          (candidate): candidate is UserTaskNode =>
            candidate.type === 'userTask',
        );

        if (!sourceNode) {
          throw new Error('Preference fixture must contain a user task');
        }

        const node: UserTaskNode = {
          ...sourceNode,
          data: {
            ...sourceNode.data,
            notification: { channels: [...channels] },
          },
        };

        await service.createTaskAssignedNotification({
          instance,
          manager: undefined as unknown as EntityManager,
          node,
          task: Object.assign(new TaskEntity(), {
            assigneeMemberId: 'member-a',
            id: 'task-preference',
            instanceId: instance.id,
            nodeId: node.id,
            originalAssigneeMemberId: 'member-a',
          }),
        });
      };

      return { assign, delivered, events, saved, service };
    }

    afterEach((): void => {
      jest.useRealTimers();
    });

    it('records an in-app notification even when the member turned in-app off', async (): Promise<void> => {
      const { assign, events, saved } = createPreferenceHarness({
        preference: { inAppEnabled: false },
      });

      await assign();

      // The whole point: silencing must not destroy the record. Before this,
      // an afternoon of quiet left the notification centre empty afterwards.
      expect(saved).toHaveLength(1);
      expect(saved[0]).toEqual(
        expect.objectContaining({
          channel: NotificationChannelEnum.IN_APP,
          silenced: true,
          status: NotificationStatusEnum.SENT,
        }),
      );
      // And the host still hears about it, so it can record quietly instead of
      // never learning the notification existed.
      expect(events).toHaveLength(1);
    });

    it('silences an in-app notification that arrives inside quiet hours', async (): Promise<void> => {
      jest.useFakeTimers();
      // 23:30 Taipei.
      jest.setSystemTime(new Date('2026-08-18T15:30:00.000Z'));

      const { assign, saved } = createPreferenceHarness({
        preference: { quietHoursEnd: '08:00', quietHoursStart: '22:00' },
      });

      await assign();

      expect(saved[0]).toEqual(expect.objectContaining({ silenced: true }));
    });

    it('announces an in-app notification that arrives outside quiet hours', async (): Promise<void> => {
      jest.useFakeTimers();
      // 09:00 Taipei.
      jest.setSystemTime(new Date('2026-08-18T01:00:00.000Z'));

      const { assign, saved } = createPreferenceHarness({
        preference: { quietHoursEnd: '08:00', quietHoursStart: '22:00' },
      });

      await assign();

      expect(saved[0]).toEqual(expect.objectContaining({ silenced: false }));
    });

    it('holds an email raised inside quiet hours until the window closes', async (): Promise<void> => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-08-18T15:30:00.000Z'));

      const { assign, delivered, saved } = createPreferenceHarness({
        channels: [NotificationChannelEnum.EMAIL],
        preference: { quietHoursEnd: '08:00', quietHoursStart: '22:00' },
      });

      await assign();

      expect(saved[0]).toEqual(
        expect.objectContaining({
          channel: NotificationChannelEnum.EMAIL,
          // 08:00 Taipei the next morning.
          nextRetryAt: new Date('2026-08-19T00:00:00.000Z'),
          status: NotificationStatusEnum.PENDING,
        }),
      );
      // Held, not dropped — and not pushed out immediately either.
      expect(delivered).toHaveLength(0);
    });

    it('holds a daily-digest email until the next digest hour', async (): Promise<void> => {
      jest.useFakeTimers();
      // 14:00 Taipei, past the 09:00 digest hour.
      jest.setSystemTime(new Date('2026-08-18T06:00:00.000Z'));

      const { assign, delivered, saved } = createPreferenceHarness({
        channels: [NotificationChannelEnum.EMAIL],
        preference: { emailDigestMode: NotificationDigestModeEnum.DAILY },
      });

      await assign();

      expect(saved[0].nextRetryAt).toEqual(
        new Date('2026-08-19T01:00:00.000Z'),
      );
      expect(delivered).toHaveLength(0);
    });

    it('sends an instant email straight away when no window defers it', async (): Promise<void> => {
      const { assign, delivered, saved } = createPreferenceHarness({
        channels: [NotificationChannelEnum.EMAIL],
      });

      await assign();

      expect(saved[0].nextRetryAt).toBeNull();
      expect(delivered).toHaveLength(1);
    });

    it('reads quiet hours in the registered calendar zone when none is configured', async (): Promise<void> => {
      jest.useFakeTimers();
      // 14:56 Taipei — the middle of a working afternoon, but 06:56 in UTC,
      // which falls inside a 20:00–08:00 window. A host that registered a
      // Taiwan calendar must not have its afternoon silenced by BPM defaulting
      // the zone to UTC.
      jest.setSystemTime(new Date('2026-08-18T06:56:00.000Z'));

      const { assign, saved } = createPreferenceHarness({
        calendarTimeZone: 'Asia/Taipei',
        preference: { quietHoursEnd: '08:00', quietHoursStart: '20:00' },
      });

      await assign();

      expect(saved[0]).toEqual(expect.objectContaining({ silenced: false }));
    });

    it('falls back to UTC when neither an option nor a calendar answers', async (): Promise<void> => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-08-18T06:56:00.000Z'));

      const { assign, saved } = createPreferenceHarness({
        options: { quietHoursTimeZone: null },
        preference: { quietHoursEnd: '08:00', quietHoursStart: '20:00' },
      });

      await assign();

      expect(saved[0]).toEqual(expect.objectContaining({ silenced: true }));
    });

    it('drops in-app rows only for the host-level kill switch', async (): Promise<void> => {
      const { assign, saved } = createPreferenceHarness({
        // `notificationInAppEnabled: false` is a wiring decision — "run BPM
        // without notification centre data" — not something a member can trip.
        options: { inAppEnabled: false },
      });

      await assign();

      expect(saved).toHaveLength(0);
    });
  });

  describe('BPM_NOTIFICATION_OBSERVER', () => {
    interface ObserverHarness {
      readonly events: BPMNotificationsCreatedEvent[];
      readonly service: NotificationService;
    }

    function createObserverHarness(onCreated?: () => void): ObserverHarness {
      const events: BPMNotificationsCreatedEvent[] = [];
      const observer: BPMNotificationObserver = {
        onNotificationsCreated: (event): void => {
          events.push(event);
          onCreated?.();
        },
      };
      const notificationRepository = {
        create: (entity: Partial<NotificationEntity>): NotificationEntity =>
          Object.assign(new NotificationEntity(), entity),
        save: (
          entityOrEntities: NotificationEntity | NotificationEntity[],
        ): Promise<NotificationEntity | NotificationEntity[]> =>
          Promise.resolve(entityOrEntities),
      } as unknown as Repository<NotificationEntity>;
      const moduleRef = {
        get: (token: unknown): unknown => {
          if (token === BPM_NOTIFICATION_OBSERVER) {
            return observer;
          }

          throw new Error('Unexpected ModuleRef lookup');
        },
      } as unknown as ModuleRef;
      const service = new NotificationService(
        notificationRepository,
        {
          findOne: (): Promise<NotificationPreferenceEntity | null> =>
            Promise.resolve(null),
        } as unknown as Repository<NotificationPreferenceEntity>,
        createRepository<TaskEntity>(),
        createRepository<TaskCandidateEntity>(),
        createRepository<ApprovalInstanceEntity>(),
        createRepository<ActivityLogEntity>(),
        createDeliveryService(),
        moduleRef,
      );

      return { events, service };
    }

    async function assignTask(
      service: NotificationService,
      manager?: EntityManager,
    ): Promise<void> {
      const instance = createApprovalInstance();
      const node = instance.workflowSnapshot.nodes.find(
        (candidate): candidate is UserTaskNode => candidate.type === 'userTask',
      );

      if (!node) {
        throw new Error('Observer fixture must contain a user task');
      }

      await service.createTaskAssignedNotification({
        instance,
        manager: manager as unknown as EntityManager,
        node,
        task: Object.assign(new TaskEntity(), {
          assigneeMemberId: 'member-a',
          id: 'task-observer',
          instanceId: instance.id,
          nodeId: node.id,
          originalAssigneeMemberId: 'member-a',
        }),
      });
    }

    it('reports in-app rows, which never reach the delivery dispatcher', async (): Promise<void> => {
      const { events, service } = createObserverHarness();

      await assignTask(service);

      expect(events).toHaveLength(1);
      expect(
        events[0]?.notifications.some(
          (notification) =>
            notification.channel === NotificationChannelEnum.IN_APP,
        ),
      ).toBe(true);
    });

    it('lifts the routing fields out of the rows', async (): Promise<void> => {
      // A host routing an SSE push should not have to unpack a row to learn
      // what happened or which instance it belongs to.
      const { events, service } = createObserverHarness();

      await assignTask(service);

      const event = events[0];

      expect(event?.type).toBe(NotificationTypeEnum.TASK_ASSIGNED);
      expect(event?.taskId).toBe('task-observer');
      expect(event?.instanceId).toBe(event?.notifications[0]?.instanceId);
      // Every row in a batch shares the type the event reports.
      expect(
        event?.notifications.every(
          (notification) => notification.type === event.type,
        ),
      ).toBe(true);
    });

    it('passes the batch in one call rather than one call per row', async (): Promise<void> => {
      const { events, service } = createObserverHarness();

      await assignTask(service);

      expect(events).toHaveLength(1);
      expect(events[0]?.notifications.length).toBeGreaterThan(0);
    });

    it('hands over the manager so a host can wait for the commit', async (): Promise<void> => {
      const { events, service } = createObserverHarness();
      const manager = {
        getRepository: (): unknown => ({
          create: (entity: Partial<NotificationEntity>): NotificationEntity =>
            Object.assign(new NotificationEntity(), entity),
          save: (
            entityOrEntities: NotificationEntity | NotificationEntity[],
          ): Promise<NotificationEntity | NotificationEntity[]> =>
            Promise.resolve(entityOrEntities),
        }),
      } as unknown as EntityManager;

      // Rows written inside a caller-supplied transaction are not committed
      // yet, so the host needs the manager to defer its push.
      await assignTask(service, manager);

      expect(events[0]?.manager).toBe(manager);
    });

    it('omits the manager when BPM owned the write', async (): Promise<void> => {
      const { events, service } = createObserverHarness();

      await assignTask(service);

      expect(events[0]?.manager).toBeUndefined();
    });

    it('swallows observer failures so they cannot roll back the engine', async (): Promise<void> => {
      const { service } = createObserverHarness((): never => {
        throw new Error('host SSE broker is down');
      });

      await expect(assignTask(service)).resolves.toBeUndefined();
    });
  });

  it('derives the rejection policy for legacy task notifications', async (): Promise<void> => {
    const notification = createNotification('notification-legacy-policy');
    const instance = createApprovalInstance();
    const sourceNode = instance.workflowSnapshot.nodes.find(
      (node): node is UserTaskNode => node.type === 'userTask',
    );

    if (!sourceNode) {
      throw new Error('Legacy notification fixture must contain a user task');
    }

    const task = Object.assign(new TaskEntity(), {
      id: notification.taskId,
      instanceId: instance.id,
      nodeId: sourceNode.id,
    });
    instance.workflowSnapshot = {
      ...instance.workflowSnapshot,
      nodes: instance.workflowSnapshot.nodes.map((node) =>
        node.id === sourceNode.id
          ? { ...sourceNode, data: { ...sourceNode.data, allowReject: false } }
          : node,
      ),
    };
    const service = new NotificationService(
      {
        find: (): Promise<readonly NotificationEntity[]> =>
          Promise.resolve([notification]),
      } as unknown as Repository<NotificationEntity>,
      createRepository<NotificationPreferenceEntity>(),
      {
        find: (): Promise<readonly TaskEntity[]> => Promise.resolve([task]),
      } as unknown as Repository<TaskEntity>,
      createRepository<TaskCandidateEntity>(),
      {
        find: (): Promise<readonly ApprovalInstanceEntity[]> =>
          Promise.resolve([instance]),
      } as unknown as Repository<ApprovalInstanceEntity>,
      createRepository<ActivityLogEntity>(),
      createDeliveryService(),
      createModuleRef(),
    );

    const [listedNotification] = await service.listNotifications({
      includeRead: true,
      recipientMemberId: notification.recipientMemberId,
    });

    expect(listedNotification?.allowReject).toBe(false);
  });

  it('creates SLA notifications for candidate group task members', async (): Promise<void> => {
    const savedNotifications: NotificationEntity[] = [];
    const notificationRepository = {
      create: (entity: Partial<NotificationEntity>): NotificationEntity =>
        Object.assign(new NotificationEntity(), entity),
      findOne: (): Promise<NotificationEntity | null> => Promise.resolve(null),
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
    expect(
      savedNotifications.map((notification) => notification.recipientMemberId),
    ).toEqual(['member-a', 'member-b']);
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
  it('escalates an overdue task once and stamps the escalation reason', async (): Promise<void> => {
    const fixture = createEscalationFixture({ delegationChain: [] });

    await expect(
      fixture.service.runSlaScan(new Date('2026-05-10T09:01:00.000Z')),
    ).resolves.toEqual({ overdueCount: 1, warningCount: 0 });
    expect(fixture.decideTask).toHaveBeenCalledTimes(1);
    expect(fixture.decideTask).toHaveBeenCalledWith(
      expect.objectContaining({
        action: TaskDecisionActionEnum.TRANSFERRED,
        taskId: 'f4fae7b0-eab0-40de-8dfa-7dfbff746980',
        transferToMemberId: 'member-manager',
      }),
      { transferReason: SLA_ESCALATION_DELEGATION_REASON },
    );
  });

  it('does not escalate again once the delegation chain records an escalation', async (): Promise<void> => {
    // The escalated task inherits the chain and keeps the elapsed due date, so
    // without the marker every later scan would escalate one level further.
    const fixture = createEscalationFixture({
      delegationChain: [
        {
          from: 'member-a',
          reason: SLA_ESCALATION_DELEGATION_REASON,
          ruleId: null,
          to: 'member-manager',
        },
      ],
    });

    await expect(
      fixture.service.runSlaScan(new Date('2026-05-10T09:01:00.000Z')),
    ).resolves.toEqual({ overdueCount: 1, warningCount: 0 });
    expect(fixture.decideTask).not.toHaveBeenCalled();
  });

  it('still escalates a task whose chain only holds a manual transfer', async (): Promise<void> => {
    const fixture = createEscalationFixture({
      delegationChain: [
        {
          from: 'member-a',
          reason: 'MANUAL_TRANSFER',
          ruleId: null,
          to: 'member-b',
        },
      ],
    });

    await fixture.service.runSlaScan(new Date('2026-05-10T09:01:00.000Z'));

    expect(fixture.decideTask).toHaveBeenCalledTimes(1);
  });
});

function createEscalationFixture({
  delegationChain,
}: {
  readonly delegationChain: readonly Readonly<Record<string, unknown>>[];
}): {
  readonly decideTask: jest.Mock;
  readonly service: NotificationService;
} {
  const decideTask = jest.fn(
    (): Promise<Record<string, unknown>> => Promise.resolve({}),
  );
  const task = Object.assign(new TaskEntity(), {
    assigneeMemberId: 'member-a',
    createdAt: new Date('2026-05-10T08:00:00.000Z'),
    delegationChain,
    id: 'f4fae7b0-eab0-40de-8dfa-7dfbff746980',
    instanceId: 'd6f61a56-8b12-4ab8-9424-a2f7c27874e2',
    nodeId: 'task_review',
    slaDueAt: new Date('2026-05-10T09:00:00.000Z'),
    status: TaskStatusEnum.PENDING,
  });
  const service = new NotificationService(
    {
      create: (entity: Partial<NotificationEntity>): NotificationEntity =>
        Object.assign(new NotificationEntity(), entity),
      findOne: (): Promise<NotificationEntity | null> => Promise.resolve(null),
      save: (entity: NotificationEntity): Promise<NotificationEntity> =>
        Promise.resolve(entity),
    } as unknown as Repository<NotificationEntity>,
    {
      findOne: (): Promise<NotificationPreferenceEntity | null> =>
        Promise.resolve(null),
    } as unknown as Repository<NotificationPreferenceEntity>,
    {
      find: (): Promise<readonly TaskEntity[]> => Promise.resolve([task]),
    } as unknown as Repository<TaskEntity>,
    createRepository<TaskCandidateEntity>(),
    {
      findOne: (): Promise<ApprovalInstanceEntity> =>
        Promise.resolve(createApprovalInstance('ESCALATE')),
    } as unknown as Repository<ApprovalInstanceEntity>,
    {
      create: (entity: Partial<ActivityLogEntity>): ActivityLogEntity =>
        Object.assign(new ActivityLogEntity(), entity),
      save: (entity: ActivityLogEntity): Promise<ActivityLogEntity> =>
        Promise.resolve(entity),
    } as unknown as Repository<ActivityLogEntity>,
    createDeliveryService(),
    {
      get: (token: unknown): unknown =>
        token === OrganizationService
          ? {
              resolveManagerMemberId: (): Promise<string> =>
                Promise.resolve('member-manager'),
            }
          : { decideTask },
    } as unknown as ModuleRef,
    { ...DEFAULT_BPM_NOTIFICATION_OPTIONS, slaTimeoutEscalateEnabled: true },
  );

  return { decideTask, service };
}

function createNotification(id: string): NotificationEntity {
  return Object.assign(new NotificationEntity(), {
    archivedAt: null,
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

function createApprovalInstance(
  onTimeout: SlaConfig['onTimeout'] = 'REMIND',
): ApprovalInstanceEntity {
  return Object.assign(new ApprovalInstanceEntity(), {
    id: 'd6f61a56-8b12-4ab8-9424-a2f7c27874e2',
    title: '採購申請',
    workflowSnapshot: createSlaWorkflow(onTimeout),
  });
}

function createSlaWorkflow(
  onTimeout: SlaConfig['onTimeout'] = 'REMIND',
): WorkflowDefinition {
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
            escalateLevelsUp: 1,
            onTimeout,
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
  return {
    find: (): Promise<readonly TEntity[]> => Promise.resolve([]),
  } as unknown as Repository<TEntity>;
}
