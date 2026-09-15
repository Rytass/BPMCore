import {
  parseWorkflowWebhookSecretKey,
  WorkflowWebhookSecretCipher,
} from './workflow-webhook-secret-cipher';

const HEX_KEY = 'a'.repeat(64);

describe('WorkflowWebhookSecretCipher', () => {
  it('round-trips a value and never produces the same envelope twice', () => {
    const cipher = new WorkflowWebhookSecretCipher(HEX_KEY);
    const first = cipher.encrypt('Bearer 秘密-token');
    const second = cipher.encrypt('Bearer 秘密-token');

    expect(first).toMatch(/^v1:/);
    expect(first).not.toContain('秘密');
    expect(first).not.toBe(second);
    expect(cipher.decrypt(first)).toBe('Bearer 秘密-token');
  });

  it('accepts a base64 key of 32 bytes', () => {
    const base64 = Buffer.alloc(32, 7).toString('base64');

    expect(
      new WorkflowWebhookSecretCipher(base64).decrypt(
        new WorkflowWebhookSecretCipher(base64).encrypt('x'),
      ),
    ).toBe('x');
  });

  it('refuses a key of the wrong length without echoing it', () => {
    expect(() => parseWorkflowWebhookSecretKey('short-secret')).toThrow(
      /must be 32 bytes/,
    );
    expect(() => parseWorkflowWebhookSecretKey('ab'.repeat(16))).toThrow(
      /must be 32 bytes/,
    );

    try {
      parseWorkflowWebhookSecretKey('do-not-print-me');
    } catch (error: unknown) {
      expect(String(error)).not.toContain('do-not-print-me');
    }
  });

  it('fails on a different key or a tampered envelope', () => {
    const envelope = new WorkflowWebhookSecretCipher(HEX_KEY).encrypt('value');
    const other = new WorkflowWebhookSecretCipher('b'.repeat(64));
    const raw = Buffer.from(envelope.slice(3), 'base64');

    raw[raw.length - 1] ^= 1;

    expect(() => other.decrypt(envelope)).toThrow();
    expect(() =>
      new WorkflowWebhookSecretCipher(HEX_KEY).decrypt(
        `v1:${raw.toString('base64')}`,
      ),
    ).toThrow();
    expect(() =>
      new WorkflowWebhookSecretCipher(HEX_KEY).decrypt('plain'),
    ).toThrow(/Unsupported/);
  });
});
