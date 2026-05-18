import { InjectionToken } from '@nestjs/common';
import {
  NotificationChannelEnum,
  NotificationDigestModeEnum,
} from './notification.enums';

export type NotificationFeatureToggle = boolean | 'auto';

export type NotificationTemplateEngine = 'handlebars' | 'simple';

export interface BPMRootNotificationOptions {
  /**
   * Enables creation and display of in-app notification records.
   *
   * Defaults to `true`. Set to `false` only when the host application wants
   * BPM to run without notification center data.
   */
  readonly notificationInAppEnabled?: boolean;

  /**
   * Controls whether BPM may create and dispatch email notifications.
   *
   * Use `auto` to enable email only when all SMTP connection fields are
   * present. Use `false` to force email off even when SMTP secrets exist.
   * Defaults to `auto`.
   */
  readonly notificationEmailEnabled?: NotificationFeatureToggle;

  /**
   * SMTP server hostname used for BPM email delivery.
   *
   * Required when `notificationEmailEnabled` is `true`; required for auto
   * enablement when `notificationEmailEnabled` is `auto`.
   */
  readonly notificationEmailSmtpHost?: string | null;

  /**
   * SMTP server port used for BPM email delivery.
   *
   * Common values are `587` for STARTTLS and `465` for implicit TLS. Required
   * when `notificationEmailEnabled` is `true`; required for auto enablement
   * when `notificationEmailEnabled` is `auto`.
   */
  readonly notificationEmailSmtpPort?: number | null;

  /**
   * Whether the SMTP connection should use implicit TLS.
   *
   * Use `false` for STARTTLS on port `587`; use `true` for implicit TLS on
   * port `465`. Defaults to `false`.
   */
  readonly notificationEmailSmtpSecure?: boolean;

  /**
   * SMTP authentication username used by BPM email delivery.
   *
   * Required when `notificationEmailEnabled` is `true`; required for auto
   * enablement when `notificationEmailEnabled` is `auto`.
   */
  readonly notificationEmailSmtpUsername?: string | null;

  /**
   * SMTP authentication password or app password used by BPM email delivery.
   *
   * Required when `notificationEmailEnabled` is `true`; required for auto
   * enablement when `notificationEmailEnabled` is `auto`.
   */
  readonly notificationEmailSmtpPassword?: string | null;

  /**
   * Sender address used for BPM email delivery.
   *
   * Accepts either an email address or an RFC 5322 display format such as
   * `BPM <bpm@example.com>`. Required when email delivery is enabled.
   */
  readonly notificationEmailFrom?: string | null;

  /**
   * Controls whether BPM may create and dispatch webhook notifications.
   *
   * Use `auto` to enable webhooks only when
   * `notificationWebhookSigningSecret` is present. Use `false` to force
   * webhooks off. Defaults to `auto`.
   */
  readonly notificationWebhookEnabled?: NotificationFeatureToggle;

  /**
   * Secret used to sign BPM webhook payloads.
   *
   * Required when `notificationWebhookEnabled` is `true`; required for auto
   * enablement when `notificationWebhookEnabled` is `auto`.
   */
  readonly notificationWebhookSigningSecret?: string | null;

  /**
   * Default endpoint URL used for BPM webhook notification delivery.
   *
   * Required when `notificationWebhookEnabled` is `true`; required for auto
   * enablement when `notificationWebhookEnabled` is `auto`.
   */
  readonly notificationWebhookEndpointUrl?: string | null;

  /**
   * Enables the background delivery scheduler for pending email and webhook
   * notifications.
   *
   * Defaults to `false`. Set to `true` only in a dedicated worker process or
   * single-replica host that should run notification delivery itself.
   */
  readonly notificationDeliverySchedulerEnabled?: boolean;

  /**
   * Interval in milliseconds between pending notification delivery scans.
   *
   * Defaults to `30000`. Values below `1000` are normalized to `1000` to avoid
   * tight loops in long-running API processes.
   */
  readonly notificationDeliveryScanIntervalMs?: number;

  /**
   * Maximum pending notifications processed by each delivery scan.
   */
  readonly notificationDeliveryBatchSize?: number;

