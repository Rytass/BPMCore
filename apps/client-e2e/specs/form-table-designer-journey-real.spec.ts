import { expect, Locator, Page, test } from '@playwright/test';
import { authenticateApiMember } from './_helpers/auth';

/**
 * The journey the seeded table spec deliberately skips: designing a table field
 * in the builder, publishing it through the wizard, and filling the form that
 * comes out. Needs the demo DataSource seed (`pnpm demo:reset`) because the
 * dynamic column binds to `demo.cost-centers`.
 *
 * Each run publishes a template of its own, so it is re-entrant.
 */

const API = process.env.E2E_API_URL ?? 'http://localhost:17603';

// The builder's menus open downward and Mezzanine's dropdown never flips, so a
// short viewport hides the last options of the column type list.
test.use({ viewport: { width: 1600, height: 1200 } });
test.setTimeout(180_000);

function columnRow(page: Page, index: number): Locator {
  return page.locator('tr:has(td.mzn-table__drag-or-pin-handle-cell)').nth(index);
}

/** The settings of the open column render inside their own row. */
function openColumnSettings(page: Page): Locator {
  return page.locator('tr:has(.mzn-form-field)');
}

function settingField(page: Page, label: string): Locator {
  return openColumnSettings(page)
    .locator('.mzn-form-field')
    .filter({ hasText: label })
    .first();
}

function fieldSetting(page: Page, label: string): Locator {
  return page.locator('.mzn-form-field').filter({ hasText: label }).first();
}

/**
 * Opens a select by its chevron: the trigger's centre lands on the readonly
 * input, which does not open the menu.
 */
async function openSelect(scope: Locator): Promise<void> {
  await scope.locator('.mzn-select-trigger__suffix-action-icon').first().click();
}

async function pickOption(page: Page, name: string): Promise<void> {
  const option = page
    .locator('[role="option"]')
    .filter({ hasText: new RegExp(`^${name}$`) });
  await option.scrollIntoViewIfNeeded();
  await option.click();
}

async function setColumnTitle(
  page: Page,
  index: number,
  title: string,
): Promise<void> {
  await columnRow(page, index).locator('td').nth(2).locator('input').fill(title);
}

/** Changing a column's type also opens that column's settings. */
async function setColumnType(
  page: Page,
  index: number,
  type: string,
): Promise<void> {
  await openSelect(columnRow(page, index).locator('td').nth(3));
  await pickOption(page, type);
}

async function setOpenColumnKey(page: Page, key: string): Promise<void> {
  await settingField(page, '欄位 Key').locator('input').fill(key);
}

