/**
 * @jest-environment node
 */
import {
  LOCAL_HOSTNAME_PATTERN,
  readApiOrigins,
  readSecurityHeaders,
} from '../security-headers';

interface HeaderRule {
  readonly has?: readonly { readonly type: string; readonly value: string }[];
  readonly headers: readonly { readonly key: string; readonly value: string }[];
  readonly missing?: readonly { readonly type: string; readonly value: string }[];
  readonly source: string;
}

// next.config.js is CommonJS and reads only plain values: require it as is.
const nextConfig = require('../next.config.js') as {
  readonly headers: () => Promise<readonly HeaderRule[]>;
};

const readDirective = (policy: string, name: string): string | undefined =>
  policy
    .split('; ')
    .find((directive) => directive.startsWith(`${name} `));

// Next.js matches a `has` / `missing` host value as `^value$` on the hostname.
const matchesLocalHost = (hostname: string): boolean =>
  new RegExp(`^${LOCAL_HOSTNAME_PATTERN}$`).test(hostname);

describe('client security headers (Phase 23 P4)', (): void => {
  it('sends the CSP report-only plus nosniff on every path, split by local host', async (): Promise<void> => {
    const rules = await nextConfig.headers();

    expect(rules).toHaveLength(2);
    rules.forEach((rule): void => {
      expect(rule.source).toBe('/:path*');
      expect(rule.headers.map((header) => header.key)).toEqual([
        'Content-Security-Policy-Report-Only',
        'X-Content-Type-Options',
      ]);
      expect(rule.headers[1]?.value).toBe('nosniff');
    });
    expect(rules[0]?.has).toEqual([{ type: 'host', value: LOCAL_HOSTNAME_PATTERN }]);
    expect(rules[1]?.missing).toEqual([{ type: 'host', value: LOCAL_HOSTNAME_PATTERN }]);
  });

  it('treats exactly the client library local hostnames as local', (): void => {
    expect(matchesLocalHost('localhost')).toBe(true);
    expect(matchesLocalHost('127.0.0.1')).toBe(true);
    expect(matchesLocalHost('bpm.example.com')).toBe(false);
    expect(matchesLocalHost('localhost.example.com')).toBe(false);
    expect(matchesLocalHost('127a0b0c1')).toBe(false);
  });

  it('keeps blob workers and allows eval only in development', (): void => {
    const [production] = readSecurityHeaders({ development: false, localHost: false });
    const [development] = readSecurityHeaders({ development: true, localHost: true });

    expect(readDirective(production?.value ?? '', 'worker-src')).toBe(
      "worker-src 'self' blob:",
    );
    expect(readDirective(production?.value ?? '', 'script-src')).toBe(
      "script-src 'self' 'unsafe-inline'",
    );
    expect(readDirective(development?.value ?? '', 'script-src')).toContain(
      "'unsafe-eval'",
    );
    expect(readDirective(production?.value ?? '', 'object-src')).toBe(
      "object-src 'none'",
    );
    expect(readDirective(production?.value ?? '', 'frame-ancestors')).toBe(
      "frame-ancestors 'none'",
    );
  });

  it('allows the configured API and auth origins, else the local API on a local host in any build mode', (): void => {
    expect(
      readApiOrigins({ apiUrl: 'https://api.example.com/graphql', localHost: true }),
    ).toEqual(['https://api.example.com']);
    expect(readApiOrigins({ apiUrl: '/graphql', localHost: false })).toEqual([]);
    expect(
      readApiOrigins({
        apiUrl: 'https://api.example.com/graphql',
        authUrl: 'https://auth.example.com/',
        localHost: false,
      }),
    ).toEqual(['https://api.example.com', 'https://auth.example.com']);
    expect(
      readApiOrigins({
        apiUrl: 'https://api.example.com/graphql',
        authUrl: 'https://api.example.com',
        localHost: false,
      }),
    ).toEqual(['https://api.example.com']);
    expect(readApiOrigins({ localHost: true })).toEqual(['http://localhost:17603']);
    expect(
      readApiOrigins({ authUrl: 'https://files.example.com', localHost: true }),
    ).toEqual(['http://localhost:17603', 'https://files.example.com']);
    expect(readApiOrigins({ localHost: false })).toEqual([]);

    // A production build served on localhost still reaches the local API.
    const [localProduction] = readSecurityHeaders({ development: false, localHost: true });

    expect(readDirective(localProduction?.value ?? '', 'connect-src')).toBe(
      "connect-src 'self' http://localhost:17603",
    );
    expect(readDirective(localProduction?.value ?? '', 'img-src')).toBe(
      "img-src 'self' data: blob: http://localhost:17603",
    );

    const [localDevelopment] = readSecurityHeaders({ development: true, localHost: true });

    expect(readDirective(localDevelopment?.value ?? '', 'connect-src')).toBe(
      "connect-src 'self' http://localhost:17603 ws://localhost:*",
    );
  });
});
