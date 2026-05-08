import { expect, Page, Route, test } from '@playwright/test';

interface GraphQlPayload {
  readonly query: string;
  readonly variables?: Readonly<Record<string, unknown>>;
}

const LAUNCHABLE_TEMPLATE_ID = 'launchable-template';
const LAUNCHABLE_TEMPLATE_VERSION_ID = 'launchable-template-version';
const DRAFT_TEMPLATE_ID = 'draft-template';
const DRAFT_TEMPLATE_VERSION_ID = 'draft-template-version';
const FORM_VERSION_ID = 'launchable-form-version';
const UPDATED_AT = '2026-05-06T10:00:00.000Z';

test.describe('Workflow launch entry', () => {
  test('opens the launch center from the workbench and selects a launchable template', async ({
    page,
  }): Promise<void> => {
    await mockLaunchEntryGraphQl(page);

    await page.goto('/');
    await Promise.all([
      page.waitForURL('**/instances/new', { timeout: 30_000 }),
      page.getByRole('button', { name: '發起簽核' }).click(),
    ]);

    await expect(page.getByText('E2E 可發起流程')).toBeVisible();
    await expect(page.getByText('E2E 草稿流程')).not.toBeVisible();

    await Promise.all([
      page.waitForURL(`**/instances/new?templateId=${LAUNCHABLE_TEMPLATE_ID}`, {
        timeout: 30_000,
      }),
      page.getByRole('button', { name: '發起' }).click(),
    ]);

    await expect(page.getByText('E2E 可發起流程 · 表單 v2')).toBeVisible();
    await expect(page.getByText('申請原因')).toBeVisible();
  });
});

async function mockLaunchEntryGraphQl(page: Page): Promise<void> {
  await page.route('**/graphql', async (route: Route): Promise<void> => {
    const payload = readGraphQlPayload(route);

    if (payload.query.includes('query ApprovalTemplates')) {
      await fulfillGraphQl(route, {
        approvalTemplates: [
          {
            currentVersionId: LAUNCHABLE_TEMPLATE_VERSION_ID,
            id: LAUNCHABLE_TEMPLATE_ID,
            name: 'E2E 可發起流程',
            updatedAt: UPDATED_AT,
          },
          {
            currentVersionId: DRAFT_TEMPLATE_VERSION_ID,
            id: DRAFT_TEMPLATE_ID,
            name: 'E2E 草稿流程',
            updatedAt: UPDATED_AT,
          },
        ],
      });
      return;
    }

    if (payload.query.includes('query LaunchTemplateVersions')) {
      await fulfillGraphQl(route, {
        approvalTemplateVersions: readTemplateVersions(
          readTemplateId(payload.variables),
        ),
      });
      return;
    }

    if (payload.query.includes('query LaunchTemplate')) {
      await fulfillGraphQl(route, {
        approvalTemplate: {
          currentVersionId: LAUNCHABLE_TEMPLATE_VERSION_ID,
          id: LAUNCHABLE_TEMPLATE_ID,
          name: 'E2E 可發起流程',
        },
        approvalTemplateVersions: readTemplateVersions(LAUNCHABLE_TEMPLATE_ID),
      });
      return;
    }

    if (payload.query.includes('query LaunchFormVersion')) {
      await fulfillGraphQl(route, {
        formDefinitionVersion: {
          id: FORM_VERSION_ID,
          schemaJson: JSON.stringify({
            fields: [
              {
                fieldKey: 'reason',
                label: '申請原因',
                required: true,
                type: 'text',
              },
            ],
            schemaVersion: 1,
          }),
          uiSchemaJson: JSON.stringify({
            layout: [{ fieldKey: 'reason', width: 'FULL' }],
            schemaVersion: 1,
          }),
          version: 2,
        },
      });
      return;
    }

    await fulfillGraphQl(route, {});
  });
}

function readTemplateVersions(
  templateId: string,
): readonly Readonly<Record<string, unknown>>[] {
  if (templateId === LAUNCHABLE_TEMPLATE_ID) {
    return [
      {
        formDefinitionVersionId: FORM_VERSION_ID,
        id: LAUNCHABLE_TEMPLATE_VERSION_ID,
        status: 'PUBLISHED',
        version: 2,
      },
    ];
  }

  return [
    {
      formDefinitionVersionId: FORM_VERSION_ID,
      id: DRAFT_TEMPLATE_VERSION_ID,
      status: 'DRAFT',
      version: 1,
    },
  ];
}

function readTemplateId(
  variables: Readonly<Record<string, unknown>> | undefined,
): string {
  if (!variables || typeof variables.templateId !== 'string') {
    throw new Error('LaunchTemplateVersions variables are invalid');
  }

  return variables.templateId;
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
