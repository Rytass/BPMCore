import {
  isFormDataIssue,
  type FormDataIssue,
} from '@rytass/bpm-core-shared/form';
import {
  readBPMClientConfig,
  readBPMConfiguredHeaders,
  resolveBPMFetch,
} from './client-config';

const LOCAL_GRAPHQL_ENDPOINT = 'http://localhost:17603/graphql';
const SAME_ORIGIN_GRAPHQL_ENDPOINT = '/graphql';

interface GraphQlError {
  readonly message: string;
  readonly extensions?: Readonly<Record<string, unknown>>;
}

/**
 * A GraphQL operation the host refused. `message` is the host's message, as
 * it has always been. `formDataIssues` lists the form values the host refused,
 * one per value, with `path` addressing the field, row or cell; it is empty
 * when the refusal was not about form data.
 */
export class BPMGraphQLRequestError extends Error {
  readonly formDataIssues: readonly FormDataIssue[];

  constructor(message: string, formDataIssues: readonly FormDataIssue[]) {
    super(message);
    this.name = 'BPMGraphQLRequestError';
    this.formDataIssues = formDataIssues;
  }
}

/**
 * The form data issues a failed request carries, or `[]` when it carries none.
 * Duck-typed on `formDataIssues`, so an error from another copy of this
 * package still reads.
 */
export function readFormDataIssues(error: unknown): readonly FormDataIssue[] {
  if (typeof error !== 'object' || error === null) {
    return [];
  }

  const issues = (error as Readonly<{ formDataIssues?: unknown }>)
    .formDataIssues;

  // All or nothing, as in readGraphQlFormDataIssues below.
  return Array.isArray(issues) &&
    (issues as readonly unknown[]).every(isFormDataIssue)
    ? (issues as readonly FormDataIssue[])
    : [];
}

/**
 * The host's `extensions.originalError.formDataErrors`, across all errors.
 * All or nothing: when any entry is not an issue this client understands (a
 * newer host's reason, say), none are returned, so a caller falls back to the
 * message instead of placing some errors and silently dropping the rest.
 */
function readGraphQlFormDataIssues(
  errors: readonly GraphQlError[],
): readonly FormDataIssue[] {
  const entries = errors.flatMap((error): readonly unknown[] => {
    const original = error.extensions?.['originalError'];
    const issues =
      typeof original === 'object' && original !== null
        ? (original as Readonly<Record<string, unknown>>)['formDataErrors']
        : undefined;

    return Array.isArray(issues) ? (issues as readonly unknown[]) : [];
  });

  return entries.every(isFormDataIssue) ? entries : [];
}

/**
 * Per-request transport options.
 *
 * `signal` lets a caller supersede an in-flight operation — a newer search or
 * resolve aborts the older one instead of letting it reach the host.
 */
export interface GraphQlRequestOptions {
  readonly signal?: AbortSignal;
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
 * @param options - Optional transport options, currently an `AbortSignal`.
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
  options?: GraphQlRequestOptions,
): Promise<TData> {
  const fetchImpl = resolveBPMFetch();
  const response = await fetchImpl(readGraphQlEndpoint(), {
    body: JSON.stringify({ query, variables }),
    credentials: 'include',
    headers: buildGraphQlHeaders(),
    method: 'POST',
    ...(options?.signal ? { signal: options.signal } : {}),
  });

  if (!response.ok) {
    throw new Error(`GraphQL request failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as GraphQlResponse<TData>;

  if (payload.errors?.length) {
    throw new BPMGraphQLRequestError(
      payload.errors.map((error) => error.message).join('; '),
      readGraphQlFormDataIssues(payload.errors),
    );
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
  const configured = readBPMClientConfig().baseUrl?.trim();
  if (configured) {
    return normalizeGraphQlEndpoint(configured);
  }
  const configuredEnvironmentValue = readOptionalPublicEnvValue(
    process.env.NEXT_PUBLIC_API_URL,
  );

  return configuredEnvironmentValue
    ? normalizeGraphQlEndpoint(configuredEnvironmentValue)
    : resolveDefaultGraphQlEndpoint(readBrowserHostname());
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
    ...readBPMConfiguredHeaders(),
    'Content-Type': 'application/json',
  };
}

function readOptionalPublicEnvValue(value: string | undefined): string | null {
  return value?.trim() || null;
}

function normalizeGraphQlEndpoint(endpoint: string): string {
  return endpoint.endsWith('/graphql')
    ? endpoint
    : `${endpoint.replace(/\/$/, '')}/graphql`;
}

function readBrowserHostname(): string | null {
  return typeof window === 'undefined' ? null : window.location.hostname;
}

function isLocalHost(hostname: string | null): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}
