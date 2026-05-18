import { readGraphQlEndpoint } from './graphql-client';

export interface ApiMember {
  readonly email: string;
  readonly expiresAt: string;
  readonly memberId: string;
  readonly name: string;
  readonly permissions: readonly string[];
  readonly roles: readonly string[];
}

export interface ApiPublicMember {
  readonly email: string;
  readonly memberId: string;
  readonly name: string;
  readonly roles: readonly string[];
}

export async function listApiTestMembers(): Promise<
  readonly ApiPublicMember[]
> {
  return requestApi<readonly ApiPublicMember[]>('/auth/test-members');
}

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

export async function logoutApi(): Promise<void> {
  await requestApi<{ readonly ok: true }>('/auth/logout', {
    method: 'POST',
  });
}

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

export function readApiBaseUrl(): string {
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
    return '/api';
  }

  const endpoint = new URL(graphQlEndpoint);
  endpoint.pathname = '/api';
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint.toString().replace(/\/$/, '');
}

async function requestApi<TData>(
  path: string,
  init?: RequestInit,
): Promise<TData> {
  const response = await fetch(`${readApiBaseUrl()}${path}`, {
    credentials: 'include',
    ...init,
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
