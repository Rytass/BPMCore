import { expect, Page, Route, test } from '@playwright/test';

interface GraphQlPayload {
  readonly query: string;
  readonly variables?: Readonly<Record<string, unknown>>;
}

interface UpdateTemplateDraftInput {
  readonly formDefinitionVersionId: string | null;
  readonly workflowDefinitionJson: string;
}

const TEMPLATE_ID = 'e2e-template';
const TEMPLATE_VERSION_ID = 'e2e-template-version';
const FORM_ID = 'e2e-form';
const FORM_VERSION_ID = 'e2e-form-version';
const UPDATED_AT = '2026-05-04T09:00:00.000Z';

test.describe('M1 W3 template designer', () => {
  test('creates, designs, publishes, and reviews a template version', async ({
    page,
  }): Promise<void> => {
    await mockTemplateGraphQl(page);

    await page.goto('/templates');
    await page.getByRole('button', { name: '建立模板' }).click();
    await page.getByPlaceholder('例如：費用申請流程').fill('E2E 簽核模板');
    await Promise.all([
      page.waitForURL(`**/templates/${TEMPLATE_ID}/designer`, {
        timeout: 30_000,
      }),
      page.getByRole('button', { exact: true, name: '建立' }).click(),
    ]);

    await expect(page.getByText('E2E 簽核模板')).toBeVisible();
    await page.getByRole('button', { name: '簽核節點' }).click();
    await expect(
      page
        .locator('.react-flow__node')
        .filter({ hasText: 'lin.ceo@example.internal' }),
    ).toBeVisible();

    await page.getByRole('button', { name: '儲存草稿' }).click();
    await page.getByRole('button', { name: '發布版本' }).click();
    await expect(page.getByText(/已發布版本/u)).toBeVisible();

    await page.goto(`/templates/${TEMPLATE_ID}/versions`);
    await expect(page.getByText('PUBLISHED')).toBeVisible();
    await expect(page.getByText('E2E 表單 v1')).toBeVisible();
  });
});

async function mockTemplateGraphQl(page: Page): Promise<void> {
  let templateCurrentVersionId: string | null = null;
  let templateStatus: 'DRAFT' | 'PUBLISHED' = 'DRAFT';
  let templatePublishedAt: string | null = null;
  let workflowDefinitionJson = JSON.stringify(readEmptyWorkflowDefinition());
  let formDefinitionVersionId: string | null = null;

  await page.route('**/graphql', async (route: Route): Promise<void> => {
    const payload = readGraphQlPayload(route);
    const query = payload.query;

    if (query.includes('query ApprovalTemplates')) {
      await fulfillGraphQl(route, {
        approvalTemplates: [],
      });
      return;
    }

    if (query.includes('mutation CreateApprovalTemplate')) {
      await fulfillGraphQl(route, {
        createApprovalTemplate: { id: TEMPLATE_ID },
      });
      return;
    }

    if (query.includes('query TemplateDesigner')) {
      await fulfillGraphQl(route, {
        approvalTemplate: {
          category: null,
          currentVersionId: templateCurrentVersionId,
          description: null,
          id: TEMPLATE_ID,
          name: 'E2E 簽核模板',
          updatedAt: UPDATED_AT,
        },
        approvalTemplateVersions: [
          readTemplateVersion({
            formDefinitionVersionId,
            publishedAt: templatePublishedAt,
            status: templateStatus,
            workflowDefinitionJson,
          }),
        ],
        formDefinitions: [
          {
            currentVersionId: FORM_VERSION_ID,
            id: FORM_ID,
            name: 'E2E 表單',
            updatedAt: UPDATED_AT,
          },
        ],
      });
      return;
    }

    if (query.includes('query FormVersions')) {
      await fulfillGraphQl(route, {
        formDefinitionVersions: [
          {
            formDefinitionId: FORM_ID,
            id: FORM_VERSION_ID,
            publishedAt: UPDATED_AT,
            schemaJson: JSON.stringify({
              fields: [
                {
                  fieldKey: 'amount',
                  label: '申請金額',
                  required: true,
                  type: 'money',
                },
                {
                  fieldKey: 'department',
                  label: '申請部門',
                  options: [
                    { label: '財務部', value: 'finance' },
                    { label: '營運部', value: 'operations' },
                  ],
                  required: true,
                  type: 'select',
                },
              ],
              schemaVersion: 1,
            }),
            status: 'PUBLISHED',
            version: 1,
          },
        ],
      });
      return;
    }

    if (query.includes('query SelectedMembers')) {
      await fulfillGraphQl(route, {
        members: [
          {
            email: 'lin.ceo@example.internal',
            memberId: 'member-001',
            name: '林執行長',
          },
        ],
      });
      return;
    }

    if (query.includes('query MemberOptions')) {
      await fulfillGraphQl(route, {
        searchMembers: [
          {
            email: 'lin.ceo@example.internal',
            memberId: 'member-001',
            name: '林執行長',
          },
          {
            email: 'chen.manager@example.internal',
            memberId: 'member-101',
            name: '陳財務主管',
          },
        ],
      });
      return;
    }

    if (query.includes('mutation UpdateApprovalTemplateDraft')) {
      const input = readUpdateTemplateDraftInput(payload.variables?.input);
      formDefinitionVersionId = input.formDefinitionVersionId;
      workflowDefinitionJson = input.workflowDefinitionJson;
      await fulfillGraphQl(route, {
        updateApprovalTemplateDraft: readTemplateVersion({
          formDefinitionVersionId,
          publishedAt: templatePublishedAt,
          status: templateStatus,
          workflowDefinitionJson,
        }),
      });
      return;
    }

    if (query.includes('mutation PublishApprovalTemplateVersion')) {
      templateCurrentVersionId = TEMPLATE_VERSION_ID;
      templateStatus = 'PUBLISHED';
      templatePublishedAt = UPDATED_AT;
      await fulfillGraphQl(route, {
        publishApprovalTemplateVersion: readTemplateVersion({
          formDefinitionVersionId,
          publishedAt: templatePublishedAt,
          status: templateStatus,
          workflowDefinitionJson,
        }),
      });
      return;
    }

    await fulfillGraphQl(route, {});
  });
}

