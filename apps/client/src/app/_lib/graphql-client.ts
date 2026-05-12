const DEFAULT_GRAPHQL_ENDPOINT = 'http://localhost:17603/graphql';

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
    DEFAULT_GRAPHQL_ENDPOINT
  );
}

function buildGraphQlHeaders(): Readonly<Record<string, string>> {
  return {
    'Content-Type': 'application/json',
    ...buildExplicitBPMAuthHeaders(),
  };
}

function buildExplicitBPMAuthHeaders(): Readonly<Record<string, string>> {
  const memberId = readOptionalPublicEnvValue(
    process.env.NEXT_PUBLIC_BPM_MEMBER_ID,
  );

  if (!memberId) {
    return {};
  }

  return removeEmptyHeaders({
    'x-bpm-member-email': process.env.NEXT_PUBLIC_BPM_MEMBER_EMAIL,
    'x-bpm-member-id': memberId,
    'x-bpm-member-name': process.env.NEXT_PUBLIC_BPM_MEMBER_NAME,
    'x-bpm-permissions': process.env.NEXT_PUBLIC_BPM_MEMBER_PERMISSIONS,
    'x-bpm-roles': process.env.NEXT_PUBLIC_BPM_MEMBER_ROLES,
  });
}

function readOptionalPublicEnvValue(value: string | undefined): string | null {
  return value?.trim() || null;
}

function removeEmptyHeaders(
  headers: Readonly<Record<string, string | undefined | null>>,
): Readonly<Record<string, string>> {
  return Object.entries(headers).reduce<Readonly<Record<string, string>>>(
    (accumulator, [key, value]) => ({
      ...accumulator,
      ...(value?.trim() ? { [key]: value.trim() } : {}),
    }),
    {},
  );
}
