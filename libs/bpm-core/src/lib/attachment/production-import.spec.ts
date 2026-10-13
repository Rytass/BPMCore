/**
 * Guards the failure mode that no other test in this suite can see.
 *
 * `NODE_ENV` is `test` while jest runs, so a check that only fires under
 * `NODE_ENV=production` stays invisible: the whole suite goes green and only a
 * real deployment breaks. That is how 0.13.2 shipped a package that threw on
 * `require()` — the `@Module` decorator argument in `attachment.module.ts`
 * called `resolveBPMAttachmentOptions` through a `useValue`, so the production
 * secret check ran at import time, before any host could supply a secret.
 *
 * Nothing in this package may validate host configuration at import time.
 * Importing a library is not deploying it.
 */
describe('importing the package under NODE_ENV=production', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  let warnSpy: jest.SpiedFunction<typeof console.warn>;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    process.env.NODE_ENV = originalNodeEnv;
    jest.resetModules();
  });

  it('does not throw', (): void => {
    process.env.NODE_ENV = 'production';

    expect((): void => {
      jest.isolateModules((): void => {
        require('../../index');
      });
    }).not.toThrow();
  });

  it('does not warn either — a library has nothing to say until it is wired', (): void => {
    process.env.NODE_ENV = 'staging';

    jest.isolateModules((): void => {
      require('../../index');
    });

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('generates and warns about a secret only once the provider is actually resolved', async (): Promise<void> => {
    process.env.NODE_ENV = 'production';

    const { AttachmentModule } = jest.requireActual<{
      readonly AttachmentModule: {
        readonly forRoot: (options?: Record<string, unknown>) => {
          readonly providers?: readonly unknown[];
        };
      };
    }>('./attachment.module');
    const { BPM_ATTACHMENT_OPTIONS } = jest.requireActual<{
      readonly BPM_ATTACHMENT_OPTIONS: symbol;
    }>('./attachment-options');
    const provider = AttachmentModule.forRoot().providers?.find(
      (candidate): boolean =>
        typeof candidate === 'object' &&
        candidate !== null &&
        (candidate as { readonly provide?: unknown }).provide ===
          BPM_ATTACHMENT_OPTIONS,
    ) as { readonly useFactory: () => unknown } | undefined;

    expect(provider).toBeDefined();
    expect(warnSpy).not.toHaveBeenCalled();

    // Resolving the provider is the first point the host's options are known:
    // with no secret it boots on a generated one and says so, once.
    const resolved = provider?.useFactory() as
      { readonly signedUrlSecret?: string } | undefined;

    expect(resolved?.signedUrlSecret).toMatch(/^[0-9a-f]{64}$/u);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
