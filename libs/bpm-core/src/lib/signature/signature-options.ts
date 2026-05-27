import { InjectionToken } from '@nestjs/common';

export interface BPMSignatureKeyProvider {
  readKey(keyVersion: number): Promise<string | null> | string | null;
}

export interface BPMSignatureTimestampInput {
  readonly signedAt: Date;
  readonly signedPayloadHash: string;
}

export interface BPMSignatureTimestampProvider {
  createTimestampToken(
    input: BPMSignatureTimestampInput,
  ): Promise<Buffer> | Buffer;
}

export interface BPMRootSignatureOptions {
  /**
   * Current signature key version used for newly created signatures.
   */
  readonly signatureCurrentKeyVersion?: number;

  /**
   * Host-provided key provider used to sign and verify signature records.
   */
  readonly signatureKeyProvider?: BPMSignatureKeyProvider;

  /**
   * Host-provided timestamp provider used to stamp signed payloads.
   */
  readonly signatureTimestampProvider?: BPMSignatureTimestampProvider;
}

export interface BPMResolvedSignatureOptions {
  readonly currentKeyVersion: number;
  readonly keyProvider: BPMSignatureKeyProvider;
  readonly timestampProvider: BPMSignatureTimestampProvider;
}

const DEFAULT_KEY_VERSION = 1;
const DEFAULT_SIGNATURE_KEYS: Readonly<Record<number, string>> = {
  [DEFAULT_KEY_VERSION]: 'bpm-core-local-signature-key-v1',
};

const defaultKeyProvider: BPMSignatureKeyProvider = {
  readKey: (keyVersion: number): string | null =>
    DEFAULT_SIGNATURE_KEYS[keyVersion] ?? null,
};

const defaultTimestampProvider: BPMSignatureTimestampProvider = {
  createTimestampToken: ({
    signedAt,
    signedPayloadHash,
  }: BPMSignatureTimestampInput): Buffer =>
    Buffer.from(
      JSON.stringify({
        provider: 'mock-rfc3161',
        signedAt: signedAt.toISOString(),
        signedPayloadHash,
      }),
      'utf8',
    ),
};

export const BPM_SIGNATURE_OPTIONS: InjectionToken<BPMResolvedSignatureOptions> =
  Symbol('BPM_SIGNATURE_OPTIONS');

export const DEFAULT_BPM_SIGNATURE_OPTIONS: BPMResolvedSignatureOptions = {
  currentKeyVersion: DEFAULT_KEY_VERSION,
  keyProvider: defaultKeyProvider,
  timestampProvider: defaultTimestampProvider,
};

export function resolveBPMSignatureOptions(
  options: BPMRootSignatureOptions = {},
): BPMResolvedSignatureOptions {
  const usingDefaultKeyProvider = !options.signatureKeyProvider;
  const usingDefaultTimestampProvider = !options.signatureTimestampProvider;

  if (
    (usingDefaultKeyProvider || usingDefaultTimestampProvider) &&
    process.env.NODE_ENV === 'production'
  ) {
    // eslint-disable-next-line no-console
    console.warn(
      `[@rytass/bpm-core-nestjs-module] decision signatures are using built-in local development providers (${
        [
          usingDefaultKeyProvider ? 'signatureKeyProvider' : null,
          usingDefaultTimestampProvider ? 'signatureTimestampProvider' : null,
        ]
          .filter(Boolean)
          .join(', ')
      }). Replace them with KMS / Vault / RFC3161 providers before serving production traffic — signature chains would otherwise be unverifiable on rotation.`,
    );
  }

  return {
    currentKeyVersion: normalizePositiveInteger(
      options.signatureCurrentKeyVersion,
      DEFAULT_BPM_SIGNATURE_OPTIONS.currentKeyVersion,
    ),
    keyProvider:
      options.signatureKeyProvider ?? DEFAULT_BPM_SIGNATURE_OPTIONS.keyProvider,
    timestampProvider:
      options.signatureTimestampProvider ??
      DEFAULT_BPM_SIGNATURE_OPTIONS.timestampProvider,
  };
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
