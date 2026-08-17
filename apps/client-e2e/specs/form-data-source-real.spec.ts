import { expect, Page, test } from '@playwright/test';

// Defaults to the local wrapper host like the other real-flow specs, so a plain
// `pnpm e2e:client` exercises the DataSource golden path instead of skipping it.
const FEATURE_API_URL =
  process.env.E2E_DATA_SOURCE_API_URL ??
  process.env.E2E_API_URL ??
  'http://localhost:17603';
// The read-only history check opens its own context, so it needs the same
// baseURL override the Playwright config honours.
const CLIENT_BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:17602';
const FEATURE_GRAPHQL_URL = `${FEATURE_API_URL.replace(/\/$/u, '')}/graphql`;
const TEMPLATE_ID = '50000000-0000-4000-8000-000000000006';
const RETURNED_INSTANCE_ID = '60000000-0000-4000-8000-000000000008';

interface GraphQlResponse<TData> {
  readonly data?: TData;
  readonly errors?: readonly { readonly message: string }[];
}

interface ApprovalInstanceData {
  readonly approvalInstance: {
    readonly formDataJson: string;
    readonly formDataOptionSnapshotJson: string;
    readonly id: string;
  };
}

test.describe('Seeded form option DataSource golden path', () => {
  test('loads every dynamic control, submits snapshots, and renders history offline', async ({
    browser,
    page,
  }): Promise<void> => {
    await routeFeatureApi(page);
    await authenticateFeatureMember(page, 'member-102');
    await page.goto(`/instances/new?templateId=${TEMPLATE_ID}`);

    await expect(
      page.getByRole('heading', { name: '發起簽核' }),
    ).toBeVisible();
    await expect(page.getByText('請先填寫相依欄位。').first()).toBeVisible();
    await expect(
      page
        .locator('[data-form-field-key="costCenterSelectSingle"] input')
        .first(),
    ).toBeDisabled();

    await chooseOption(page, 'plant', '台中廠 TW01');
    await expect(
      page.getByText('TW01 成本中心 001', { exact: true }).first(),
    ).toBeVisible();

    await chooseOption(
      page,
      'costCenterSelectSingle',
      'TW01 成本中心 001',
    );
    await chooseOption(
      page,
      'costCenterSelectMultiple',
      'TW01 成本中心 001',
    );
    await chooseOption(
      page,
      'costCenterSelectMultiple',
      'TW01 成本中心 002',
    );
    await page.keyboard.press('Escape');
    await searchAndChooseOption(
      page,
      'costCenterAutocompleteSingle',
      'TW01 成本中心 003',
    );
    await searchAndChooseOption(
      page,
      'costCenterAutocompleteMultiple',
      'TW01 成本中心 004',
    );
    await searchAndChooseOption(
      page,
      'costCenterAutocompleteMultiple',
      'TW01 成本中心 005',
    );
    await page
      .locator(
        '[data-form-field-key="costCenterRadio"] input[value="CC-TW01-006"]',
      )
      .check();
    await page
      .locator(
        '[data-form-field-key="costCenterCheckbox"] input[value="CC-TW01-007"]',
      )
      .check();
    await page
      .locator(
        '[data-form-field-key="costCenterCheckbox"] input[value="CC-TW01-008"]',
      )
      .check();

    const submitButton = page.getByRole('button', { name: '送出', exact: true });
    await expect(submitButton).toBeEnabled();
    await Promise.all([
      page.waitForURL(/\/instances\/[0-9a-f-]+$/u),
      submitButton.click(),
    ]);

    const instanceId = page.url().split('/').at(-1);

    if (!instanceId) {
      throw new Error('Submitted instance URL did not contain an id');
    }

    const submitted = await readApprovalInstance(page, instanceId);
    const submittedFormData = JSON.parse(submitted.formDataJson) as Record<
      string,
      unknown
    >;
    const submittedSnapshot = JSON.parse(
      submitted.formDataOptionSnapshotJson,
    ) as Record<string, unknown>;

    expect(submittedFormData).toMatchObject({
      costCenterAutocompleteSingle: 'CC-TW01-003',
      costCenterRadio: 'CC-TW01-006',
      costCenterSelectSingle: 'CC-TW01-001',
      plant: 'TW01',
    });
    expect(submittedSnapshot).toEqual(
      expect.objectContaining({
        costCenterAutocompleteMultiple: expect.any(Object),
        costCenterAutocompleteSingle: expect.any(Object),
        costCenterCheckbox: expect.any(Object),
        costCenterRadio: expect.any(Object),
        costCenterSelectMultiple: expect.any(Object),
        costCenterSelectSingle: expect.any(Object),
      }),
    );

    const historyContext = await browser.newContext({
      baseURL: CLIENT_BASE_URL,
    });
    const historyPage = await historyContext.newPage();
    const runtimeOptionRequests: string[] = [];

    try {
      await routeFeatureApi(historyPage);
      await authenticateFeatureMember(historyPage, 'member-001');
      historyPage.on('request', (request): void => {
        if (
          request.url().includes('/graphql') &&
          request.postData()?.includes('formFieldOptions')
        ) {
          runtimeOptionRequests.push(request.url());
        }
      });
      await historyPage.goto(`/instances/${RETURNED_INSTANCE_ID}`);

      await expect(
        historyPage.getByText('TW01 成本中心 006', { exact: true }),
      ).toBeVisible();
      await expect(
        historyPage.getByText('TW01 成本中心 007', { exact: true }),
      ).toBeVisible();
      expect(runtimeOptionRequests).toEqual([]);
    } finally {
      await historyContext.close();
    }
  });
});

