import { expect, Page, test } from '@playwright/test';

// Mirrors the DataSource spec's defaults so a plain `pnpm e2e:client` runs this
// golden path instead of skipping it.
const FEATURE_API_URL =
  process.env.E2E_TABLE_FIELD_API_URL ??
  process.env.E2E_API_URL ??
  'http://localhost:17603';
const FEATURE_GRAPHQL_URL = `${FEATURE_API_URL.replace(/\/$/u, '')}/graphql`;
// The offline history check opens its own context, so it needs the same
// baseURL override the Playwright config honours.
const CLIENT_BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:17602';
// `請購明細申請（表格）` and its returned instance, both from the demo seed.
const TEMPLATE_ID = '50000000-0000-4000-8000-000000000008';
const RETURNED_INSTANCE_ID = '60000000-0000-4000-8000-000000000011';

interface GraphQlResponse<TData> {
  readonly data?: TData;
  readonly errors?: readonly { readonly message: string }[];
}

interface ApprovalInstanceData {
  readonly approvalInstance: {
    readonly formDataJson: string;
    readonly formDataOptionSnapshotJson: string;
    readonly id: string;
    readonly state: string;
  };
}

interface TableRow {
  readonly costCenter?: string;
  readonly item?: string;
  readonly plant?: string;
  readonly quantity?: number;
  readonly urgent?: boolean;
}

