import { readGraphQlEndpoint } from './graphql-client';
import {
  readBPMClientConfig,
  readBPMConfiguredHeaders,
  resolveBPMFetch,
} from './client-config';

/**
 * Authenticated BPM member returned by {@link loginApi} and
 * {@link readApiCurrentMember}.
 *
 * Mirrors the shape that BPM-compatible wrapper hosts emit from their
 * `POST /auth/login` and `GET /auth/me` endpoints. Roles and permissions
 * are used by BPM's `BPMAdminGuard` / `BPMDesignerGuard`.
 */
export interface ApiMember {
  readonly email: string;
  readonly expiresAt: string;
  readonly memberId: string;
  readonly name: string;
  readonly permissions: readonly string[];
  readonly roles: readonly string[];
}

/**
 * Reduced member shape returned by {@link listApiTestMembers}. Excludes
 * `permissions` and `expiresAt` because the test-members endpoint is meant
 * for picker UIs in dev / demo, not for session establishment.
 */
export interface ApiPublicMember {
  readonly email: string;
  readonly memberId: string;
  readonly name: string;
  readonly roles: readonly string[];
}

/**
 * Lists seeded test members exposed by the host's `/auth/test-members`
 * endpoint. Hosts targeting production typically disable this endpoint or
 * gate it behind a feature flag.
 */
export async function listApiTestMembers(): Promise<
  readonly ApiPublicMember[]
> {
  return requestApi<readonly ApiPublicMember[]>('/auth/test-members');
}

/**
 * Performs a login against the host's `POST /auth/login` endpoint. On
 * success the host issues an HTTP-only session cookie that subsequent
 * {@link requestGraphQl} calls automatically carry, because
 * {@link requestApi} uses `credentials: 'include'`.
 *
 * Throws on HTTP errors with a message extracted from the response body
 * when available.
 *
 * @param input.identifier - Member id, email, or any other identifier the
 *                           host understands.
 * @param input.password   - Cleartext credential — TLS is the consumer's
 *                           responsibility.
 */
export async function loginApi(input: {
  readonly identifier: string;
  readonly password: string;
}): Promise<ApiMember> {
  return requestApi<ApiMember>('/auth/login', {
    body: JSON.stringify(input),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
}

/**
 * Calls `POST /auth/logout` on the host. The host clears the session
 * cookie. Safe to call when not logged in (host should return 200).
 */
export async function logoutApi(): Promise<void> {
  await requestApi<{ readonly ok: true }>('/auth/logout', {
    method: 'POST',
  });
}

/**
 * Reads the currently authenticated member from `GET /auth/me`.
 *
 * Returns `null` when the host replies `401`, which is the conventional
 * way to signal "no active session". Any other HTTP failure throws.
 */
export async function readApiCurrentMember(): Promise<ApiMember | null> {
  try {
    return await requestApi<ApiMember>('/auth/me');
  } catch (error: unknown) {
    if (error instanceof ApiRequestError && error.status === 401) {
      return null;
    }

    throw error;
  }
}

/**
 * Resolves the base URL used by the REST `/auth/*` calls.
 *
 * Resolution order:
 * 1. `process.env.NEXT_PUBLIC_API_AUTH_URL` if non-empty.
 * 2. Derived from {@link readGraphQlEndpoint}'s origin — the host is
 *    assumed to expose both `/graphql` and `/auth/*` at the same origin.
 */
export function readApiBaseUrl(): string {
  const config = readBPMClientConfig();
  if (config.authBaseUrl?.trim()) {
    return config.authBaseUrl.trim().replace(/\/$/, '');
  }

  const explicitApiBaseUrl = process.env.NEXT_PUBLIC_API_AUTH_URL?.trim();

  if (explicitApiBaseUrl) {
    return explicitApiBaseUrl.replace(/\/$/, '');
  }

  const graphQlEndpoint = readGraphQlEndpoint();

  return resolveApiBaseUrlFromGraphQlEndpoint(graphQlEndpoint);
}

export function resolveApiBaseUrlFromGraphQlEndpoint(
  graphQlEndpoint: string,
): string {
  if (!isAbsoluteUrl(graphQlEndpoint)) {
    return '';
  }

  const endpoint = new URL(graphQlEndpoint);
  endpoint.pathname = '/';
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint.toString().replace(/\/$/, '');
}

async function requestApi<TData>(
  path: string,
  init?: RequestInit,
): Promise<TData> {
  const fetchImpl = resolveBPMFetch();
  const configuredHeaders = readBPMConfiguredHeaders();
  const response = await fetchImpl(`${readApiBaseUrl()}${path}`, {
    credentials: 'include',
    ...init,
    headers: { ...configuredHeaders, ...(init?.headers ?? {}) },
  });

  if (!response.ok) {
    throw new ApiRequestError(response.status, await readError(response));
  }

  return (await response.json()) as TData;
}

async function readError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { readonly message?: unknown };

    return typeof payload.message === 'string'
      ? payload.message
      : `BPM API request failed with HTTP ${response.status}`;
  } catch {
    return `BPM API request failed with HTTP ${response.status}`;
  }
}

class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function isAbsoluteUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}