  /**
   * Maximum delivery attempts before a pending email/webhook notification is
   * marked failed.
   */
  readonly notificationDeliveryMaxAttempts?: number;

  /**
   * Base retry delay in milliseconds. Retry scheduling multiplies this value
   * by the current attempt count.
   */
  readonly notificationDeliveryRetryBaseDelayMs?: number;

  /**
   * Enables the background SLA scheduler that scans pending tasks.
   *
   * Defaults to `false`. Set to `true` only in a dedicated worker process or
   * single-replica host that should run SLA scans itself.
   */
  readonly notificationSlaSchedulerEnabled?: boolean;

  /**
   * Interval in milliseconds between automatic SLA scans.
   *
   * Defaults to `60000`. Values below `1000` are normalized to `1000` to avoid
   * tight loops in long-running API processes.
   */
  readonly notificationSlaScanIntervalMs?: number;

  /**
   * Enables the SLA timeout `REMIND` action.
   *
   * Defaults to `true`. When disabled, overdue tasks with `REMIND` timeout
   * policy still keep their task state, but the timeout action hook is skipped.
   */
  readonly notificationSlaTimeoutRemindEnabled?: boolean;

  /**
   * Enables the SLA timeout `AUTO_APPROVE` action.
   *
   * Defaults to `false` because this action changes workflow state and should
   * be explicitly enabled by the host application.
   */
  readonly notificationSlaTimeoutAutoApproveEnabled?: boolean;

  /**
   * Enables the SLA timeout `ESCALATE` action.
   *
   * Defaults to `false` because escalation changes task assignment and should
   * be explicitly enabled by the host application.
   */
  readonly notificationSlaTimeoutEscalateEnabled?: boolean;

  /**
   * Enables the SLA timeout `TERMINATE_INSTANCE` action.
   *
   * Defaults to `false` because termination changes instance state and should
   * be explicitly enabled by the host application.
   */
  readonly notificationSlaTimeoutTerminateInstanceEnabled?: boolean;

  /**
   * Template engine used to render notification title and body text.
   *
   * `simple` uses BPM's built-in `{{path}}` replacement renderer. `handlebars`
   * reserves the host configuration for the Handlebars renderer once the email
   * template implementation is wired. Defaults to `simple`.
   */
  readonly notificationTemplateEngine?: NotificationTemplateEngine;

  /**
   * Channels used when a workflow node does not specify notification channels.
   */
  readonly notificationDefaultChannels?: readonly NotificationChannelEnum[];

  /**
   * Default email digest mode for members without a stored preference.
   */
  readonly notificationDefaultEmailDigestMode?: NotificationDigestModeEnum;

  /**
   * Default in-app notification preference for members without a stored
   * preference.
   */
  readonly notificationDefaultInAppPreferenceEnabled?: boolean;

  /**
   * Default email notification preference for members without a stored
   * preference.
   */
  readonly notificationDefaultEmailPreferenceEnabled?: boolean;
}

export interface BPMResolvedNotificationOptions {
  readonly emailEnabled: boolean;
  readonly emailFrom: string | null;
  readonly emailSmtpHost: string | null;
  readonly emailSmtpPassword: string | null;
  readonly emailSmtpPort: number | null;
  readonly emailSmtpSecure: boolean;
  readonly emailSmtpUsername: string | null;
  readonly inAppEnabled: boolean;
  readonly defaultChannels: readonly NotificationChannelEnum[];
  readonly defaultEmailDigestMode: NotificationDigestModeEnum;
  readonly defaultEmailPreferenceEnabled: boolean;
  readonly defaultInAppPreferenceEnabled: boolean;
  readonly deliveryBatchSize: number;
  readonly deliveryMaxAttempts: number;
  readonly deliveryRetryBaseDelayMs: number;
  readonly deliveryScanIntervalMs: number;
  readonly deliverySchedulerEnabled: boolean;
  readonly slaScanIntervalMs: number;
  readonly slaSchedulerEnabled: boolean;
  readonly slaTimeoutAutoApproveEnabled: boolean;
  readonly slaTimeoutEscalateEnabled: boolean;
  readonly slaTimeoutRemindEnabled: boolean;
  readonly slaTimeoutTerminateInstanceEnabled: boolean;
  readonly templateEngine: NotificationTemplateEngine;
  readonly webhookEnabled: boolean;
  readonly webhookEndpointUrl: string | null;
  readonly webhookSigningSecret: string | null;
}

