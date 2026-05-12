import { Page } from '@playwright/test';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:17603/api';

export async function authenticateApiMember(
  page: Page,
  identifier = 'member-001',
): Promise<void> {
  const response = await page.context().request.post(
    `${API_URL}/auth/login`,
    {
      data: {
        identifier,
        password: 'demo',
      },
    },
  );

  if (!response.ok()) {
    throw new Error(
      `BPM API login failed with HTTP ${response.status()}: ${await response.text()}`,
    );
  }
}
