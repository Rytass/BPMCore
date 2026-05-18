const LOCAL_GRAPHQL_ENDPOINT = 'http://localhost:17603/graphql';
const SAME_ORIGIN_GRAPHQL_ENDPOINT = '/graphql';

interface GraphQlError {
  readonly message: string;
}

interface GraphQlResponse<TData> {
  readonly data?: TData;
  readonly errors?: readonly GraphQlError[];
}

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

export function readGraphQlEndpoint(): string {
  return (
    readOptionalPublicEnvValue(process.env.NEXT_PUBLIC_API_URL) ??
    resolveDefaultGraphQlEndpoint(readBrowserHostname())
  );
}

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