export const BPM_NOTIFICATION_OPTIONS: InjectionToken<BPMResolvedNotificationOptions> =
  Symbol('BPM_NOTIFICATION_OPTIONS');

export const DEFAULT_BPM_NOTIFICATION_OPTIONS: BPMResolvedNotificationOptions =
  {
    emailEnabled: false,
    emailFrom: null,
    emailSmtpHost: null,
    emailSmtpPassword: null,
    emailSmtpPort: null,
    emailSmtpSecure: false,
    emailSmtpUsername: null,
    inAppEnabled: true,
    defaultChannels: [NotificationChannelEnum.IN_APP],
    defaultEmailDigestMode: NotificationDigestModeEnum.INSTANT,
    defaultEmailPreferenceEnabled: true,
    defaultInAppPreferenceEnabled: true,
    deliveryBatchSize: 25,
    deliveryMaxAttempts: 3,
    deliveryRetryBaseDelayMs: 60_000,
    deliveryScanIntervalMs: 30_000,
    deliverySchedulerEnabled: false,
    slaScanIntervalMs: 60_000,
    slaSchedulerEnabled: false,
    slaTimeoutAutoApproveEnabled: false,
    slaTimeoutEscalateEnabled: false,
    slaTimeoutRemindEnabled: true,
    slaTimeoutTerminateInstanceEnabled: false,
    templateEngine: 'simple',
    webhookEndpointUrl: null,
    webhookEnabled: false,
    webhookSigningSecret: null,
  };