test.describe('Seeded table field golden path', () => {
  test('fills a table row by row, submits per-cell snapshots, and renders history offline', async ({
    browser,
    page,
  }): Promise<void> => {
    await routeFeatureApi(page);
    await authenticateFeatureMember(page, 'member-102');
    await page.goto(`/instances/new?templateId=${TEMPLATE_ID}`);

    await expect(page.getByRole('heading', { name: '發起簽核' })).toBeVisible();

    // `minRows: 1` seeds one row, and its cost centre cell is waiting on the
    // plant cell of that same row — the state no flat form can produce.
    await expect(readCell(page, 0, 'costCenter').locator('input')).toBeDisabled();
    await expect(page.getByText('請先填寫相依欄位。').first()).toBeVisible();

    await chooseCellOption(page, 0, 'plant', '台中廠 TW01');
    await chooseCellOption(page, 0, 'costCenter', 'TW01 成本中心 001');
    await fillCell(page, 0, 'item', '六角螺絲 M8');
    await fillCell(page, 0, 'quantity', '120');

    await page.getByRole('button', { name: '新增品項' }).click();

    // The new row starts waiting on its own plant while the first row keeps the
    // value it already resolved.
    await expect(readCell(page, 1, 'costCenter').locator('input')).toBeDisabled();
    await expect(readCell(page, 0, 'costCenter').locator('input')).toHaveValue(
      'TW01 成本中心 001',
    );

    await chooseCellOption(page, 1, 'plant', '台北廠 TW02');
    // Each row queries with its own plant, so TW01 options must not appear here.
    await openCellSelect(page, 1, 'costCenter');
    await expect(
      page.getByRole('option', { name: 'TW02 成本中心 001', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('option', { name: 'TW01 成本中心 001', exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole('option', { name: 'TW02 成本中心 001', exact: true })
      .click();

    await fillCell(page, 1, 'item', '不鏽鋼墊圈');
    await fillCell(page, 1, 'quantity', '40');
    await page
      .locator('[data-form-field-key="purpose"] input')
      .first()
      .fill('E2E 表格請購');

    await page.getByRole('button', { name: '送出', exact: true }).click();
    await page.waitForURL(/\/instances\/[0-9a-f-]{36}$/u);

    const instanceId = page.url().split('/').pop() ?? '';
    const instance = await readApprovalInstance(page, instanceId);
    const rows = JSON.parse(instance.formDataJson).items as readonly TableRow[];

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      costCenter: 'CC-TW01-001',
      item: '六角螺絲 M8',
      plant: 'TW01',
      quantity: 120,
    });
    expect(rows[1]).toMatchObject({
      costCenter: 'CC-TW02-001',
      item: '不鏽鋼墊圈',
      plant: 'TW02',
      quantity: 40,
    });

    // Snapshot keys are instance paths, one per dynamic cell (ADR 16 §3.6).
    const snapshots = JSON.parse(instance.formDataOptionSnapshotJson) as Readonly<
      Record<string, { readonly options: readonly { readonly label: string }[] }>
    >;
    expect(Object.keys(snapshots).sort()).toEqual([
      'items[0].costCenter',
      'items[1].costCenter',
    ]);
    expect(snapshots['items[0].costCenter']?.options[0]?.label).toBe(
      'TW01 成本中心 001',
    );
    expect(snapshots['items[1].costCenter']?.options[0]?.label).toBe(
      'TW02 成本中心 001',
    );

    // The case title skips the table and takes the first scalar field.
    await expect(
      page.getByRole('heading', { name: '請購事由：E2E 表格請購' }),
    ).toBeVisible();

    // Read-only history must render from the snapshot alone, so the whole
    // DataSource host is taken away for this check.
    const offlineContext = await browser.newContext({
      baseURL: CLIENT_BASE_URL,
    });

    try {
      const offlinePage = await offlineContext.newPage();
      await offlineContext.request.post(
        `${FEATURE_API_URL.replace(/\/$/u, '')}/auth/login`,
        { data: { identifier: 'member-102', password: 'demo' } },
      );
      await routeFeatureApi(offlinePage);
      await offlinePage.route(
        '**/graphql',
        async (route): Promise<void> => {
          const body = route.request().postData() ?? '';

          if (body.includes('formFieldOptions')) {
            await route.abort();

            return;
          }

          await route.continue();
        },
      );
      await offlinePage.goto(`${page.url()}`);

      await expect(
        offlinePage.getByText('TW01 成本中心 001').first(),
      ).toBeVisible();
      await expect(
        offlinePage.getByText('TW02 成本中心 001').first(),
      ).toBeVisible();
    } finally {
      await offlineContext.close();
    }
  });

  test('keeps every row when a returned case is edited and resubmitted', async ({
    page,
  }): Promise<void> => {
    await routeFeatureApi(page);
    await authenticateFeatureMember(page, 'member-102');
    await page.goto(`/instances/${RETURNED_INSTANCE_ID}`);

    await expect(page.getByRole('button', { name: '重新送出' })).toBeVisible();

    // Both seeded rows load with their stored values and snapshot labels; the
    // dynamic cell must not need reselecting (ADR 14 §3.9).
    await expect(readCell(page, 0, 'costCenter').locator('input')).toHaveValue(
      'TW01 成本中心 001',
    );
    await expect(readCell(page, 1, 'costCenter').locator('input')).toHaveValue(
      'TW02 成本中心 002',
    );

    await fillCell(page, 0, 'quantity', '150');
    await page.getByRole('button', { name: '重新送出' }).click();

    await expect(page.getByRole('button', { name: '重新送出' })).toHaveCount(0);

    const instance = await readApprovalInstance(page, RETURNED_INSTANCE_ID);
    const rows = JSON.parse(instance.formDataJson).items as readonly TableRow[];

    expect(instance.state).toBe('RUNNING');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.quantity).toBe(150);
    // The untouched row keeps its value rather than being cleared by the edit.
    expect(rows[1]).toMatchObject({
      costCenter: 'CC-TW02-002',
      item: '不鏽鋼墊圈',
      plant: 'TW02',
    });
    expect(
      Object.keys(
        JSON.parse(instance.formDataOptionSnapshotJson) as Readonly<
          Record<string, unknown>
        >,
      ).sort(),
    ).toEqual(['items[0].costCenter', 'items[1].costCenter']);
  });
});

function readCell(page: Page, rowIndex: number, columnKey: string) {
  return page.locator(
    `[data-form-field-key="items[${rowIndex}].${columnKey}"]`,
  );
}

async function fillCell(
  page: Page,
  rowIndex: number,
  columnKey: string,
  value: string,
): Promise<void> {
  await readCell(page, rowIndex, columnKey).locator('input').first().fill(value);
}

/**
 * Opens a cell select by its chevron rather than its centre, for the same
 * reason the DataSource spec does: the centre can land on a chip's close icon.
 */
async function openCellSelect(
  page: Page,
  rowIndex: number,
  columnKey: string,
): Promise<void> {
  const trigger = readCell(page, rowIndex, columnKey).locator(
    '.mzn-select-trigger',
  );

  if ((await trigger.getAttribute('aria-expanded')) === 'true') {
    return;
  }

  await trigger.locator('.mzn-select-trigger__suffix-action-icon').click();
}

async function chooseCellOption(
  page: Page,
  rowIndex: number,
  columnKey: string,
  optionLabel: string,
): Promise<void> {
  await openCellSelect(page, rowIndex, columnKey);
  await page.getByRole('option', { name: optionLabel, exact: true }).click();
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

async function readApprovalInstance(
  page: Page,
  instanceId: string,
): Promise<ApprovalInstanceData['approvalInstance']> {
  const response = await page.context().request.post(FEATURE_GRAPHQL_URL, {
    data: {
      query: `query ReadTableInstance($id: String!) {
        approvalInstance(id: $id) {
          formDataJson
          formDataOptionSnapshotJson
          id
          state
        }
      }`,
      variables: { id: instanceId },
    },
  });
  const body = (await response.json()) as GraphQlResponse<ApprovalInstanceData>;

  if (!response.ok() || !body.data) {
    throw new Error(
      `Table instance read failed: ${JSON.stringify(body.errors ?? [])}`,
    );
  }

  return body.data.approvalInstance;
}