async function routeFeatureApi(page: Page): Promise<void> {
  if (!FEATURE_API_URL) {
    return;
  }

  const featureOrigin = new URL(FEATURE_API_URL).origin;

  await page.route(
    'http://localhost:17603/**',
    async (route): Promise<void> => {
      const requestUrl = new URL(route.request().url());
      const targetUrl = new URL(
        `${requestUrl.pathname}${requestUrl.search}`,
        featureOrigin,
      );
      await route.continue({ url: targetUrl.toString() });
    },
  );
}

async function authenticateFeatureMember(
  page: Page,
  identifier: string,
): Promise<void> {
  const response = await page.context().request.post(
    `${FEATURE_API_URL.replace(/\/$/u, '')}/auth/login`,
    { data: { identifier, password: 'demo' } },
  );

  if (!response.ok()) {
    throw new Error(
      `Feature API login failed with HTTP ${response.status()}: ${await response.text()}`,
    );
  }
}

async function chooseOption(
  page: Page,
  fieldKey: string,
  optionLabel: string,
): Promise<void> {
  const trigger = page.locator(
    `[data-form-field-key="${fieldKey}"] .mzn-select-trigger`,
  );

  if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
    await trigger.click();
  }

  await page
    .getByRole('option', { name: optionLabel, exact: true })
    .click();
}

async function searchAndChooseOption(
  page: Page,
  fieldKey: string,
  optionLabel: string,
): Promise<void> {
  const input = page
    .locator(`[data-form-field-key="${fieldKey}"] input`)
    .first();
  await input.fill(optionLabel);
  const listId = await input.getAttribute('aria-controls');
  const options = listId
    ? page.locator(`#${listId}`).getByRole('option', {
        name: optionLabel,
        exact: true,
      })
    : page.getByRole('option', { name: optionLabel, exact: true });
  await expect(options).toBeVisible();
  await options.click();
}

async function readApprovalInstance(
  page: Page,
  instanceId: string,
): Promise<ApprovalInstanceData['approvalInstance']> {
  const response = await page.context().request.post(FEATURE_GRAPHQL_URL, {
    data: {
      query: `query ReadSubmittedInstance($id: String!) {
        approvalInstance(id: $id) {
          formDataJson
          formDataOptionSnapshotJson
          id
        }
      }`,
      variables: { id: instanceId },
    },
  });
  const body = (await response.json()) as GraphQlResponse<ApprovalInstanceData>;

  if (!response.ok() || !body.data) {
    throw new Error(
      `Submitted instance read failed: ${JSON.stringify(body.errors ?? [])}`,
    );
  }

  return body.data.approvalInstance;
}
