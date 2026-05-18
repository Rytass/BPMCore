import * as nodemailer from 'nodemailer';
import { ModuleRef } from '@nestjs/core';
import { Repository } from 'typeorm';
import { IdentityService } from '../identity/identity.service';
import { NotificationDeliveryService } from './notification-delivery.service';
import {
  BPM_NOTIFICATION_DISPATCHER,
  BPMNotificationDispatcher,
} from './notification-dispatcher.token';
import { NotificationEntity } from './notification.entity';
import {
  NotificationChannelEnum,
  NotificationStatusEnum,
  NotificationTypeEnum,
} from './notification.enums';
import { DEFAULT_BPM_NOTIFICATION_OPTIONS } from './notification-options';

describe('NotificationDeliveryService', () => {
  afterEach((): void => {
    jest.restoreAllMocks();
  });

  it('sends pending email notifications through SMTP and marks them sent', async (): Promise<void> => {
    const sendMail = jest.fn((): Promise<void> => Promise.resolve());
    jest.spyOn(nodemailer, 'createTransport').mockReturnValue({
      sendMail,
    } as unknown as ReturnType<typeof nodemailer.createTransport>);
    const notification = createNotification(NotificationChannelEnum.EMAIL);
    const repository = createNotificationRepository(notification);
    const service = new NotificationDeliveryService(
      repository,
      createModuleRef(),
    );

    await expect(
      service.deliverNotification(notification, {
        ...DEFAULT_BPM_NOTIFICATION_OPTIONS,
        emailEnabled: true,
        emailFrom: 'BPM <bpm@example.com>',
        emailSmtpHost: 'smtp.example.com',
        emailSmtpPassword: 'secret',
        emailSmtpPort: 587,
        emailSmtpSecure: false,
        emailSmtpUsername: 'bpm@example.com',
      }),
    ).resolves.toBe(true);

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'BPM <bpm@example.com>',
        subject: notification.title,
        text: notification.body,
        to: 'member-001@example.com',
      }),
    );
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: NotificationStatusEnum.SENT,
        deliveryTarget: 'member-001@example.com',
      }),
    );
  });

  it('sends signed webhook notifications', async (): Promise<void> => {
    const fetchMock = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
      }),
    );
    jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(fetchMock as unknown as typeof fetch);
    const notification = createNotification(NotificationChannelEnum.WEBHOOK);
    const repository = createNotificationRepository(notification);
    const service = new NotificationDeliveryService(
      repository,
      createModuleRef(),
    );

    await expect(
      service.deliverNotification(notification, {
        ...DEFAULT_BPM_NOTIFICATION_OPTIONS,
        webhookEnabled: true,
        webhookEndpointUrl: 'https://example.com/bpm-webhook',
        webhookSigningSecret: 'secret',
      }),
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/bpm-webhook',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-bpm-signature-sha256': expect.any(String),
        }),
        method: 'POST',
      }),
    );
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: NotificationStatusEnum.SENT,
        deliveryTarget: 'https://example.com/bpm-webhook',
      }),
    );
  });

  it('dispatches email and webhook notifications through a host dispatcher when provided', async (): Promise<void> => {
    const dispatch = jest.fn((): Promise<string> => Promise.resolve('queue-1'));
    const notification = createNotification(NotificationChannelEnum.EMAIL);
    const repository = createNotificationRepository(notification);
    const service = new NotificationDeliveryService(
      repository,
      createModuleRef({
        dispatch,
      }),
    );

    await expect(
      service.deliverNotification(notification, DEFAULT_BPM_NOTIFICATION_OPTIONS),
    ).resolves.toBe(true);

    expect(dispatch).toHaveBeenCalledWith(
      notification,
      DEFAULT_BPM_NOTIFICATION_OPTIONS,
    );
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryTarget: 'queue-1',
        status: NotificationStatusEnum.SENT,
      }),
    );
  });

  it('records delivery failures and schedules a retry', async (): Promise<void> => {
    const notification = createNotification(NotificationChannelEnum.EMAIL);
    const repository = createNotificationRepository(notification);
    const service = new NotificationDeliveryService(
      repository,
      createModuleRef(),
    );

    await expect(
      service.deliverNotification(notification, {
        ...DEFAULT_BPM_NOTIFICATION_OPTIONS,
        emailEnabled: false,
      }),
    ).resolves.toBe(false);

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptCount: 1,
        deliveryError: 'EMAIL_DISABLED',
        nextRetryAt: expect.any(Date),
        status: NotificationStatusEnum.PENDING,
      }),
    );
  });

  it('uses configured retry policy and marks notifications failed after max attempts', async (): Promise<void> => {
    const notification = Object.assign(
      createNotification(NotificationChannelEnum.EMAIL),
      { attemptCount: 1 },
    );
    const repository = createNotificationRepository(notification);
    const service = new NotificationDeliveryService(
      repository,
      createModuleRef(),
    );

    await expect(
      service.deliverNotification(notification, {
        ...DEFAULT_BPM_NOTIFICATION_OPTIONS,
        deliveryMaxAttempts: 2,
        deliveryRetryBaseDelayMs: 5_000,
        emailEnabled: false,
      }),
    ).resolves.toBe(false);

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptCount: 2,
        nextRetryAt: null,
        status: NotificationStatusEnum.FAILED,
      }),
    );
  });

  it('uses configured batch size when scanning pending notifications', async (): Promise<void> => {
    const notification = createNotification(NotificationChannelEnum.IN_APP);
    const repository = createNotificationRepository(notification);
    const service = new NotificationDeliveryService(
      repository,
      createModuleRef(),
    );

    await service.deliverPendingNotifications({
      options: {
        ...DEFAULT_BPM_NOTIFICATION_OPTIONS,
        deliveryBatchSize: 7,
      },
    });

    expect(repository.find).toHaveBeenCalledWith(
      expect.objectContaining({ take: 7 }),
    );
  });

  it('includes stale in-progress notifications in the next delivery scan', async (): Promise<void> => {
    const notification = createNotification(NotificationChannelEnum.IN_APP);
    const repository = createNotificationRepository(notification);
    const service = new NotificationDeliveryService(
      repository,
      createModuleRef(),
    );

    await service.deliverPendingNotifications({
      now: new Date('2026-05-15T00:10:00.000Z'),
      options: {
        ...DEFAULT_BPM_NOTIFICATION_OPTIONS,
        deliveryRetryBaseDelayMs: 60_000,
      },
    });

    expect(repository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.arrayContaining([
          expect.objectContaining({
            lastAttemptAt: expect.any(Object),
            status: NotificationStatusEnum.DELIVERY_IN_PROGRESS,
          }),
        ]),
      }),
    );
  });
});

