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

  it('boots under NODE_ENV=production with no secret, on a random one', (): void => {
    process.env.NODE_ENV = 'production';

    const first = resolveBPMAttachmentOptions();
    const second = resolveBPMAttachmentOptions();

    expect(first.signedUrlSecret).toMatch(/^[0-9a-f]{64}$/u);
    // Generated per resolution, never a value shipped in the package.
    expect(second.signedUrlSecret).not.toBe(first.signedUrlSecret);
    expect(first.signedUrlSecret).not.toBe(
      'bpm-core-local-attachment-url-key-v1',
    );
  });

  it.each(['production', 'staging', 'development'])(
    'warns on stderr about the generated secret under NODE_ENV=%s',
    (nodeEnv): void => {
      process.env.NODE_ENV = nodeEnv;

      resolveBPMAttachmentOptions();

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0]?.[0])).toContain(
        'attachmentSignedUrlSecret is unset',
      );
    },
  );

  it('stays quiet under NODE_ENV=test', (): void => {
    process.env.NODE_ENV = 'test';

    resolveBPMAttachmentOptions();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('treats a blank secret as unset', (): void => {
    process.env.NODE_ENV = 'production';

    const resolved = resolveBPMAttachmentOptions({
      attachmentSignedUrlSecret: '   ',
    });

    expect(resolved.signedUrlSecret).toMatch(/^[0-9a-f]{64}$/u);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('uses a configured secret as is, without warning', (): void => {
    process.env.NODE_ENV = 'production';

    const resolved = resolveBPMAttachmentOptions({
      attachmentSignedUrlSecret: 'my-real-secret',
    });

    expect(resolved.signedUrlSecret).toBe('my-real-secret');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('ignores the deprecated insecure-secret opt-in', (): void => {
    process.env.NODE_ENV = 'production';

    const resolved = resolveBPMAttachmentOptions({
      attachmentAllowInsecureSignedUrlSecret: true,
    });

    expect(resolved.signedUrlSecret).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('leaves the public base URL to the request when unset', (): void => {
    expect(resolveBPMAttachmentOptions().publicBaseUrl).toBeNull();
    expect(
      resolveBPMAttachmentOptions({ attachmentPublicBaseUrl: '  ' })
        .publicBaseUrl,
    ).toBeNull();
  });

  it('trims a trailing slash off a configured public base URL', (): void => {
    expect(
      resolveBPMAttachmentOptions({
        attachmentPublicBaseUrl: 'https://bpm.example.com/',
      }).publicBaseUrl,
    ).toBe('https://bpm.example.com');
  });
});
