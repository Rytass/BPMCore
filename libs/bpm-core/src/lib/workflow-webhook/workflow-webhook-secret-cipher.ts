import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const ENVELOPE_PREFIX = 'v1:';

/**
 * Reads `workflowWebhookSecretEncryptionKey`: 32 bytes as 64 hex characters or
 * base64. Anything else throws at boot, because a key that silently decodes
 * to the wrong length would encrypt everything with a key nobody can
 * reproduce. The message never echoes the key.
 */
export function parseWorkflowWebhookSecretKey(value: string): Buffer {
  const trimmed = value.trim();
  const decoded = /^[0-9a-fA-F]{64}$/u.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : /^[A-Za-z0-9+/]+={0,2}$/u.test(trimmed)
      ? Buffer.from(trimmed, 'base64')
      : null;

  if (!decoded || decoded.length !== KEY_BYTES) {
    throw new Error(
      'workflowWebhookSecretEncryptionKey must be 32 bytes, as 64 hex characters or base64',
    );
  }

  return decoded;
}

/**
 * AES-256-GCM for the header values and signing secrets of database-managed
 * webhook endpoints (ADR 18 §3.13). The envelope is
 * `v1:<base64(iv | tag | ciphertext)>`, so a future key or algorithm change
 * can tell old values apart. Decryption fails loudly on a wrong key or a
 * tampered value instead of returning garbage.
 */
export class WorkflowWebhookSecretCipher {
  private readonly key: Buffer;

  constructor(key: string) {
    this.key = parseWorkflowWebhookSecretKey(key);
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    return `${ENVELOPE_PREFIX}${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64')}`;
  }

  decrypt(envelope: string): string {
    if (!envelope.startsWith(ENVELOPE_PREFIX)) {
      throw new Error('Unsupported webhook secret envelope');
    }

    const raw = Buffer.from(envelope.slice(ENVELOPE_PREFIX.length), 'base64');

    if (raw.length < IV_BYTES + TAG_BYTES) {
      throw new Error('Malformed webhook secret envelope');
    }

    const decipher = createDecipheriv(
      ALGORITHM,
      this.key,
      raw.subarray(0, IV_BYTES),
    );

    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));

    return Buffer.concat([
      decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8');
  }
}
