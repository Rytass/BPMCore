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
import { NotificationPreferenceEntity } from './notification-preference.entity';
import { NotificationEntity } from './notification.entity';
import {
  NotificationChannelEnum,
  NotificationDigestModeEnum,
  NotificationStatusEnum,
} from './notification.enums';
import { BPMResolvedNotificationOptions } from './notification-options';

@Injectable()
export class NotificationDeliveryService {
  private readonly logger = new Logger(NotificationDeliveryService.name);

  constructor(
    @InjectRepository(NotificationEntity)
    private readonly notificationRepository: Repository<NotificationEntity>,
    @InjectRepository(NotificationPreferenceEntity)
    private readonly notificationPreferenceRepository: Repository<NotificationPreferenceEntity>,
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
    const { digests, individual } =
      await this.groupDigestBatches(pendingNotifications);
    const results = await Promise.all([
      ...individual.map((notification) =>
        this.deliverNotification(notification, options),
      ),
      ...digests.map((batch) => this.deliverDigest(batch, options)),
    ]);

    // `deliverNotification` reports a boolean per row and `deliverDigest` a
    // row count, so both coerce to "notifications delivered".
    return results.reduce<number>((total, result) => total + Number(result), 0);
  }

  /**
   * Splits a claimed batch into recipients who asked for a daily digest and
   * everyone else.
   *
   * Only email digests, and only when a recipient has more than one row
   * waiting — a "digest" of a single notification is just that notification
   * with a worse subject line.
   */
  private async groupDigestBatches(
    notifications: readonly NotificationEntity[],
  ): Promise<{
    readonly digests: readonly (readonly NotificationEntity[])[];
    readonly individual: readonly NotificationEntity[];
  }> {
    const emailNotifications = notifications.filter(
      (notification) => notification.channel === NotificationChannelEnum.EMAIL,
    );

    if (emailNotifications.length === 0) {
      return { digests: [], individual: notifications };
    }

    const digestMemberIds = await this.readDailyDigestMemberIds(
      uniqueStrings(
        emailNotifications.map(
          (notification) => notification.recipientMemberId,
        ),
      ),
    );
    const byRecipient = emailNotifications.reduce<
      Map<string, NotificationEntity[]>
    >((groups, notification) => {
      if (!digestMemberIds.has(notification.recipientMemberId)) {
        return groups;
      }

      const group = groups.get(notification.recipientMemberId) ?? [];

      group.push(notification);
      groups.set(notification.recipientMemberId, group);

      return groups;
    }, new Map());
    const digests = [...byRecipient.values()].filter(
      (group) => group.length > 1,
    );
    const digestedIds = new Set(
      digests.flatMap((group) => group.map((notification) => notification.id)),
    );

    return {
      digests,
      individual: notifications.filter(
        (notification) => !digestedIds.has(notification.id),
      ),
    };
  }

  private async readDailyDigestMemberIds(
    memberIds: readonly string[],
  ): Promise<ReadonlySet<string>> {
    if (memberIds.length === 0) {
      return new Set();
    }

    const preferences = await this.notificationPreferenceRepository.find({
      where: { memberId: In([...memberIds]) },
    });

    return new Set(
      preferences
        .filter(
          (preference) =>
            preference.emailDigestMode === NotificationDigestModeEnum.DAILY,
        )
        .map((preference) => preference.memberId),
    );
  }

  /**
   * Sends one message covering a recipient's held notifications and marks all
   * of them delivered, so a member on `DAILY` gets one email rather than one
   * per approval that happened overnight.
   *
   * Returns how many rows were delivered, so the scan's count still reflects
   * notifications rather than messages.
   */
  private async deliverDigest(
    notifications: readonly NotificationEntity[],
    options: BPMResolvedNotificationOptions,
  ): Promise<number> {
    try {
      const deliveryTarget = await this.dispatchDigest(notifications, options);
      const deliveredAt = new Date();

      await this.notificationRepository.save(
        notifications.map((notification) => ({
          ...notification,
          attemptCount: notification.attemptCount + 1,
          deliveredAt,
          deliveryError: null,
          deliveryTarget,
          lastAttemptAt: deliveredAt,
          nextRetryAt: null,
          sentAt: deliveredAt,
          status: NotificationStatusEnum.SENT,
        })),
      );

      return notifications.length;
    } catch (error: unknown) {
      const errorMessage = readErrorMessage(error);

      // Recorded per row: a digest that fails must leave each notification
      // retryable on its own terms, not strand the whole batch.
      await Promise.all(
        notifications.map((notification) =>
          this.recordDeliveryFailure(notification, errorMessage, options),
        ),
      );

      return 0;
    }
  }

  private async dispatchDigest(
    notifications: readonly NotificationEntity[],
    options: BPMResolvedNotificationOptions,
  ): Promise<string> {
    const hostDispatcher = this.readHostDispatcher();

    if (hostDispatcher?.dispatchDigest) {
      return hostDispatcher.dispatchDigest(notifications, options);
    }

    if (hostDispatcher) {
      // The host owns delivery and cannot combine, so honour the hold but not
      // the merge: every row still goes out now, at the digest hour.
      const targets = await notifications.reduce<Promise<readonly string[]>>(
        async (previousPromise, notification) => [
          ...(await previousPromise),
          await hostDispatcher.dispatch(notification, options),
        ],
        Promise.resolve([]),
      );

      return targets[0] ?? '';
    }

    return this.dispatchDigestEmail(notifications, options);
  }

  private async dispatchDigestEmail(
    notifications: readonly NotificationEntity[],
    options: BPMResolvedNotificationOptions,
  ): Promise<string> {
    const transporter = this.createEmailTransport(options);
    const recipientEmail = await this.readRecipientEmail(
      notifications[0].recipientMemberId,
    );

    await transporter.sendMail({
      from: options.emailFrom ?? '',
      subject: `BPM 通知摘要（${notifications.length} 則）`,
      text: notifications
        .map((notification) => `${notification.title}\n${notification.body}`)
        .join('\n\n---\n\n'),
      to: recipientEmail,
    });

    return recipientEmail;
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
    const transporter = this.createEmailTransport(options);
    const recipientEmail = await this.readRecipientEmail(
      notification.recipientMemberId,
    );

    await transporter.sendMail({
      from: options.emailFrom ?? '',
      subject: notification.title,
      text: notification.body,
      to: recipientEmail,
    });

    return recipientEmail;
  }

  private createEmailTransport(
    options: BPMResolvedNotificationOptions,
  ): nodemailer.Transporter {
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

    return nodemailer.createTransport({
      auth: {
        pass: options.emailSmtpPassword,
        user: options.emailSmtpUsername,
      },
      host: options.emailSmtpHost,
      port: options.emailSmtpPort,
      secure: options.emailSmtpSecure,
    });
  }

  private async readRecipientEmail(memberId: string): Promise<string> {
    const identityService = this.moduleRef.get(IdentityService, {
      strict: false,
    });
    const recipient = await identityService.resolveMember(memberId);

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

function uniqueStrings(values: readonly string[]): readonly string[] {
  return Array.from(new Set(values));
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
