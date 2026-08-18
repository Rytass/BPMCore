import { expect, Locator, Page, test } from '@playwright/test';

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
// Companion fixture backed by `demo.cost-centers-optional-filter@1`, the only
// registered source that declares an optional (`required: false`) parameter.
const OPTIONAL_TEMPLATE_ID = '50000000-0000-4000-8000-000000000007';
const OPTIONAL_RETURNED_INSTANCE_ID = '60000000-0000-4000-8000-000000000009';
const OPTIONAL_APPROVED_INSTANCE_ID = '60000000-0000-4000-8000-000000000010';

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

interface ApprovalInstanceStateData {
  readonly approvalInstance: {
    readonly formDataJson: string;
    readonly id: string;
    readonly state: string;
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

test.describe('DataSource paging reachability', () => {
  // `demo.cost-centers` serves 3 options per page, which fits the dropdown
  // exactly — nothing overflows, so `onReachBottom` never fires and everything
  // past page one used to be unselectable.
  test('reaches options beyond the first page of a paged source', async ({
    page,
  }): Promise<void> => {
    await routeFeatureApi(page);
    await authenticateFeatureMember(page, 'member-102');
    await page.goto(`/instances/new?templateId=${TEMPLATE_ID}`);
    await expect(page.getByRole('heading', { name: '發起簽核' })).toBeVisible();

    await chooseOption(page, 'plant', '台中廠 TW01');
    await openSelect(page, 'costCenterSelectSingle');

    await expect(
      page.getByRole('option', { name: 'TW01 成本中心 004', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('option', { name: 'TW01 成本中心 008', exact: true }),
    ).toBeVisible();

    await page
      .getByRole('option', { name: 'TW01 成本中心 008', exact: true })
      .click();
    await expect(
      fieldContainer(page, 'costCenterSelectSingle').locator('input').first(),
    ).toHaveValue('TW01 成本中心 008');
  });
});

test.describe('Optional DataSource parameter bindings', () => {
  test('keeps a control usable while the optional binding has no value', async ({
    page,
  }): Promise<void> => {
    await routeFeatureApi(page);
    await authenticateFeatureMember(page, 'member-102');
    await page.goto(`/instances/new?templateId=${OPTIONAL_TEMPLATE_ID}`);

    await expect(
      page.getByRole('heading', { name: '發起簽核' }),
    ).toBeVisible();
    // The required `plant` binding is still empty, so the control is blocked
    // for a reason the optional binding must never produce.
    await expect(
      fieldContainer(page, 'projectCostCenterSingle').getByText(
        '請先填寫相依欄位。',
      ),
    ).toBeVisible();

    await chooseOption(page, 'plant', '台中廠 TW01');

    // `costCategory` stays empty on purpose: it feeds the optional `category`
    // parameter, so the control must load the plant's whole list instead of
    // waiting for a value it does not need.
    await expect(
      fieldContainer(page, 'projectCostCenterSingle').getByText(
        '請先填寫相依欄位。',
      ),
    ).toHaveCount(0);
    await expect(
      fieldContainer(page, 'projectCostCenterSingle').locator('input').first(),
    ).toBeEnabled();

    await openSelect(page, 'projectCostCenterSingle');
    await expect(
      page.getByRole('option', { name: 'TW01 資本支出中心 001', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('option', { name: 'TW01 營運費用中心 001', exact: true }),
    ).toBeVisible();

    await page
      .getByRole('option', { name: 'TW01 資本支出中心 001', exact: true })
      .click();
    await chooseOption(page, 'projectCostCenterMultiple', 'TW01 營運費用中心 001');
    await page.keyboard.press('Escape');

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

    expect(
      JSON.parse(submitted.formDataJson) as Record<string, unknown>,
    ).toMatchObject({
      plant: 'TW01',
      projectCostCenterMultiple: ['CC-OPEX-TW01-001'],
      projectCostCenterSingle: 'CC-CAPEX-TW01-001',
    });
    expect(
      JSON.parse(submitted.formDataOptionSnapshotJson) as Record<
        string,
        unknown
      >,
    ).toEqual(
      expect.objectContaining({
        projectCostCenterMultiple: expect.any(Object),
        projectCostCenterSingle: expect.any(Object),
      }),
    );
  });

  test('narrows the option list once the optional binding gets a value', async ({
    page,
  }): Promise<void> => {
    await routeFeatureApi(page);
    await authenticateFeatureMember(page, 'member-102');
    await page.goto(`/instances/new?templateId=${OPTIONAL_TEMPLATE_ID}`);

    await expect(
      page.getByRole('heading', { name: '發起簽核' }),
    ).toBeVisible();
    await chooseOption(page, 'plant', '台中廠 TW01');
    await chooseOption(page, 'costCategory', '資本支出 CAPEX');

    await openSelect(page, 'projectCostCenterSingle');
    await expect(
      page.getByRole('option', { name: 'TW01 資本支出中心 001', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('option', { name: 'TW01 營運費用中心 001', exact: true }),
    ).toHaveCount(0);
  });

  test('blocks resubmit when a dependency change invalidates the kept values', async ({
    page,
  }): Promise<void> => {
    await routeFeatureApi(page);
    await authenticateFeatureMember(page, 'member-102');

    const resubmitRequests: string[] = [];
    page.on('request', (request): void => {
      if (
        request.url().includes('/graphql') &&
        request.postData()?.includes('resubmitApprovalInstance')
      ) {
        resubmitRequests.push(request.url());
      }
    });

    await page.goto(`/instances/${OPTIONAL_RETURNED_INSTANCE_ID}`);

    // The snapshot labels are visible before any provider call resolves. A
    // Select renders the chosen label as its combobox value, not as page text.
    await expect(
      fieldContainer(page, 'projectCostCenterSingle').locator('input').first(),
    ).toHaveValue('TW01 資本支出中心 001');

    await chooseOption(page, 'plant', '台北廠 TW02');

    // No TW01 cost center exists under TW02, so the kept values must end up
    // INVALID with every failed value named, not silently revalidated.
    await expect(
      fieldContainer(page, 'projectCostCenterSingle').getByText(
        '無法辨識選項：CC-CAPEX-TW01-001',
      ),
    ).toBeVisible();
    await expect(
      fieldContainer(page, 'projectCostCenterMultiple').getByText(
        '無法辨識選項：CC-CAPEX-TW01-002、CC-CAPEX-TW01-003',
      ),
    ).toBeVisible();

    await page.getByRole('button', { name: '重新送出' }).click();

    await expect(page.getByText('請先完成動態選項驗證。')).toBeVisible();
    expect(resubmitRequests).toEqual([]);

    const instance = await readApprovalInstanceState(
      page,
      OPTIONAL_RETURNED_INSTANCE_ID,
    );

    expect(instance.state).toBe('RETURNED');
    expect(JSON.parse(instance.formDataJson) as Record<string, unknown>).toEqual(
      expect.objectContaining({ plant: 'TW01' }),
    );
  });

  test('leaves an unfilled read-only dynamic field without an error', async ({
    page,
  }): Promise<void> => {
    await routeFeatureApi(page);
    await authenticateFeatureMember(page, 'member-102');

    const runtimeOptionRequests: string[] = [];
    page.on('request', (request): void => {
      if (
        request.url().includes('/graphql') &&
        request.postData()?.includes('formFieldOptions')
      ) {
        runtimeOptionRequests.push(request.url());
      }
    });

    await page.goto(`/instances/${OPTIONAL_APPROVED_INSTANCE_ID}`);

    // Read-only still renders the snapshot label as the combobox value.
    await expect(
      fieldContainer(page, 'projectCostCenterSingle').locator('input').first(),
    ).toHaveValue('TW02 資本支出中心 001');

    // `projectCostCenterNote` was never filled, so there is nothing to resolve
    // and nothing to report as broken.
    const noteField = fieldContainer(page, 'projectCostCenterNote');
    await expect(noteField).toBeVisible();
    await expect(noteField.getByText('選項來源暫時無法使用。')).toHaveCount(0);
    await expect(noteField.getByRole('button', { name: '重試' })).toHaveCount(0);
    expect(runtimeOptionRequests).toEqual([]);
  });

  // The DataSource gate only speaks for fields that still hold a value, so
  // clearing a required one has to be caught by the required-field check
  // instead of falling through to the backend's English error copy.
  test('blocks resubmit when a required dynamic value is cleared', async ({
    page,
  }): Promise<void> => {
    await routeFeatureApi(page);
    await authenticateFeatureMember(page, 'member-102');

    const resubmitRequests: string[] = [];
    page.on('request', (request): void => {
      if (
        request.url().includes('/graphql') &&
        request.postData()?.includes('resubmitApprovalInstance')
      ) {
        resubmitRequests.push(request.url());
      }
    });

    await page.goto(`/instances/${OPTIONAL_RETURNED_INSTANCE_ID}`);
    await expect(
      fieldContainer(page, 'projectCostCenterSingle').locator('input').first(),
    ).toHaveValue('TW01 資本支出中心 001');

    await clearSelectedTags(page, 'projectCostCenterMultiple');
    await page.getByRole('button', { name: '重新送出' }).click();

    await expect(page.getByText('請先補齊必填欄位。')).toBeVisible();
    expect(resubmitRequests).toEqual([]);
  });

  // Cancelling throws the case away, so an incomplete resubmit form must not
  // stand in its way.
  test('cancels a returned case even when a required value is cleared', async ({
    page,
  }): Promise<void> => {
    await routeFeatureApi(page);
    await authenticateFeatureMember(page, 'member-102');

    // Answer the mutation locally: the assertion is that the request is made
    // at all, and letting it through would cancel the shared seeded case.
    const cancelRequests: string[] = [];
    await page.route('**/graphql', async (route): Promise<void> => {
      if (!route.request().postData()?.includes('cancelApprovalInstance')) {
        await route.fallback();

        return;
      }

      cancelRequests.push(route.request().url());
      await route.fulfill({
        body: JSON.stringify({
          data: {
            cancelApprovalInstance: {
              id: OPTIONAL_RETURNED_INSTANCE_ID,
              state: 'CANCELLED',
            },
          },
        }),
        contentType: 'application/json',
        status: 200,
      });
    });

    await page.goto(`/instances/${OPTIONAL_RETURNED_INSTANCE_ID}`);
    await expect(
      fieldContainer(page, 'projectCostCenterSingle').locator('input').first(),
    ).toHaveValue('TW01 資本支出中心 001');

    await clearSelectedTags(page, 'projectCostCenterMultiple');
    await page.getByRole('button', { name: '取消案件' }).click();
    await page.getByRole('button', { name: '確認取消' }).click();

    await expect.poll((): number => cancelRequests.length).toBe(1);
    await expect(page.getByText('請先補齊必填欄位。')).toHaveCount(0);
  });
});

async function clearSelectedTags(
  page: Page,
  fieldKey: string,
): Promise<void> {
  const closeButtons = fieldContainer(page, fieldKey).locator(
    '.mzn-tag__close-button',
  );

  while ((await closeButtons.count()) > 0) {
    await closeButtons.first().click();
  }
}

function fieldContainer(page: Page, fieldKey: string): Locator {
  return page.locator(`[data-form-field-key="${fieldKey}"]`);
}

async function openSelect(page: Page, fieldKey: string): Promise<void> {
  await openSelectTrigger(page, fieldKey);
}

/**
 * Opens a select by its chevron rather than by the trigger's centre. Once a
 * `multiple` select carries chips, that centre lands on the first chip's close
 * icon — clicking it silently removes an already-selected value and never opens
 * the menu. The inner input is no refuge either: it spans the whole trigger, so
 * it sits under the same chip layer.
 */
async function openSelectTrigger(page: Page, fieldKey: string): Promise<void> {
  const trigger = page.locator(
    `[data-form-field-key="${fieldKey}"] .mzn-select-trigger`,
  );

  if ((await trigger.getAttribute('aria-expanded')) === 'true') {
    return;
  }

  const chevron = trigger.locator('.mzn-select-trigger__suffix-action-icon');

  if ((await chevron.count()) > 0) {
    await chevron.first().click();

    return;
  }

  await trigger.click();
}

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
  await openSelectTrigger(page, fieldKey);

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

async function readApprovalInstanceState(
  page: Page,
  instanceId: string,
): Promise<ApprovalInstanceStateData['approvalInstance']> {
  const response = await page.context().request.post(FEATURE_GRAPHQL_URL, {
    data: {
      query: `query ReadInstanceState($id: String!) {
        approvalInstance(id: $id) {
          formDataJson
          id
          state
        }
      }`,
      variables: { id: instanceId },
    },
  });
  const body =
    (await response.json()) as GraphQlResponse<ApprovalInstanceStateData>;

  if (!response.ok() || !body.data) {
    throw new Error(
      `Instance state read failed: ${JSON.stringify(body.errors ?? [])}`,
    );
  }

  return body.data.approvalInstance;
}
