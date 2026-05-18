import {
  readGraphQlEndpoint,
  resolveDefaultGraphQlEndpoint,
} from './graphql-client';
import {
  readApiBaseUrl,
  resolveApiBaseUrlFromGraphQlEndpoint,
} from './api-auth-client';

describe('client API endpoint resolution', () => {
  const originalNextPublicApiUrl = process.env.NEXT_PUBLIC_API_URL;
  const originalNextPublicApiAuthUrl = process.env.NEXT_PUBLIC_API_AUTH_URL;

  afterEach((): void => {
    restoreEnvValue('NEXT_PUBLIC_API_URL', originalNextPublicApiUrl);
    restoreEnvValue('NEXT_PUBLIC_API_AUTH_URL', originalNextPublicApiAuthUrl);
  });

  it('uses the local API when the browser is on localhost', (): void => {
    expect(resolveDefaultGraphQlEndpoint('localhost')).toBe(
      'http://localhost:17603/graphql',
    );
    expect(resolveDefaultGraphQlEndpoint('127.0.0.1')).toBe(
      'http://localhost:17603/graphql',
    );
  });

  it('uses same-origin API paths for deployed hostnames', (): void => {
    expect(resolveDefaultGraphQlEndpoint('bpm-core-staging.rytass.info')).toBe(
      '/graphql',
    );
    expect(resolveDefaultGraphQlEndpoint(null)).toBe('/graphql');
  });

  it('derives API auth URL from same-origin GraphQL URL', (): void => {
    expect(resolveApiBaseUrlFromGraphQlEndpoint('/graphql')).toBe('/api');
  });

  it('derives API auth URL from explicit absolute GraphQL URL', (): void => {
    process.env.NEXT_PUBLIC_API_URL = 'https://example.test/graphql';
    delete process.env.NEXT_PUBLIC_API_AUTH_URL;

    expect(readApiBaseUrl()).toBe('https://example.test/api');
  });

  it('prefers explicit endpoint configuration', (): void => {
    process.env.NEXT_PUBLIC_API_URL = 'https://api.example.test/graphql';
    process.env.NEXT_PUBLIC_API_AUTH_URL = 'https://auth.example.test/api/';

    expect(readGraphQlEndpoint()).toBe('https://api.example.test/graphql');
    expect(readApiBaseUrl()).toBe('https://auth.example.test/api');
  });
});

function restoreEnvValue(
  key: 'NEXT_PUBLIC_API_AUTH_URL' | 'NEXT_PUBLIC_API_URL',
  value: string | undefined,
): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
