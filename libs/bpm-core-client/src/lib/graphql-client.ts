const LOCAL_GRAPHQL_ENDPOINT = 'http://localhost:17603/graphql';
const SAME_ORIGIN_GRAPHQL_ENDPOINT = '/graphql';

interface GraphQlError {
  readonly message: string;
}

interface GraphQlResponse<TData> {
  readonly data?: TData;
  readonly errors?: readonly GraphQlError[];
}

/**
 * Sends a single GraphQL operation to the BPM host and returns the typed data.
 *
 * Uses the standard Fetch API with `credentials: 'include'`, so any
 * HTTP-only session cookie issued by the host's `POST /auth/login` endpoint
 * flows back automatically on subsequent calls.
 *
 * The endpoint URL is resolved by {@link readGraphQlEndpoint} — set
 * `NEXT_PUBLIC_API_URL` to override the default localhost / same-origin
 * resolution.
 *
 * Throws an `Error` when the HTTP response is non-2xx, when the GraphQL
 * payload carries an `errors` array, or when the response has no `data`
 * field.
 *
 * @typeParam TData - Shape of the `data` field for the operation.
 * @param query - GraphQL operation document (query or mutation source).
 * @param variables - Variables passed to the GraphQL operation.
 *
 * @example
 * ```ts
 * interface PingData { readonly memberCount: number; }
 * const data = await requestGraphQl<PingData>('query Ping { memberCount }');
 * console.log(data.memberCount);
 * ```
 */
export async function requestGraphQl<TData>(
  query: string,
  variables?: Readonly<Record<string, unknown>>,
): Promise<TData> {
  const response = await fetch(readGraphQlEndpoint(), {
    body: JSON.stringify({ query, variables }),
    credentials: 'include',
    headers: buildGraphQlHeaders(),
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`GraphQL request failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as GraphQlResponse<TData>;

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join('; '));
  }

  if (!payload.data) {
    throw new Error('GraphQL response did not include data');
  }

  return payload.data;
}

/**
 * Resolves the GraphQL endpoint URL used by {@link requestGraphQl}.
 *
 * Resolution order:
 * 1. `process.env.NEXT_PUBLIC_API_URL` if non-empty.
 * 2. `http://localhost:17603/graphql` when the browser is on
 *    `localhost` / `127.0.0.1`.
 * 3. Same-origin `/graphql` for any other hostname (and for non-browser
 *    runtimes such as Node SSR).
 */
export function readGraphQlEndpoint(): string {
  return (
    readOptionalPublicEnvValue(process.env.NEXT_PUBLIC_API_URL) ??
    resolveDefaultGraphQlEndpoint(readBrowserHostname())
  );
}

/**
 * Pure helper used by {@link readGraphQlEndpoint}.
 *
 * Exposed mainly for tests and for hosts that want to derive their own
 * endpoint URLs without coupling to environment variables.
 */
export function resolveDefaultGraphQlEndpoint(
  hostname: string | null,
): string {
  return isLocalHost(hostname)
    ? LOCAL_GRAPHQL_ENDPOINT
    : SAME_ORIGIN_GRAPHQL_ENDPOINT;
}

function buildGraphQlHeaders(): Readonly<Record<string, string>> {
  return {
    'Content-Type': 'application/json',
  };
}

function readOptionalPublicEnvValue(value: string | undefined): string | null {
  return value?.trim() || null;
}

function readBrowserHostname(): string | null {
  return typeof window === 'undefined' ? null : window.location.hostname;
}

function isLocalHost(hostname: string | null): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}
