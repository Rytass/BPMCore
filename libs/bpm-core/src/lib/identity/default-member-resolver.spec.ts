import { DefaultBPMMemberResolver } from './default-member-resolver';
import { BPMMemberResolver } from './member-resolver.interface';

describe('DefaultBPMMemberResolver', (): void => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach((): void => {
    process.env.NODE_ENV = originalNodeEnv;
    jest.restoreAllMocks();
  });

  it('resolves a member to its own id so BPM screens keep working', async (): Promise<void> => {
    const resolver = new DefaultBPMMemberResolver();

    await expect(resolver.resolve('member-1')).resolves.toEqual({
      customFields: {},
      email: '',
      memberId: 'member-1',
      name: 'member-1',
    });
  });

  it('answers for every requested id rather than omitting unknown ones', async (): Promise<void> => {
    // Omitting would render each member as deleted/anonymized, which is worse
    // than showing the id the caller already has.
    const resolver = new DefaultBPMMemberResolver();
    const resolved = await resolver.resolveMany(['member-1', 'member-2']);

    expect([...resolved.keys()]).toEqual(['member-1', 'member-2']);
    expect(resolved.get('member-2')?.name).toBe('member-2');
  });

  it('exposes no search method, so member-picker search stays disabled', (): void => {
    const resolver: BPMMemberResolver = new DefaultBPMMemberResolver();

    expect(resolver.search).toBeUndefined();
    expect(resolver.searchPaged).toBeUndefined();
  });

  it.each(['production', 'staging'])(
    'warns under NODE_ENV=%s that BPM is showing raw ids',
    (nodeEnv): void => {
      const warn = jest.spyOn(console, 'warn').mockImplementation((): void => {
        // Silence the expected warning.
      });

      process.env.NODE_ENV = nodeEnv;
      new DefaultBPMMemberResolver();

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain('no member resolver');
    },
  );

  it.each(['development', 'test'])(
    'stays quiet under NODE_ENV=%s',
    (nodeEnv): void => {
      const warn = jest.spyOn(console, 'warn').mockImplementation((): void => {
        // Nothing should reach this.
      });

      process.env.NODE_ENV = nodeEnv;
      new DefaultBPMMemberResolver();

      expect(warn).not.toHaveBeenCalled();
    },
  );
});