function createNotification(
  channel: NotificationChannelEnum,
): NotificationEntity {
  return Object.assign(new NotificationEntity(), {
    attemptCount: 0,
    body: '請處理待簽任務。',
    channel,
    createdAt: new Date('2026-05-15T00:00:00.000Z'),
    deliveredAt: null,
    deliveryError: null,
    deliveryTarget: null,
    id: 'notification-001',
    instanceId: 'd6f61a56-8b12-4ab8-9424-a2f7c27874e2',
    lastAttemptAt: null,
    nextRetryAt: null,
    payload: { instanceTitle: '採購申請' },
    readAt: null,
    recipientMemberId: 'member-001',
    sentAt: null,
    status: NotificationStatusEnum.PENDING,
    taskId: 'f4fae7b0-eab0-40de-8dfa-7dfbff746980',
    title: '新的待簽任務',
    type: NotificationTypeEnum.TASK_ASSIGNED,
  });
}

function createNotificationRepository(
  notification: NotificationEntity,
): Repository<NotificationEntity> & {
  readonly find: jest.Mock;
  readonly save: jest.Mock;
} {
  const repository = {
    find: jest.fn(
      (): Promise<readonly NotificationEntity[]> =>
        Promise.resolve([notification]),
    ),
    save: jest.fn(
      (entity: NotificationEntity): Promise<NotificationEntity> =>
        Promise.resolve(entity),
    ),
  };

  return repository as unknown as Repository<NotificationEntity> & {
    readonly find: jest.Mock;
    readonly save: jest.Mock;
  };
}

function createModuleRef(
  dispatcher?: BPMNotificationDispatcher,
): ModuleRef {
  return {
    get: (token: unknown): BPMNotificationDispatcher | IdentityService => {
      if (token === BPM_NOTIFICATION_DISPATCHER && dispatcher) {
        return dispatcher;
      }

      if (token !== IdentityService) {
        throw new Error('Unexpected module token');
      }

      return {
        resolveMember: (): Promise<{
          readonly customFields: Readonly<Record<string, unknown>>;
          readonly email: string;
          readonly memberId: string;
          readonly name: string;
        }> =>
          Promise.resolve({
            customFields: {},
            email: 'member-001@example.com',
            memberId: 'member-001',
            name: '王小明',
          }),
      } as unknown as IdentityService;
    },
  } as unknown as ModuleRef;
}
