import { InjectionToken } from '@nestjs/common';

export interface BPMRootAttachmentOptions {
  /**
   * Public HTTP base URL used to build signed attachment download and preview
   * URLs.
   */
  readonly attachmentPublicBaseUrl?: string | null;

  /**
   * HMAC secret used to sign attachment download and preview tokens.
   */
  readonly attachmentSignedUrlSecret?: string | null;

  /**
   * Signed attachment URL lifetime in seconds.
   */
  readonly attachmentSignedUrlTtlSeconds?: number;
}

export interface BPMResolvedAttachmentOptions {
  readonly publicBaseUrl: string;
  readonly signedUrlSecret: string;
  readonly signedUrlTtlSeconds: number;
}

export const BPM_ATTACHMENT_OPTIONS: InjectionToken<BPMResolvedAttachmentOptions> =
  Symbol('BPM_ATTACHMENT_OPTIONS');

export const DEFAULT_BPM_ATTACHMENT_OPTIONS: BPMResolvedAttachmentOptions = {
  publicBaseUrl: 'http://localhost:17603',
  signedUrlSecret: 'bpm-core-local-attachment-url-key-v1',
  signedUrlTtlSeconds: 300,
};

export function resolveBPMAttachmentOptions(
  options: BPMRootAttachmentOptions = {},
): BPMResolvedAttachmentOptions {
  return {
    publicBaseUrl: normalizePublicBaseUrl(options.attachmentPublicBaseUrl),
    signedUrlSecret:
      normalizeText(options.attachmentSignedUrlSecret) ??
      DEFAULT_BPM_ATTACHMENT_OPTIONS.signedUrlSecret,
    signedUrlTtlSeconds: normalizePositiveInteger(
      options.attachmentSignedUrlTtlSeconds,
      DEFAULT_BPM_ATTACHMENT_OPTIONS.signedUrlTtlSeconds,
    ),
  };
}

function normalizePublicBaseUrl(value: string | null | undefined): string {
  const normalizedValue =
    normalizeText(value) ?? DEFAULT_BPM_ATTACHMENT_OPTIONS.publicBaseUrl;

  return normalizedValue.replace(/\/+$/, '');
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
