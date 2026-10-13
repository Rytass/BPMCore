import { InjectionToken } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

export interface BPMRootAttachmentOptions {
  /**
   * Public HTTP base URL used to build signed attachment download and preview
   * URLs.
   *
   * Optional: when unset, each URL is built from the origin of the GraphQL
   * request that asked for it (`X-Forwarded-Proto` / `X-Forwarded-Host`, else
   * the request's own protocol and `Host`), so a host behind a proxy or on
   * localhost gets a working link without configuring it.
   */
  readonly attachmentPublicBaseUrl?: string | null;

  /**
   * Route prefix used by the host application for BPM attachment endpoints.
   *
   * Drives both the Nest controller mount path and the path embedded in BPM
   * signed attachment URLs. Defaults to `/attachments`.
   */
  readonly attachmentRoutePrefix?: string | null;

  /**
   * @deprecated No longer has any effect. An unset
   * `attachmentSignedUrlSecret` now gets a random per-process secret instead
   * of a built-in one, so there is nothing insecure left to acknowledge.
   */
  readonly attachmentAllowInsecureSignedUrlSecret?: boolean;

  /**
   * HMAC secret used to sign attachment download and preview tokens.
   *
   * Optional: when unset, every process generates its own random secret at
   * boot and warns on stderr. That keeps the URLs unforgeable, but a URL only
   * verifies on the process that signed it — set a shared secret once the API
   * runs more than one replica, or when a restart must not invalidate the
   * links handed out in the last `attachmentSignedUrlTtlSeconds`.
   */
  readonly attachmentSignedUrlSecret?: string | null;

  /**
   * Signed attachment URL lifetime in seconds.
   */
  readonly attachmentSignedUrlTtlSeconds?: number;

  /**
   * Storage provider id recorded on attachment metadata.
   */
  readonly attachmentStorageProviderId?: string | null;
}

export interface BPMResolvedAttachmentOptions {
  /** `null` builds each URL from the requesting origin. */
  readonly publicBaseUrl: string | null;
  readonly routePrefix: string;
  readonly signedUrlSecret: string;
  readonly signedUrlTtlSeconds: number;
  readonly storageProviderId: string;
}

export const BPM_ATTACHMENT_OPTIONS: InjectionToken<BPMResolvedAttachmentOptions> =
  Symbol('BPM_ATTACHMENT_OPTIONS');

/**
 * Defaults for every attachment option that has a fixed one. The signing
 * secret has none on purpose: a value published in this package would make
 * every signed URL forgeable, so an unset secret is generated per process by
 * {@link resolveBPMAttachmentOptions}.
 */
export const DEFAULT_BPM_ATTACHMENT_OPTIONS: Omit<
  BPMResolvedAttachmentOptions,
  'signedUrlSecret'
> = {
  publicBaseUrl: null,
  routePrefix: '/attachments',
  signedUrlTtlSeconds: 300,
  storageProviderId: 'local',
};

export function resolveBPMAttachmentOptions(
  options: BPMRootAttachmentOptions = {},
): BPMResolvedAttachmentOptions {
  const configuredSignedUrlSecret = normalizeText(
    options.attachmentSignedUrlSecret,
  );

  // No secret is not a reason to refuse to boot — the module is meant to start
  // with nothing but a database. A random per-process key keeps the signed
  // URLs unforgeable; the warning is for the one thing it cannot do, which is
  // verify a URL signed by another process.
  if (!configuredSignedUrlSecret && process.env.NODE_ENV !== 'test') {
    // eslint-disable-next-line no-console
    console.warn(
      '[@rytass/bpm-core-nestjs-module] attachmentSignedUrlSecret is unset, so this process signs attachment URLs with a random key generated at boot. The URLs stay unforgeable, but each one only verifies on the process that signed it: set BPMRootModuleOptions.attachmentSignedUrlSecret to a shared secret before running more than one API replica, or if a restart must not invalidate the links handed out in the last few minutes.',
    );
  }

  return {
    publicBaseUrl: normalizePublicBaseUrl(options.attachmentPublicBaseUrl),
    routePrefix: normalizeRoutePrefix(options.attachmentRoutePrefix),
    signedUrlSecret:
      configuredSignedUrlSecret ?? randomBytes(32).toString('hex'),
    signedUrlTtlSeconds: normalizePositiveInteger(
      options.attachmentSignedUrlTtlSeconds,
      DEFAULT_BPM_ATTACHMENT_OPTIONS.signedUrlTtlSeconds,
    ),
    storageProviderId:
      normalizeText(options.attachmentStorageProviderId) ??
      DEFAULT_BPM_ATTACHMENT_OPTIONS.storageProviderId,
  };
}

/**
 * Normalizes an attachment route prefix into the form Nest expects on a
 * controller decorator (no leading slash, no trailing slash).
 *
 * Returns the BPM default `attachments` path when no value is provided.
 */
export function resolveAttachmentControllerPath(
  value: string | null | undefined,
): string {
  const normalizedPrefix = normalizeRoutePrefix(value);

  return normalizedPrefix.replace(/^\//, '');
}

function normalizePublicBaseUrl(
  value: string | null | undefined,
): string | null {
  return normalizeText(value)?.replace(/\/+$/, '') ?? null;
}

function normalizeRoutePrefix(value: string | null | undefined): string {
  const normalizedValue =
    normalizeText(value) ?? DEFAULT_BPM_ATTACHMENT_OPTIONS.routePrefix;
  const withLeadingSlash = normalizedValue.startsWith('/')
    ? normalizedValue
    : `/${normalizedValue}`;

  return withLeadingSlash.replace(/\/+$/, '');
}

function normalizeText(value: string | null | undefined): string | null {
  const trimmedValue = value?.trim() ?? '';

  return trimmedValue || null;
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