test.describe('Table field designer journey', () => {
  test('designs, publishes and fills a table with per-row dynamic options', async ({
    page,
  }): Promise<void> => {
    await authenticateApiMember(page, 'member-001');
    await page.goto('/templates/compose');
    await expect(
      page.getByRole('heading', { name: '建立模板（表單 + 流程）' }),
    ).toBeVisible();

    const templateName = `表格動態選項 E2E ${Date.now()}`;
    await page.getByPlaceholder('例如：請款簽核').fill(templateName);

    // A scalar field first: the case title takes the first non-table field.
    await page.getByRole('button', { name: /^文字$/u }).click();
    await fieldSetting(page, '標題').locator('input').first().fill('請購事由');
    await fieldSetting(page, '欄位 Key').locator('input').first().fill('purpose');

    await page.getByRole('button', { name: /^表格$/u }).click();
    await expect(page.getByText('欄（1）')).toBeVisible();
    await fieldSetting(page, '欄位 Key').locator('input').first().fill('items');

    // Column 1 — plant, static options.
    await setColumnTitle(page, 0, '廠別');
    await setColumnType(page, 0, '下拉選單');
    await expect(settingField(page, '選項來源')).toBeVisible();
    await setOpenColumnKey(page, 'plant');

    const openInputs = openColumnSettings(page).locator('input');
    const inputCount = await openInputs.count();
    await openInputs.nth(inputCount - 4).fill('台中廠 TW01');
    await openInputs.nth(inputCount - 3).fill('TW01');
    await openInputs.nth(inputCount - 2).fill('台北廠 TW02');
    await openInputs.nth(inputCount - 1).fill('TW02');

    // Column 2 — cost centre, resolved per row from that row's plant.
    await page.getByRole('button', { name: /^新增欄$/u }).click();
    await setColumnTitle(page, 1, '成本中心');
    await setColumnType(page, 1, '下拉選單');
    await setOpenColumnKey(page, 'costCenter');
    await openSelect(settingField(page, '選項來源'));
    await pickOption(page, 'Demo 成本中心（分頁）');
    await openSelect(page.locator('[data-data-source-parameter="plant"]'));
    await pickOption(page, '同列：廠別');
    await expect(page.getByText('隨同列「廠別」變動')).toBeVisible();

    // Column 3 — quantity.
    await page.getByRole('button', { name: /^新增欄$/u }).click();
    await setColumnTitle(page, 2, '數量');
    await setColumnType(page, 2, '數字');
    await setOpenColumnKey(page, 'quantity');

    await page.getByRole('button', { name: '下一步' }).click();
    await expect(page.getByRole('heading', { name: '流程工具' })).toBeVisible();

    // A graph with no path to an end event cannot be published.
    const source = page.locator(
      '.react-flow__node[data-id="start"] .react-flow__handle.source',
    );
    const target = page.locator(
      '.react-flow__node[data-id="end"] .react-flow__handle.target',
    );
    const from = await source.boundingBox();
    const to = await target.boundingBox();

    if (!from || !to) {
      throw new Error('The start and end nodes did not render their handles.');
    }

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y + 10, { steps: 8 });
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
      steps: 12,
    });
    await page.mouse.up();
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);

    await page.getByRole('button', { name: '下一步' }).click();
    await page.getByRole('button', { name: '發佈' }).click();

    const templateId = await readPublishedTemplateId(page, templateName);

    await page.goto(`/instances/new?templateId=${templateId}`);
    await expect(page.getByRole('heading', { name: '發起簽核' })).toBeVisible();
    await page
      .locator('[data-form-field-key="purpose"] input')
      .first()
      .fill('E2E 表格請購');

    const cell = (row: number, key: string): Locator =>
      page.locator(`[data-form-field-key="items[${row}].${key}"]`);

    // The row waits on its own plant before it offers a cost centre at all.
    await expect(cell(0, 'costCenter').locator('input')).toBeDisabled();

    await openSelect(cell(0, 'plant'));
    await pickOption(page, '台中廠 TW01');
    await openSelect(cell(0, 'costCenter'));
    await expect(
      page.getByRole('option', { name: 'TW01 成本中心 001', exact: true }),
    ).toBeVisible();
    await pickOption(page, 'TW01 成本中心 001');
    await cell(0, 'quantity').locator('input').first().fill('120');

    await page.getByRole('button', { name: '新增一列' }).click();
    await openSelect(cell(1, 'plant'));
    await pickOption(page, '台北廠 TW02');
    await openSelect(cell(1, 'costCenter'));
    // Each row queries with its own plant, so the first row's options must not
    // appear here.
    await expect(
      page.getByRole('option', { name: 'TW02 成本中心 001', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('option', { name: 'TW01 成本中心 001', exact: true }),
    ).toHaveCount(0);
    await pickOption(page, 'TW02 成本中心 001');
    await cell(1, 'quantity').locator('input').first().fill('40');

    // The first row keeps what it resolved while the second was being filled.
    await expect(cell(0, 'costCenter').locator('input')).toHaveValue(
      'TW01 成本中心 001',
    );

    await page.getByRole('button', { name: '送出', exact: true }).click();
    await page.waitForURL(/\/instances\/[0-9a-f-]{36}$/u, { timeout: 30_000 });

    const instance = await readInstance(page, page.url().split('/').pop() ?? '');
    const formData = JSON.parse(instance.formDataJson) as {
      readonly items: readonly Readonly<Record<string, unknown>>[];
    };
    const snapshots = JSON.parse(
      instance.formDataOptionSnapshotJson,
    ) as Readonly<Record<string, { readonly options: readonly { readonly label: string }[] }>>;

    expect(formData.items).toHaveLength(2);
    expect(formData.items[0]).toMatchObject({
      costCenter: 'CC-TW01-001',
      plant: 'TW01',
      quantity: 120,
    });
    expect(formData.items[1]).toMatchObject({
      costCenter: 'CC-TW02-001',
      plant: 'TW02',
      quantity: 40,
    });
    // One snapshot per dynamic cell, keyed by instance path.
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
    // The title skips the table and takes the scalar field.
    expect(instance.title).toContain('E2E 表格請購');
  });
});

async function readPublishedTemplateId(
  page: Page,
  name: string,
): Promise<string> {
  await expect(async (): Promise<void> => {
    const response = await page.context().request.post(`${API}/graphql`, {
      data: {
        query: `query FindPublishedTemplate($text: String) {
          approvalTemplates(searchText: $text, page: 1, pageSize: 5) { id name }
        }`,
        variables: { text: name },
      },
    });
    const body = (await response.json()) as {
      readonly data?: {
        readonly approvalTemplates?: readonly { readonly id: string }[];
      };
    };

    expect(body.data?.approvalTemplates ?? []).not.toHaveLength(0);
  }).toPass({ timeout: 30_000 });

  const response = await page.context().request.post(`${API}/graphql`, {
    data: {
      query: `query FindPublishedTemplate($text: String) {
        approvalTemplates(searchText: $text, page: 1, pageSize: 5) { id name }
      }`,
      variables: { text: name },
    },
  });
  const body = (await response.json()) as {
    readonly data: {
      readonly approvalTemplates: readonly { readonly id: string }[];
    };
  };

  return body.data.approvalTemplates[0]?.id ?? '';
}

async function readInstance(
  page: Page,
  instanceId: string,
): Promise<{
  readonly formDataJson: string;
  readonly formDataOptionSnapshotJson: string;
  readonly state: string;
  readonly title: string;
}> {
  const response = await page.context().request.post(`${API}/graphql`, {
    data: {
      query: `query ReadDesignedInstance($id: String!) {
        approvalInstance(id: $id) {
          formDataJson
          formDataOptionSnapshotJson
          state
          title
        }
      }`,
      variables: { id: instanceId },
    },
  });
  const body = (await response.json()) as {
    readonly data: {
      readonly approvalInstance: {
        readonly formDataJson: string;
        readonly formDataOptionSnapshotJson: string;
        readonly state: string;
        readonly title: string;
      };
    };
  };

  return body.data.approvalInstance;
}
