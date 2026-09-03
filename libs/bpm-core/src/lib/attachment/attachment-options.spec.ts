import { resolveBPMAttachmentOptions } from './attachment-options';

describe('resolveBPMAttachmentOptions', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  let warnSpy: jest.SpiedFunction<typeof console.warn>;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('does not warn when NODE_ENV is not production, even with default secret', (): void => {
    process.env.NODE_ENV = 'development';

    resolveBPMAttachmentOptions();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns when default secret is used outside development and production', (): void => {
    process.env.NODE_ENV = 'staging';

    const resolved = resolveBPMAttachmentOptions();

    expect(resolved.signedUrlSecret).toBe('bpm-core-local-attachment-url-key-v1');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain(
      'attachmentSignedUrlSecret is using the built-in local development value',
    );
  });

  it('refuses to resolve when default secret is used under NODE_ENV=production', (): void => {
    process.env.NODE_ENV = 'production';

    expect((): unknown => resolveBPMAttachmentOptions()).toThrow(
      /attachmentSignedUrlSecret is unset/,
    );
  });

  it('allows the default secret under production behind the explicit opt-in', (): void => {
    process.env.NODE_ENV = 'production';

    const resolved = resolveBPMAttachmentOptions({
      attachmentAllowInsecureSignedUrlSecret: true,
    });

    expect(resolved.signedUrlSecret).toBe('bpm-core-local-attachment-url-key-v1');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('does not warn when a custom secret is supplied under production', (): void => {
    process.env.NODE_ENV = 'production';

    resolveBPMAttachmentOptions({
      attachmentSignedUrlSecret: 'my-real-secret',
    });

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
