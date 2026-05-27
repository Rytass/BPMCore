import { Page } from '@playwright/test';

const GRAPHQL_URL =
  process.env.E2E_GRAPHQL_URL ?? 'http://localhost:17603/graphql';

export interface GraphQlError {
  readonly message: string;
}

export interface GraphQlResponse<TData> {
  readonly data?: TData;
  readonly errors?: readonly GraphQlError[];
}

export async function requestGraphQl<TData>(
  page: Page,
  query: string,
  variables?: Readonly<Record<string, unknown>>,
): Promise<TData> {
  const response = await page.context().request.post(GRAPHQL_URL, {
    data: { query, variables },
  });

  if (!response.ok()) {
    throw new Error(
      `GraphQL request failed with HTTP ${response.status()}: ${await response.text()}`,
    );
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
