import { expect, Page, test } from '@playwright/test';
import { authenticateApiMember } from './_helpers/auth';

interface GraphQlError {
  readonly message: string;
}

interface GraphQlResponse<TData> {
  readonly data?: TData;
  readonly errors?: readonly GraphQlError[];
}

interface ApprovalInstanceRecord {
  readonly formDataJson: string;
  readonly formDataOptionSnapshotJson: string;
  readonly formDefinitionSnapshotJson: string;
  readonly id: string;
  readonly title: string;
}

interface ApprovalInstancesData {
  readonly approvalInstances: readonly ApprovalInstanceRecord[];
}

interface WorkflowDashboardSummaryData {
  readonly workflowDashboardSummary: {
    readonly totalInstanceCount: number;
  };
}

type ApprovalInstanceView = 'ALL' | 'CC' | 'SENT';
type FormFieldValue = boolean | number | readonly string[] | string | null;

interface FormFieldRecord {
  readonly fieldKey: string;
  readonly label?: string;
  readonly options?: readonly SelectOptionRecord[];
  readonly type?: string;
}

interface FormDefinitionSnapshotRecord {
  readonly schema?: {
    readonly fields?: readonly FormFieldRecord[];
  };
  readonly uiSchema?: {
    readonly layout?: readonly {
      readonly fieldKey: string;
    }[];
  };
}

interface SelectOptionRecord {
  readonly label: string;
  readonly value: string;
}

const GRAPHQL_URL =
  process.env.E2E_GRAPHQL_URL ?? 'http://localhost:17603/graphql';

test.describe('Develop seeded workspace journey', () => {
  test('shows real seeded dashboard, CC, and search data', async ({
    page,
  }): Promise<void> => {
    await authenticateApiMember(page, 'member-001');

    const [summary, ccInstances, searchInstances] = await Promise.all([
      readDashboardSummary(page),
      readApprovalInstances(page, 'CC'),
      readApprovalInstances(page, 'ALL'),
    ]);

    test.skip(
      summary.totalInstanceCount === 0 || searchInstances.length === 0,
      'requires seeded develop approval instances',
    );

    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: '工作台' })).toBeVisible();
    await expect(
      page
        .getByRole('link', { name: '前往案件總數' })
        .getByText(String(summary.totalInstanceCount)),
    ).toBeVisible();

    if (ccInstances[0]) {
      await page.goto('/cc');
      await expect(
        page.getByRole('heading', { name: '抄送給我' }),
      ).toBeVisible();
      await expect(
        page.getByText(readApprovalInstanceCaseTitle(ccInstances[0])),
      ).toBeVisible();
    }

    await page.goto('/search');
    await expect(page.getByRole('heading', { name: '案件搜尋' })).toBeVisible();
    // Earlier specs submit cases whose title can repeat a seeded one (the
    // DataSource golden path files one titled after its plant), so the newest
    // title may appear on several rows.
    await expect(
      page.getByText(readApprovalInstanceCaseTitle(searchInstances[0])).first(),
    ).toBeVisible();
  });

  test('shows real seeded sent data for a requester', async ({
    page,
  }): Promise<void> => {
    await authenticateApiMember(page, 'member-502');

    const sentInstances = await readApprovalInstances(page, 'SENT');

    test.skip(
      sentInstances.length === 0,
      'requires seeded develop sent approval instances for member-502',
    );

    await page.goto('/sent');
    await expect(page.getByRole('heading', { name: '我發起的' })).toBeVisible();
    await expect(
      page.getByText(readApprovalInstanceCaseTitle(sentInstances[0])),
    ).toBeVisible();
  });
});

async function readDashboardSummary(
  page: Page,
): Promise<WorkflowDashboardSummaryData['workflowDashboardSummary']> {
  const data = await requestGraphQl<WorkflowDashboardSummaryData>(
    page,
    `query SeededWorkspaceDashboardSummary {
      workflowDashboardSummary {
        totalInstanceCount
      }
    }`,
  );

  return data.workflowDashboardSummary;
}

async function readApprovalInstances(
  page: Page,
  view: ApprovalInstanceView,
): Promise<readonly ApprovalInstanceRecord[]> {
  const data = await requestGraphQl<ApprovalInstancesData>(
    page,
    `query SeededWorkspaceApprovalInstances($view: ApprovalInstanceListView!) {
      approvalInstances(view: $view, page: 1, pageSize: 1) {
        formDataJson
        formDataOptionSnapshotJson
        formDefinitionSnapshotJson
        id
        title
      }
    }`,
    { view },
  );

  return data.approvalInstances;
}

async function requestGraphQl<TData>(
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

function readApprovalInstanceCaseTitle(
  instance: ApprovalInstanceRecord,
): string {
  const formData = JSON.parse(instance.formDataJson) as Readonly<
    Record<string, FormFieldValue | undefined>
  >;
  const snapshot = JSON.parse(
    instance.formDefinitionSnapshotJson,
  ) as FormDefinitionSnapshotRecord;
  const optionSnapshots = JSON.parse(
    instance.formDataOptionSnapshotJson,
  ) as Readonly<
    Record<string, { readonly options?: readonly SelectOptionRecord[] }>
  >;
  const firstField = readFirstCaseTitleField(snapshot);

  if (!firstField) {
    return instance.title || instance.id;
  }

  const valueLabel = readFieldValueLabel(
    firstField,
    formData[firstField.fieldKey],
    optionSnapshots[firstField.fieldKey]?.options,
  );

  return valueLabel
    ? `${firstField.label ?? firstField.fieldKey}：${valueLabel}`
    : instance.title || instance.id;
}

function readFirstCaseTitleField(
  snapshot: FormDefinitionSnapshotRecord,
): FormFieldRecord | null {
  const fields = snapshot.schema?.fields ?? [];

  if (fields.length === 0) {
    return null;
  }

  const fieldsByKey = new Map(fields.map((field) => [field.fieldKey, field]));
  const firstLayoutField = snapshot.uiSchema?.layout
    ?.map((layoutItem) => fieldsByKey.get(layoutItem.fieldKey) ?? null)
    .find((field): field is FormFieldRecord => Boolean(field));

  return firstLayoutField ?? fields[0] ?? null;
}

function readFieldValueLabel(
  field: FormFieldRecord,
  value: FormFieldValue | undefined,
  snapshotOptions: readonly SelectOptionRecord[] | undefined,
): string | null {
  // A data-source field has no static options; its names live in the case's
  // option snapshot, as in the lib's readFormDataCaseTitle.
  const options = field.options ?? snapshotOptions ?? [];

  if (typeof value === 'undefined' || value === null) {
    return null;
  }

  if (Array.isArray(value)) {
    const labels = value.map((item) => readOptionLabel(options, item));
    const label = labels.filter((item) => item.trim()).join('、');

    return label || null;
  }

  if (field.type === 'boolean') {
    return value === true ? '是' : '否';
  }

  if (typeof value === 'string') {
    return readOptionLabel(options, value) || null;
  }

  return String(value).trim() || null;
}

function readOptionLabel(
  options: readonly SelectOptionRecord[],
  value: string,
): string {
  return (
    options.find((option) => option.value === value)?.label ?? value
  ).trim();
}
