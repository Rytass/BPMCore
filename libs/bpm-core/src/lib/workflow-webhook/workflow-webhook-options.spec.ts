import { Logger } from '@nestjs/common';
import { resolveAndReportWorkflowWebhookOptions } from './workflow-webhook-options.module';
import {
  DEFAULT_BPM_WORKFLOW_WEBHOOK_OPTIONS,
  readDisabledWorkflowWebhookSourceReason,
  resolveBPMWorkflowWebhookOptions,
} from './workflow-webhook-options';

describe('resolveBPMWorkflowWebhookOptions', () => {
  it('defaults to the registry source with no allowlist', () => {
    expect(resolveBPMWorkflowWebhookOptions()).toEqual(
      DEFAULT_BPM_WORKFLOW_WEBHOOK_OPTIONS,
    );
  });

  it('parses the allowlist once and keeps the registry unenforced by default', () => {
    const resolved = resolveBPMWorkflowWebhookOptions({
      workflowWebhookAllowedUrlPatterns: ['https://*.example.com/hooks/*'],
    });

    expect(resolved.allowedUrlPatterns).toHaveLength(1);
    expect(resolved.enforceAllowlistForRegistry).toBe(false);
  });

  it('fails fast on an invalid pattern rather than allowing or denying silently', () => {
    expect(() =>
      resolveBPMWorkflowWebhookOptions({
        workflowWebhookAllowedUrlPatterns: ['ws://erp.example.com/*'],
      }),
    ).toThrow(/must use http:\/\/ or https:\/\//u);
  });

  it('drops the database source until its guards are configured', () => {
    const options = {
      workflowWebhookTargetSources: ['REGISTRY', 'DATABASE'],
    } as const;
    const resolved = resolveBPMWorkflowWebhookOptions(options);

    expect(resolved.targetSources).toEqual(['REGISTRY']);
    expect(readDisabledWorkflowWebhookSourceReason(options, resolved)).toBe(
      'DATABASE webhook endpoints are disabled: workflowWebhookAllowedUrlPatterns and workflowWebhookSecretEncryptionKey must be set',
    );
  });

  it('keeps the database source once the allowlist and key are set', () => {
    const options = {
      workflowWebhookAllowedUrlPatterns: ['https://erp.example.com/*'],
      workflowWebhookSecretEncryptionKey: ` ${'a'.repeat(64)} `,
      workflowWebhookTargetSources: ['DATABASE', 'REGISTRY', 'DATABASE'],
    } as const;
    const resolved = resolveBPMWorkflowWebhookOptions(options);

    expect(resolved.targetSources).toEqual(['DATABASE', 'REGISTRY']);
    expect(resolved.secretEncryptionKey).toBe('a'.repeat(64));
    expect(
      readDisabledWorkflowWebhookSourceReason(options, resolved),
    ).toBeNull();
  });

  it('refuses to boot with a key that is not 32 bytes', () => {
    expect(() =>
      resolveBPMWorkflowWebhookOptions({
        workflowWebhookSecretEncryptionKey: 'not-a-real-key',
      }),
    ).toThrow(/must be 32 bytes/);
  });

  it('names only the missing guard', () => {
    const options = {
      workflowWebhookAllowedUrlPatterns: ['https://erp.example.com/*'],
      workflowWebhookTargetSources: ['DATABASE'],
    } as const;

    expect(
      readDisabledWorkflowWebhookSourceReason(
        options,
        resolveBPMWorkflowWebhookOptions(options),
      ),
    ).toBe(
      'DATABASE webhook endpoints are disabled: workflowWebhookSecretEncryptionKey must be set',
    );
  });

  it('logs why a requested database source was dropped', () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation((): void => undefined);

    try {
      resolveAndReportWorkflowWebhookOptions({
        workflowWebhookTargetSources: ['DATABASE'],
      });
      resolveAndReportWorkflowWebhookOptions({});

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        'DATABASE webhook endpoints are disabled: workflowWebhookAllowedUrlPatterns and workflowWebhookSecretEncryptionKey must be set',
      );
    } finally {
      warn.mockRestore();
    }
  });
});
