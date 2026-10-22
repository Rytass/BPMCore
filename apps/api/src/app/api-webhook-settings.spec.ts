import {
  readApiSetting,
  readWebhookAllowedUrlPatterns,
  readWebhookSecretEncryptionKey,
} from './api-webhook-settings';

describe('api webhook settings', () => {
  const env = { ...process.env };

  afterEach((): void => {
    process.env = { ...env };
  });

  it('prefers the Vault value over the environment', async () => {
    process.env.BPM_WEBHOOK_ALLOWED_URL_PATTERNS = 'https://env.example.com/*';

    await expect(
      readApiSetting(
        async (): Promise<unknown> => 'https://vault.example.com/*',
        'BPM_WEBHOOK_ALLOWED_URL_PATTERNS',
      ),
    ).resolves.toBe('https://vault.example.com/*');
  });

  it('falls back to the environment when Vault has nothing or fails', async () => {
    process.env.BPM_WEBHOOK_ALLOWED_URL_PATTERNS = 'https://env.example.com/*';

    await expect(
      readApiSetting(
        async (): Promise<unknown> => '',
        'BPM_WEBHOOK_ALLOWED_URL_PATTERNS',
      ),
    ).resolves.toBe('https://env.example.com/*');
    await expect(
      readApiSetting(
        (): Promise<unknown> => Promise.reject(new Error('down')),
        'BPM_WEBHOOK_ALLOWED_URL_PATTERNS',
      ),
    ).resolves.toBe('https://env.example.com/*');
  });

  it('gives production no allowlist or key by default', () => {
    process.env.NODE_ENV = 'production';

    expect(readWebhookAllowedUrlPatterns(undefined)).toEqual([]);
    expect(readWebhookSecretEncryptionKey(undefined)).toBeUndefined();
  });

  it('splits a comma-separated allowlist', () => {
    process.env.NODE_ENV = 'production';

    expect(
      readWebhookAllowedUrlPatterns(
        ' https://**.rytass.info/* , https://a.example.com/hooks/* ,',
      ),
    ).toEqual(['https://**.rytass.info/*', 'https://a.example.com/hooks/*']);
  });

  it('allows the local demo receiver and a development key outside production', () => {
    process.env.NODE_ENV = 'development';
    process.env.PORT = '17603';

    expect(readWebhookAllowedUrlPatterns(undefined)).toEqual([
      'http://localhost:17603/demo/webhook-sink/*',
    ]);
    expect(readWebhookSecretEncryptionKey(undefined)).toHaveLength(64);
  });
});
