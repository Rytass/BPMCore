import { resolveBPMNotificationOptions } from './notification-options';
import {
  NotificationChannelEnum,
  NotificationDigestModeEnum,
} from './notification.enums';

describe('resolveBPMNotificationOptions', () => {
  it('enables email automatically only when all SMTP fields are present', (): void => {
    expect(
      resolveBPMNotificationOptions({
        notificationEmailEnabled: 'auto',
        notificationEmailFrom: 'BPM <bpm@example.com>',
        notificationEmailSmtpHost: 'smtp.example.com',
        notificationEmailSmtpPassword: 'secret',
        notificationEmailSmtpPort: 587,
        notificationEmailSmtpUsername: 'bpm@example.com',
      }).emailEnabled,
    ).toBe(true);

    expect(
      resolveBPMNotificationOptions({
        notificationEmailEnabled: 'auto',
        notificationEmailFrom: 'BPM <bpm@example.com>',
        notificationEmailSmtpHost: 'smtp.example.com',
        notificationEmailSmtpPort: 587,
        notificationEmailSmtpUsername: 'bpm@example.com',
      }).emailEnabled,
    ).toBe(false);
  });

  it('allows explicit notification toggles to override auto detection', (): void => {
    expect(
      resolveBPMNotificationOptions({
        notificationEmailEnabled: false,
        notificationEmailFrom: 'BPM <bpm@example.com>',
        notificationEmailSmtpHost: 'smtp.example.com',
        notificationEmailSmtpPassword: 'secret',
        notificationEmailSmtpPort: 587,
        notificationEmailSmtpUsername: 'bpm@example.com',
      }).emailEnabled,
    ).toBe(false);

    expect(
      resolveBPMNotificationOptions({
        notificationWebhookEnabled: true,
      }).webhookEnabled,
    ).toBe(true);
  });

  it('normalizes webhook and SLA scheduler options', (): void => {
    const options = resolveBPMNotificationOptions({
      notificationSlaScanIntervalMs: 10,
      notificationWebhookEnabled: 'auto',
      notificationWebhookEndpointUrl: ' https://example.com/bpm-webhook ',
      notificationWebhookSigningSecret: ' webhook-secret ',
    });

    expect(options.deliveryScanIntervalMs).toBe(30_000);
    expect(options.slaScanIntervalMs).toBe(1000);
    expect(options.webhookEnabled).toBe(true);
    expect(options.webhookEndpointUrl).toBe('https://example.com/bpm-webhook');
    expect(options.webhookSigningSecret).toBe('webhook-secret');
  });

  it('normalizes delivery policy and default notification preferences', (): void => {
    const options = resolveBPMNotificationOptions({
      notificationDefaultChannels: [
        NotificationChannelEnum.EMAIL,
        NotificationChannelEnum.EMAIL,
        NotificationChannelEnum.WEBHOOK,
      ],
      notificationDefaultEmailDigestMode: NotificationDigestModeEnum.DAILY,
      notificationDefaultEmailPreferenceEnabled: false,
      notificationDefaultInAppPreferenceEnabled: false,
      notificationDeliveryBatchSize: 5,
      notificationDeliveryMaxAttempts: 4,
      notificationDeliveryRetryBaseDelayMs: 10,
    });

    expect(options.defaultChannels).toEqual([
      NotificationChannelEnum.EMAIL,
      NotificationChannelEnum.WEBHOOK,
    ]);
    expect(options.defaultEmailDigestMode).toBe(
      NotificationDigestModeEnum.DAILY,
    );
    expect(options.defaultEmailPreferenceEnabled).toBe(false);
    expect(options.defaultInAppPreferenceEnabled).toBe(false);
    expect(options.deliveryBatchSize).toBe(5);
    expect(options.deliveryMaxAttempts).toBe(4);
    expect(options.deliveryRetryBaseDelayMs).toBe(1000);
  });

  it('defaults the business calendar time zone to UTC', (): void => {
    expect(resolveBPMNotificationOptions({}).slaBusinessCalendarTimeZone).toBe(
      'UTC',
    );
  });

  it('accepts a valid IANA business calendar time zone', (): void => {
    expect(
      resolveBPMNotificationOptions({
        notificationSlaBusinessCalendarTimeZone: 'Asia/Taipei',
      }).slaBusinessCalendarTimeZone,
    ).toBe('Asia/Taipei');
  });

  it('falls back to UTC for an unknown time zone instead of throwing later', (): void => {
    expect(
      resolveBPMNotificationOptions({
        notificationSlaBusinessCalendarTimeZone: 'Mars/Olympus',
      }).slaBusinessCalendarTimeZone,
    ).toBe('UTC');
  });
});
