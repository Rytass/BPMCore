export const WEBHOOK_ALLOWED_URL_PATTERNS_KEY =
  'BPM_WEBHOOK_ALLOWED_URL_PATTERNS';
export const WEBHOOK_SECRET_ENCRYPTION_KEY_KEY =
  'BPM_WEBHOOK_SECRET_ENCRYPTION_KEY';

/**
 * A setting from the selected Vault path first, then the process environment
 * (Kubernetes `vault-secret`), as the demo webhook signing secret is read.
 * An unreachable Vault falls through to the environment rather than failing
 * the boot.
 */
export async function readApiSetting(
  readVaultValue: (key: string) => Promise<unknown>,
  key: string,
): Promise<string | undefined> {
  const vaultValue = await readVaultValue(key).catch((): unknown => null);

  if (typeof vaultValue === 'string' && vaultValue.trim()) {
    return vaultValue;
  }

  return process.env[key] || undefined;
}

/**
 * `BPM_WEBHOOK_ALLOWED_URL_PATTERNS` is a comma-separated list. Outside
 * production the local demo receiver is allowed by default, named by its
 * literal host (a wildcard host never matches localhost).
 */
export function readWebhookAllowedUrlPatterns(
  value: string | undefined,
): readonly string[] {
  const configured = (value ?? '')
    .split(',')
    .map((pattern) => pattern.trim())
    .filter(Boolean);

  if (configured.length || process.env.NODE_ENV === 'production') {
    return configured;
  }

  return [`http://localhost:${process.env.PORT ?? 17603}/demo/webhook-sink/*`];
}

/**
 * 32 bytes as hex or base64 from `BPM_WEBHOOK_SECRET_ENCRYPTION_KEY`. Outside
 * production a fixed development key applies so the demo works out of the
 * box; production gets no default, which leaves database endpoints off.
 */
export function readWebhookSecretEncryptionKey(
  value: string | undefined,
): string | undefined {
  return (
    value ||
    (process.env.NODE_ENV === 'production'
      ? undefined
      : '6270d2d56465762d776562686f6f6b2d7365637265742d6b65792d3332627974')
  );
}
