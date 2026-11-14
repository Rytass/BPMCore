import type { FormDefinitionSchema } from '@rytass/bpm-core-shared/form';
import type { WorkflowDefinition } from '@rytass/bpm-core-shared/workflow';
import {
  composeApprovalTemplateWithForm,
  createApprovalTemplate,
  dryRunApprovalWorkflow,
  getApprovalTemplateByKey,
  listApprovalTemplates,
  listApprovalTemplatesPage,
  updateApprovalTemplateDraft,
} from './template-api';

const EMPTY_WORKFLOW = {
  edges: [],
  nodes: [],
} as unknown as WorkflowDefinition;

interface CapturedRequest {
  readonly query: string;
  readonly variables?: Readonly<Record<string, unknown>>;
}

function installFetchMock<TData>(payload: TData): {
  readonly capture: () => CapturedRequest;
  readonly restore: () => void;
} {
  const originalFetch = global.fetch;
  const fetchMock = jest.fn<
    Promise<Response>,
    [RequestInfo | URL, RequestInit?]
  >();
  fetchMock.mockImplementation(
    async () =>
      new Response(JSON.stringify({ data: payload }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }),
  );
  (global as { fetch: typeof fetch }).fetch =
    fetchMock as unknown as typeof fetch;

  return {
    capture: (): CapturedRequest => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const init = fetchMock.mock.calls[0]?.[1];
      return JSON.parse(String(init?.body ?? '{}')) as CapturedRequest;
    },
    restore: (): void => {
      (global as { fetch: typeof fetch }).fetch = originalFetch;
    },
  };
}

