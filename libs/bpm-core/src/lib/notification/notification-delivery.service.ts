import { createHmac } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import * as nodemailer from 'nodemailer';
import { In, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { IdentityService } from '../identity/identity.service';
import {
  BPM_NOTIFICATION_DISPATCHER,
  BPMNotificationDispatcher,
} from './notification-dispatcher.token';
import { NotificationEntity } from './notification.entity';
import {
  NotificationChannelEnum,
  NotificationStatusEnum,
} from './notification.enums';
import { BPMResolvedNotificationOptions } from './notification-options';

@Injectable()
export class NotificationDeliveryService {
  private readonly logger = new Logger(NotificationDeliveryService.name);

  constructor(
    @InjectRepository(NotificationEntity)
    private readonly notificationRepository: Repository<NotificationEntity>,
    private readonly moduleRef: ModuleRef,
  ) {}

  async deliverPendingNotifications({
    limit,
    now = new Date(),
    options,
  }: {
    readonly limit?: number;
    readonly now?: Date;
    readonly options: BPMResolvedNotificationOptions;
  }): Promise<number> {
    const deliveryLimit = normalizePositiveInteger(
      limit,
      options.deliveryBatchSize,
    );
    const pendingNotifications = await this.claimPendingNotifications({
      claimStaleBefore: new Date(
        now.getTime() - options.deliveryRetryBaseDelayMs,
      ),
      limit: deliveryLimit,
      now,
    });
    const results = await Promise.all(
      pendingNotifications.map((notification) =>
        this.deliverNotification(notification, options),
      ),
    );

    return results.filter(Boolean).length;
  }

  async deliverNotification(
    notification: NotificationEntity,
    options: BPMResolvedNotificationOptions,
  ): Promise<boolean> {
    if (notification.channel === NotificationChannelEnum.IN_APP) {
      return false;
    }

    if (
      notification.status !== NotificationStatusEnum.PENDING &&
      notification.status !== NotificationStatusEnum.DELIVERY_IN_PROGRESS
    ) {
      return false;
    }

    try {
      const deliveryTarget = await this.dispatch(notification, options);
      await this.notificationRepository.save({
        ...notification,
        attemptCount: notification.attemptCount + 1,
        deliveredAt: new Date(),
        deliveryError: null,
        deliveryTarget,
        lastAttemptAt: new Date(),
        nextRetryAt: null,
        sentAt: new Date(),
        status: NotificationStatusEnum.SENT,
      });

      return true;
    } catch (error: unknown) {
      await this.recordDeliveryFailure(
        notification,
        readErrorMessage(error),
        options,
      );

      return false;
    }
  }

  private async claimPendingNotifications({
    claimStaleBefore,
    limit,
    now,
  }: {
    readonly claimStaleBefore: Date;
    readonly limit: number;
    readonly now: Date;
  }): Promise<readonly NotificationEntity[]> {
    if (!this.notificationRepository.manager?.transaction) {
      return this.notificationRepository.find({
        order: { createdAt: 'ASC' },
        take: limit,
        where: [
          {
            nextRetryAt: LessThanOrEqual(now),
            status: NotificationStatusEnum.PENDING,
          },
          {
            nextRetryAt: IsNull(),
            status: NotificationStatusEnum.PENDING,
          },
          {
            lastAttemptAt: LessThanOrEqual(claimStaleBefore),
            status: NotificationStatusEnum.DELIVERY_IN_PROGRESS,
          },
        ],
      });
    }

    return this.notificationRepository.manager.transaction(
      async (manager): Promise<readonly NotificationEntity[]> => {
        const claimedRows = (await manager.query(
          `
            UPDATE notifications
               SET status = $1,
                   last_attempt_at = $2
             WHERE id IN (
               SELECT id
                 FROM notifications
                WHERE (
                    (
                      status = $3
                      AND (next_retry_at IS NULL OR next_retry_at <= $2)
                    )
                    OR (
                      status = $5
                      AND last_attempt_at <= $6
                    )
                  )
                ORDER BY created_at ASC
                FOR UPDATE SKIP LOCKED
                LIMIT $4
             )
             RETURNING id
          `,
          [
            NotificationStatusEnum.DELIVERY_IN_PROGRESS,
            now,
            NotificationStatusEnum.PENDING,
            limit,
            NotificationStatusEnum.DELIVERY_IN_PROGRESS,
            claimStaleBefore,
          ],
        )) as readonly { readonly id: string }[];
        const claimedIds = claimedRows.map((row) => row.id);

        return claimedIds.length
          ? manager
              .getRepository(NotificationEntity)
              .find({ where: { id: In(claimedIds) } })
          : [];
      },
    );
  }

  private async dispatch(
    notification: NotificationEntity,
    options: BPMResolvedNotificationOptions,
  ): Promise<string> {
    const hostDispatcher = this.readHostDispatcher();

    if (hostDispatcher) {
      return hostDispatcher.dispatch(notification, options);
    }

    return this.dispatchBuiltIn(notification, options);
  }

  private async dispatchBuiltIn(
    notification: NotificationEntity,
    options: BPMResolvedNotificationOptions,
  ): Promise<string> {
    if (notification.channel === NotificationChannelEnum.EMAIL) {
      return this.dispatchEmail(notification, options);
    }

    if (notification.channel === NotificationChannelEnum.WEBHOOK) {
      return this.dispatchWebhook(notification, options);
    }

    throw new Error(`Unsupported notification channel ${notification.channel}`);
  }

  private readHostDispatcher(): BPMNotificationDispatcher | null {
    try {
      return this.moduleRef.get(BPM_NOTIFICATION_DISPATCHER, {
        strict: false,
      });
    } catch {
      return null;
    }
  }

  private async dispatchEmail(
    notification: NotificationEntity,
    options: BPMResolvedNotificationOptions,
  ): Promise<string> {
    if (
      !options.emailEnabled ||
      !options.emailSmtpHost ||
      !options.emailSmtpPort ||
      !options.emailSmtpUsername ||
      !options.emailSmtpPassword ||
      !options.emailFrom
    ) {
      throw new Error('EMAIL_DISABLED');
    }

    const identityService = this.moduleRef.get(IdentityService, {
      strict: false,
    });
    const recipient = await identityService.resolveMember(
      notification.recipientMemberId,
    );
    const transporter = nodemailer.createTransport({
      auth: {
        pass: options.emailSmtpPassword,
        user: options.emailSmtpUsername,
      },
      host: options.emailSmtpHost,
      port: options.emailSmtpPort,
      secure: options.emailSmtpSecure,
    });

    await transporter.sendMail({
      from: options.emailFrom,
      subject: notification.title,
      text: notification.body,
      to: recipient.email,
    });

    return recipient.email;
  }

  private async dispatchWebhook(
    notification: NotificationEntity,
    options: BPMResolvedNotificationOptions,
  ): Promise<string> {
    if (
      !options.webhookEnabled ||
      !options.webhookEndpointUrl ||
      !options.webhookSigningSecret
    ) {
      throw new Error('WEBHOOK_DISABLED');
    }

    const payload = JSON.stringify({
      body: notification.body,
      channel: notification.channel,
      createdAt: notification.createdAt.toISOString(),
      id: notification.id,
      instanceId: notification.instanceId,
      payload: notification.payload,
      recipientMemberId: notification.recipientMemberId,
      taskId: notification.taskId,
      title: notification.title,
      type: notification.type,
    });
    const signature = createHmac('sha256', options.webhookSigningSecret)
      .update(payload)
      .digest('hex');
    const response = await fetch(options.webhookEndpointUrl, {
      body: payload,
      headers: {
        'content-type': 'application/json',
        'x-bpm-signature-sha256': signature,
      },
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error(`WEBHOOK_HTTP_${response.status}`);
    }

    return options.webhookEndpointUrl;
  }

  private async recordDeliveryFailure(
    notification: NotificationEntity,
    errorMessage: string,
    options: BPMResolvedNotificationOptions,
  ): Promise<void> {
    const attemptCount = notification.attemptCount + 1;
    const failedPermanently = attemptCount >= options.deliveryMaxAttempts;
    const now = new Date();

    await this.notificationRepository.save({
      ...notification,
      attemptCount,
      deliveryError: errorMessage,
      lastAttemptAt: now,
      nextRetryAt: failedPermanently
        ? null
        : new Date(
            now.getTime() + options.deliveryRetryBaseDelayMs * attemptCount,
          ),
      status: failedPermanently
        ? NotificationStatusEnum.FAILED
        : NotificationStatusEnum.PENDING,
    });
    this.logger.warn(
      `Notification ${notification.id} delivery failed: ${errorMessage}`,
    );
  }
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown delivery error';
}

function normalizePositiveInteger(
  value: number | undefined,
  fallback: number,
): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return fallback;
  }

  return value;
}