function readTemplateVersion({
  formDefinitionVersionId,
  publishedAt,
  status,
  workflowDefinitionJson,
}: {
  readonly formDefinitionVersionId: string | null;
  readonly publishedAt: string | null;
  readonly status: 'DRAFT' | 'PUBLISHED';
  readonly workflowDefinitionJson: string;
}): Readonly<Record<string, unknown>> {
  return {
    archivedAt: null,
    formDefinitionVersionId,
    id: TEMPLATE_VERSION_ID,
    initiatorPolicyCel: null,
    notificationConfigJson: null,
    publishedAt,
    slaDefaultsJson: null,
    status,
    updatedAt: UPDATED_AT,
    version: 1,
    workflowDefinitionJson,
  };
}

function readEmptyWorkflowDefinition(): Readonly<Record<string, unknown>> {
  return {
    edges: [],
    meta: { schemaVersion: 1 },
    nodes: [
      {
        data: { label: '開始' },
        id: 'start',
        position: { x: 80, y: 160 },
        type: 'startEvent',
      },
      {
        data: { endState: 'APPROVED', label: '完成', triggerMode: 'AND' },
        id: 'end',
        position: { x: 560, y: 160 },
        type: 'endEvent',
      },
    ],
  };
}

function readGraphQlPayload(route: Route): GraphQlPayload {
  const payload = route.request().postDataJSON() as unknown;

  if (!isRecord(payload) || typeof payload.query !== 'string') {
    throw new Error('GraphQL request payload is invalid');
  }

  return {
    query: payload.query,
    variables: isRecord(payload.variables) ? payload.variables : undefined,
  };
}

function readUpdateTemplateDraftInput(
  value: unknown,
): UpdateTemplateDraftInput {
  if (
    !isRecord(value) ||
    typeof value.workflowDefinitionJson !== 'string' ||
    (typeof value.formDefinitionVersionId !== 'string' &&
      value.formDefinitionVersionId !== null)
  ) {
    throw new Error('UpdateApprovalTemplateDraft input is invalid');
  }

  return {
    formDefinitionVersionId: value.formDefinitionVersionId,
    workflowDefinitionJson: value.workflowDefinitionJson,
  };
}

async function fulfillGraphQl(
  route: Route,
  data: Readonly<Record<string, unknown>>,
): Promise<void> {
  await route.fulfill({
    contentType: 'application/json',
    json: { data },
    status: 200,
  });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