describe('@rytass/bpm-core-client/template', () => {
  describe('listApprovalTemplates', () => {
    it('issues the ApprovalTemplates query and returns the records', async (): Promise<void> => {
      const harness = installFetchMock({ approvalTemplates: [] });
      try {
        const records = await listApprovalTemplates();
        const request = harness.capture();

        expect(request.query).toContain('query ApprovalTemplates');
        expect(request.variables).toBeUndefined();
        expect(records).toEqual([]);
      } finally {
        harness.restore();
      }
    });
  });

  describe('createApprovalTemplate', () => {
    it('wraps the name and category into CreateApprovalTemplateInput', async (): Promise<void> => {
      const harness = installFetchMock({
        createApprovalTemplate: { id: 'template-1' },
      });
      try {
        const id = await createApprovalTemplate({
          categoryId: 'cat-1',
          name: 'Expense reimbursement',
        });
        const request = harness.capture();

        expect(request.query).toContain('mutation CreateApprovalTemplate');
        expect(request.variables).toEqual({
          input: {
            category: null,
            categoryId: 'cat-1',
            createdByMemberId: null,
            description: null,
            formDefinitionVersionId: null,
            name: 'Expense reimbursement',
          },
        });
        expect(id).toBe('template-1');
      } finally {
        harness.restore();
      }
    });
  });

  describe('listApprovalTemplatesPage', () => {
    it('omits includeHostManaged by default so the server exclusion applies', async (): Promise<void> => {
      const harness = installFetchMock({
        approvalTemplateCount: 0,
        approvalTemplates: [],
      });
      try {
        await listApprovalTemplatesPage({ page: 1, pageSize: 10 });
        const request = harness.capture();

        expect(request.query).toContain(
          'approvalTemplateCount(\n        activationStatus: $activationStatus\n        categoryId: $categoryId\n        includeHostManaged: $includeHostManaged',
        );
        expect(request.variables).not.toHaveProperty('includeHostManaged');
      } finally {
        harness.restore();
      }
    });

    it('sends includeHostManaged only when it is true', async (): Promise<void> => {
      const harness = installFetchMock({
        approvalTemplateCount: 0,
        approvalTemplates: [],
      });
      try {
        await listApprovalTemplatesPage({
          includeHostManaged: true,
          page: 1,
          pageSize: 10,
        });
        const request = harness.capture();

        expect(request.variables).toMatchObject({ includeHostManaged: true });
      } finally {
        harness.restore();
      }
    });

    it('sends nothing extra when includeHostManaged is false', async (): Promise<void> => {
      const harness = installFetchMock({
        approvalTemplateCount: 0,
        approvalTemplates: [],
      });
      try {
        await listApprovalTemplatesPage({
          includeHostManaged: false,
          page: 1,
          pageSize: 10,
        });
        const request = harness.capture();

        expect(request.variables).not.toHaveProperty('includeHostManaged');
      } finally {
        harness.restore();
      }
    });
  });

  describe('getApprovalTemplateByKey', () => {
    it('looks up the template by key and returns the record', async (): Promise<void> => {
      const record = {
        category: null,
        categoryDetail: null,
        categoryId: null,
        currentVersionId: 'version-1',
        description: null,
        hostManaged: true,
        id: 'template-1',
        isActive: true,
        key: 'expense-reimbursement',
        name: 'Expense reimbursement',
        updatedAt: '2026-11-14T00:00:00.000Z',
      };
      const harness = installFetchMock({ approvalTemplateByKey: record });
      try {
        const result = await getApprovalTemplateByKey('expense-reimbursement');
        const request = harness.capture();

        expect(request.query).toContain('approvalTemplateByKey(key: $key)');
        expect(request.variables).toEqual({ key: 'expense-reimbursement' });
        expect(result).toEqual(record);
      } finally {
        harness.restore();
      }
    });
  });

  describe('composeApprovalTemplateWithForm', () => {
    const composeArgs = {
      category: null,
      categoryId: null,
      formDefinitionId: null,
      formDescription: null,
      formName: 'Expense form',
      initiatorPolicyCel: null,
      notificationConfig: null,
      publish: false,
      schema: { fields: [] },
      slaDefaults: null,
      templateDescription: null,
      templateId: null,
      templateName: 'Expense reimbursement',
      uiSchema: {},
      workflowDefinition: EMPTY_WORKFLOW,
    } as unknown as Parameters<typeof composeApprovalTemplateWithForm>[0];

    const composePayload = {
      composeApprovalTemplateWithForm: {
        formDefinition: { currentVersionId: null, id: 'form-1' },
        formDefinitionVersion: { id: 'form-version-1', status: 'DRAFT', version: 1 },
        published: false,
        template: { currentVersionId: null, id: 'template-1' },
        templateVersion: {
          archivedAt: null,
          formDefinitionVersionId: 'form-version-1',
          id: 'template-version-1',
          initiatorPolicyCel: null,
          launchMode: 'OPEN',
          notificationConfigJson: null,
          publishedAt: null,
          slaDefaultsJson: null,
          status: 'DRAFT',
          updatedAt: '2026-11-14T00:00:00.000Z',
          version: 1,
          workflowDefinitionJson: '{}',
        },
      },
    };

    it('omits templateKey and launchMode when they are undefined and never sends hostManaged', async (): Promise<void> => {
      const harness = installFetchMock(composePayload);
      try {
        await composeApprovalTemplateWithForm(composeArgs);
        const request = harness.capture();
        const input = (request.variables as { input: Record<string, unknown> })
          .input;

        expect(input).not.toHaveProperty('templateKey');
        expect(input).not.toHaveProperty('launchMode');
        expect(input).not.toHaveProperty('hostManaged');
      } finally {
        harness.restore();
      }
    });

    it('sends templateKey and launchMode when they are given', async (): Promise<void> => {
      const harness = installFetchMock(composePayload);
      try {
        await composeApprovalTemplateWithForm({
          ...composeArgs,
          launchMode: 'HOST_ONLY',
          templateKey: 'expense-reimbursement',
        });
        const request = harness.capture();

        expect(request.variables).toMatchObject({
          input: {
            launchMode: 'HOST_ONLY',
            templateKey: 'expense-reimbursement',
          },
        });
        expect(request.variables).not.toHaveProperty('input.hostManaged');
      } finally {
        harness.restore();
      }
    });
  });

  describe('updateApprovalTemplateDraft', () => {
    const updatePayload = {
      updateApprovalTemplateDraft: {
        archivedAt: null,
        formDefinitionVersionId: null,
        id: 'version-1',
        initiatorPolicyCel: null,
        launchMode: 'OPEN',
        notificationConfigJson: null,
        publishedAt: null,
        slaDefaultsJson: null,
        status: 'DRAFT',
        updatedAt: '2026-11-14T00:00:00.000Z',
        version: 1,
        workflowDefinitionJson: '{}',
      },
    };

    it('omits launchMode when it is undefined so the stored mode is kept', async (): Promise<void> => {
      const harness = installFetchMock(updatePayload);
      try {
        await updateApprovalTemplateDraft({
          formDefinitionVersionId: null,
          initiatorPolicyCel: null,
          versionId: 'version-1',
          workflowDefinition: EMPTY_WORKFLOW,
        });
        const request = harness.capture();
        const input = (request.variables as { input: Record<string, unknown> })
          .input;

        expect(input).not.toHaveProperty('launchMode');
        expect(input).toMatchObject({
          notificationConfigJson: null,
          slaDefaultsJson: null,
          versionId: 'version-1',
        });
      } finally {
        harness.restore();
      }
    });

    it('sends launchMode when it is given', async (): Promise<void> => {
      const harness = installFetchMock(updatePayload);
      try {
        await updateApprovalTemplateDraft({
          formDefinitionVersionId: null,
          initiatorPolicyCel: null,
          launchMode: 'HOST_ONLY',
          versionId: 'version-1',
          workflowDefinition: EMPTY_WORKFLOW,
        });
        const request = harness.capture();

        expect(request.variables).toMatchObject({
          input: { launchMode: 'HOST_ONLY' },
        });
      } finally {
        harness.restore();
      }
    });
  });

  describe('dryRunApprovalWorkflow', () => {
    const dryRunPayload = {
      dryRunApprovalWorkflow: { errors: [], steps: [], valid: true },
    };

    it('omits formSchemaJson when no form schema is given', async (): Promise<void> => {
      const harness = installFetchMock(dryRunPayload);
      try {
        await dryRunApprovalWorkflow({
          formData: {},
          initiatorMemberId: 'member-1',
          initiatorMetadataSnapshot: null,
          workflowDefinition: EMPTY_WORKFLOW,
        });
        const request = harness.capture();
        const input = (request.variables as { input: Record<string, unknown> })
          .input;

        expect(input).not.toHaveProperty('formSchemaJson');
      } finally {
        harness.restore();
      }
    });

    it('sends formSchemaJson as a JSON string when a form schema is given', async (): Promise<void> => {
      const formSchema: FormDefinitionSchema = { fields: [], schemaVersion: 1 };
      const harness = installFetchMock(dryRunPayload);
      try {
        await dryRunApprovalWorkflow({
          formData: {},
          formSchema,
          initiatorMemberId: 'member-1',
          initiatorMetadataSnapshot: null,
          workflowDefinition: EMPTY_WORKFLOW,
        });
        const request = harness.capture();

        expect(request.variables).toMatchObject({
          input: { formSchemaJson: JSON.stringify(formSchema) },
        });
      } finally {
        harness.restore();
      }
    });
  });
});
