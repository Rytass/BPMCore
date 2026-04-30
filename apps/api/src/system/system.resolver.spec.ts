import { SystemResolver } from './system.resolver';

describe('SystemResolver', () => {
  it('returns GraphQL readiness status', () => {
    const resolver = new SystemResolver();

    expect(resolver.apiStatus()).toBe('ok');
  });
});
