import { validateSync } from 'class-validator';
import { ObjectLiteral, Repository } from 'typeorm';
import { ActivityLogEntity } from '../workflow-engine/activity-log.entity';
import { ApprovalInstanceEntity } from '../workflow-engine/approval-instance.entity';
import { TaskEntity } from '../workflow-engine/task.entity';
import { UpdateNotificationPreferenceInput } from './dto/notification-preference.input';
import { NotificationPreferenceEntity } from './notification-preference.entity';
import { NotificationEntity } from './notification.entity';
import {
  NotificationChannelEnum,
  NotificationStatusEnum,
  NotificationTypeEnum,
} from './notification.enums';
import { NotificationService } from './notification.service';

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
      createRepository<ApprovalInstanceEntity>(),
      createRepository<ActivityLogEntity>(),
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
      createRepository<ApprovalInstanceEntity>(),
      createRepository<ActivityLogEntity>(),
    );

    const readNotification = await service.markNotificationRead({
      id: notification.id,
      readerMemberId: 'member-001',
    });

    expect(readNotification).toBeInstanceOf(NotificationEntity);
    expect(readNotification.payloadJson).toBe('{}');
    expect(readNotification.status).toBe(NotificationStatusEnum.READ);
  });
});

function createNotification(id: string): NotificationEntity {
  return Object.assign(new NotificationEntity(), {
    body: '待簽通知',
    channel: NotificationChannelEnum.IN_APP,
    createdAt: new Date('2026-05-10T00:00:00.000Z'),
    id,
    instanceId: 'd6f61a56-8b12-4ab8-9424-a2f7c27874e2',
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
