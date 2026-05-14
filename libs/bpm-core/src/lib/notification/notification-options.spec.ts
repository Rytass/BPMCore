import { resolveBPMNotificationOptions } from './notification-options';

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
});
