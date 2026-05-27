import { resolveBPMSignatureOptions } from './signature-options';

describe('resolveBPMSignatureOptions', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  let warnSpy: jest.SpiedFunction<typeof console.warn>;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('does not warn outside production', (): void => {
    process.env.NODE_ENV = 'test';

    resolveBPMSignatureOptions();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns when default providers are used under production', (): void => {
    process.env.NODE_ENV = 'production';

    resolveBPMSignatureOptions();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String(warnSpy.mock.calls[0]?.[0]);
    expect(message).toContain('signatureKeyProvider');
    expect(message).toContain('signatureTimestampProvider');
  });

  it('omits the field from the warning when a custom key provider is supplied', (): void => {
    process.env.NODE_ENV = 'production';

    resolveBPMSignatureOptions({
      signatureKeyProvider: { readKey: (): string => 'kms-key' },
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String(warnSpy.mock.calls[0]?.[0]);
    expect(message).not.toContain('signatureKeyProvider,');
    expect(message).toContain('signatureTimestampProvider');
  });

  it('does not warn when both providers are supplied', (): void => {
    process.env.NODE_ENV = 'production';

    resolveBPMSignatureOptions({
      signatureKeyProvider: { readKey: (): string => 'kms-key' },
      signatureTimestampProvider: {
        createTimestampToken: (): Buffer => Buffer.from('rfc3161'),
      },
    });

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
