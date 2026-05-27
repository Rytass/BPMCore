import { InjectionToken } from '@nestjs/common';

export interface BPMRootAttachmentOptions {
  /**
   * Public HTTP base URL used to build signed attachment download and preview
   * URLs.
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
   * HMAC secret used to sign attachment download and preview tokens.
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
  readonly publicBaseUrl: string;
  readonly routePrefix: string;
  readonly signedUrlSecret: string;
  readonly signedUrlTtlSeconds: number;
  readonly storageProviderId: string;
}

export const BPM_ATTACHMENT_OPTIONS: InjectionToken<BPMResolvedAttachmentOptions> =
  Symbol('BPM_ATTACHMENT_OPTIONS');

export const DEFAULT_BPM_ATTACHMENT_OPTIONS: BPMResolvedAttachmentOptions = {
  publicBaseUrl: 'http://localhost:17603',
  routePrefix: '/attachments',
  signedUrlSecret: 'bpm-core-local-attachment-url-key-v1',
  signedUrlTtlSeconds: 300,
  storageProviderId: 'local',
};

export function resolveBPMAttachmentOptions(
  options: BPMRootAttachmentOptions = {},
): BPMResolvedAttachmentOptions {
  const resolvedSignedUrlSecret =
    normalizeText(options.attachmentSignedUrlSecret) ??
    DEFAULT_BPM_ATTACHMENT_OPTIONS.signedUrlSecret;

  if (
    resolvedSignedUrlSecret === DEFAULT_BPM_ATTACHMENT_OPTIONS.signedUrlSecret &&
    process.env.NODE_ENV === 'production'
  ) {
    // eslint-disable-next-line no-console
    console.warn(
      '[@rytass/bpm-core-nestjs-module] attachmentSignedUrlSecret is using the built-in local development value. Set BPMRootModuleOptions.attachmentSignedUrlSecret to a strong secret before serving production traffic — signed attachment URLs would otherwise be forgeable.',
    );
  }

  return {
    publicBaseUrl: normalizePublicBaseUrl(options.attachmentPublicBaseUrl),
    routePrefix: normalizeRoutePrefix(options.attachmentRoutePrefix),
    signedUrlSecret: resolvedSignedUrlSecret,
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

function normalizePublicBaseUrl(value: string | null | undefined): string {
  const normalizedValue =
    normalizeText(value) ?? DEFAULT_BPM_ATTACHMENT_OPTIONS.publicBaseUrl;

  return normalizedValue.replace(/\/+$/, '');
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