export function resolveBPMNotificationOptions(
  options: BPMRootNotificationOptions = {},
): BPMResolvedNotificationOptions {
  const emailSmtpHost = normalizeText(options.notificationEmailSmtpHost);
  const emailSmtpPort = normalizePort(options.notificationEmailSmtpPort);
  const emailSmtpUsername = normalizeText(
    options.notificationEmailSmtpUsername,
  );
  const emailSmtpPassword = normalizeText(
    options.notificationEmailSmtpPassword,
  );
  const emailFrom = normalizeText(options.notificationEmailFrom);
  const webhookSigningSecret = normalizeText(
    options.notificationWebhookSigningSecret,
  );
  const webhookEndpointUrl = normalizeText(
    options.notificationWebhookEndpointUrl,
  );

  return {
    deliveryScanIntervalMs: normalizeInterval(
      options.notificationDeliveryScanIntervalMs,
      DEFAULT_BPM_NOTIFICATION_OPTIONS.deliveryScanIntervalMs,
    ),
    deliveryBatchSize: normalizePositiveInteger(
      options.notificationDeliveryBatchSize,
      DEFAULT_BPM_NOTIFICATION_OPTIONS.deliveryBatchSize,
    ),
    deliveryMaxAttempts: normalizePositiveInteger(
      options.notificationDeliveryMaxAttempts,
      DEFAULT_BPM_NOTIFICATION_OPTIONS.deliveryMaxAttempts,
    ),
    deliveryRetryBaseDelayMs: normalizeInterval(
      options.notificationDeliveryRetryBaseDelayMs,
      DEFAULT_BPM_NOTIFICATION_OPTIONS.deliveryRetryBaseDelayMs,
    ),
    deliverySchedulerEnabled:
      options.notificationDeliverySchedulerEnabled ??
      DEFAULT_BPM_NOTIFICATION_OPTIONS.deliverySchedulerEnabled,
    emailEnabled: resolveToggle(
      options.notificationEmailEnabled ?? 'auto',
      Boolean(
        emailSmtpHost &&
        emailSmtpPort &&
        emailSmtpUsername &&
        emailSmtpPassword &&
        emailFrom,
      ),
    ),
    emailFrom,
    emailSmtpHost,
    emailSmtpPassword,
    emailSmtpPort,
    emailSmtpSecure: options.notificationEmailSmtpSecure ?? false,
    emailSmtpUsername,
    inAppEnabled:
      options.notificationInAppEnabled ??
      DEFAULT_BPM_NOTIFICATION_OPTIONS.inAppEnabled,
    defaultChannels: normalizeChannels(options.notificationDefaultChannels),
    defaultEmailDigestMode: isNotificationDigestMode(
      options.notificationDefaultEmailDigestMode,
    )
      ? options.notificationDefaultEmailDigestMode
      : DEFAULT_BPM_NOTIFICATION_OPTIONS.defaultEmailDigestMode,
    defaultEmailPreferenceEnabled:
      options.notificationDefaultEmailPreferenceEnabled ??
      DEFAULT_BPM_NOTIFICATION_OPTIONS.defaultEmailPreferenceEnabled,
    defaultInAppPreferenceEnabled:
      options.notificationDefaultInAppPreferenceEnabled ??
      DEFAULT_BPM_NOTIFICATION_OPTIONS.defaultInAppPreferenceEnabled,
    slaScanIntervalMs: normalizeInterval(
      options.notificationSlaScanIntervalMs,
      DEFAULT_BPM_NOTIFICATION_OPTIONS.slaScanIntervalMs,
    ),
    slaSchedulerEnabled:
      options.notificationSlaSchedulerEnabled ??
      DEFAULT_BPM_NOTIFICATION_OPTIONS.slaSchedulerEnabled,
    slaTimeoutAutoApproveEnabled:
      options.notificationSlaTimeoutAutoApproveEnabled ??
      DEFAULT_BPM_NOTIFICATION_OPTIONS.slaTimeoutAutoApproveEnabled,
    slaTimeoutEscalateEnabled:
      options.notificationSlaTimeoutEscalateEnabled ??
      DEFAULT_BPM_NOTIFICATION_OPTIONS.slaTimeoutEscalateEnabled,
    slaTimeoutRemindEnabled:
      options.notificationSlaTimeoutRemindEnabled ??
      DEFAULT_BPM_NOTIFICATION_OPTIONS.slaTimeoutRemindEnabled,
    slaTimeoutTerminateInstanceEnabled:
      options.notificationSlaTimeoutTerminateInstanceEnabled ??
      DEFAULT_BPM_NOTIFICATION_OPTIONS.slaTimeoutTerminateInstanceEnabled,
    templateEngine:
      options.notificationTemplateEngine ??
      DEFAULT_BPM_NOTIFICATION_OPTIONS.templateEngine,
    webhookEnabled: resolveToggle(
      options.notificationWebhookEnabled ?? 'auto',
      Boolean(webhookEndpointUrl && webhookSigningSecret),
    ),
    webhookEndpointUrl,
    webhookSigningSecret,
  };
}

function resolveToggle(
  toggle: NotificationFeatureToggle,
  autoValue: boolean,
): boolean {
  return toggle === 'auto' ? autoValue : toggle;
}

function normalizeText(value: string | null | undefined): string | null {
  const trimmedValue = value?.trim() ?? '';

  return trimmedValue || null;
}

function normalizePort(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function normalizeInterval(
  value: number | undefined,
  fallback: number,
): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return fallback;
  }

  return Math.max(value, 1000);
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

function normalizeChannels(
  channels: readonly NotificationChannelEnum[] | undefined,
): readonly NotificationChannelEnum[] {
  const normalizedChannels =
    channels
      ?.filter(isNotificationChannel)
      .filter(
        (channel, index, allChannels) => allChannels.indexOf(channel) === index,
      ) ?? [];

  return normalizedChannels.length
    ? normalizedChannels
    : DEFAULT_BPM_NOTIFICATION_OPTIONS.defaultChannels;
}

function isNotificationChannel(
  value: unknown,
): value is NotificationChannelEnum {
  return Object.values(NotificationChannelEnum).includes(
    value as NotificationChannelEnum,
  );
}

function isNotificationDigestMode(
  value: unknown,
): value is NotificationDigestModeEnum {
  return Object.values(NotificationDigestModeEnum).includes(
    value as NotificationDigestModeEnum,
  );
}
