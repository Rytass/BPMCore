import type { BPMExpressionValue } from '@rytass/bpm-core-shared';
import type { FormDefinitionSchema } from '@rytass/bpm-core-shared/form';
import type {
  NotifyWebhookBinding,
  NotifyWebhookTarget,
  WorkflowDefinition,
} from '@rytass/bpm-core-shared/workflow';
import { ConditionService } from '../condition/condition.service';
import {
  createExpressionBudget,
  currentExpressionBudget,
  runExpressionOperation,
} from '../condition/expression-budget';
import { StaticBPMExpressionFunctionRegistry } from '../expression-function/expression-function.registry';
import type { BPMExpressionFunction } from '../expression-function/expression-function.types';
import { WorkflowWebhookDeliveryStatusEnum } from './workflow-webhook-delivery.enums';
import {
  buildWorkflowWebhookDeliveryDrafts,
  WorkflowWebhookEnqueueContext,
} from './workflow-webhook-enqueue';
import { readNotifyWebhookStructureIssues } from '@rytass/bpm-core-shared/workflow-graph';
import { createNotifyWebhookExpressionEvaluator } from './workflow-webhook-expression';
import {
  BPMWorkflowWebhookEndpointEntry,
  BPMWorkflowWebhookParameter,
} from './workflow-webhook.types';
import { lintWorkflowWebhookTargets } from './workflow-webhook.validator';

/**
 * Phase 23 P5: `EXPRESSION` sources of NOTIFY webhook bindings (ADR 22 §3.7,
 * docs/24 §2.8), against the installed cel-v2 engine.
 */

const HOST_FUNCTIONS: readonly BPMExpressionFunction[] = [
  {
    description: 'Plant of a region',
    handler: (): BPMExpressionValue => 'TW01',
    label: 'plant',
    name: 'erp_plant_v1',
    parameters: [{ name: 'region', type: 'string' }],
    returnType: 'string',
  },
];

const conditionService = new ConditionService(
  new StaticBPMExpressionFunctionRegistry(HOST_FUNCTIONS),
);

const FORM_SCHEMA: FormDefinitionSchema = {
  fields: [
    { fieldKey: 'subject', label: 'Subject', required: true, type: 'text' },
    { fieldKey: 'amount', label: 'Amount', required: true, type: 'money' },
  ],
  schemaVersion: 1,
};

const PARAMETERS: readonly BPMWorkflowWebhookParameter[] = [
  { key: 'amount', label: 'Amount', required: true, type: 'number' },
  { key: 'summary', label: 'Summary', required: false, type: 'string' },
  { key: 'payload', label: 'Payload', required: false, type: 'json' },
  { key: 'tags', label: 'Tags', required: false, type: 'stringArray' },
];

const CONTEXT: WorkflowWebhookEnqueueContext = {
  instance: {
    formData: { amount: 1200, secretNote: 'DO_NOT_SEND', subject: 'Laptop' },
    id: 'instance-1',
    initiatorMemberId: 'member-102',
    templateId: 'template-1',
    templateVersionId: 'template-version-3',
    title: '採購申請',
  },
  node: { id: 'notify_erp', label: '通知 ERP' },
  occurredAt: new Date('2026-09-15T10:00:00.000Z'),
  tokenId: 'token-1',
};

const entry = (): BPMWorkflowWebhookEndpointEntry => ({
  endpoint: {
    buildRequest: async () => ({ url: 'https://erp.example.com/hooks' }),
    descriptor: { key: 'erp.po', label: 'ERP', parameters: PARAMETERS, version: 1 },
  },
  source: 'REGISTRY',
});

/** An `EXPRESSION` binding. */
const expressionBinding = (
  parameter: string,
  expression: string,
): NotifyWebhookBinding => ({
  from: { expression, kind: 'EXPRESSION' },
  parameter,
});

const AMOUNT_FIELD: NotifyWebhookBinding = {
  from: { fieldKey: 'amount', kind: 'FIELD' },
  parameter: 'amount',
};

const target = (
  bindings: readonly NotifyWebhookBinding[],
): NotifyWebhookTarget => ({
  bindings,
  endpoint: { key: 'erp.po', version: 1 },
  id: 'webhook_erp',
});

describe('NOTIFY EXPRESSION bindings at enqueue', (): void => {
  it('freezes the evaluated value into the event', async (): Promise<void> => {
    const [draft] = await buildWorkflowWebhookDeliveryDrafts({
      context: CONTEXT,
      expressions: createNotifyWebhookExpressionEvaluator(conditionService),
      resolveEndpoint: async () => entry(),
      targets: [
        target([
          AMOUNT_FIELD,
          expressionBinding(
            'summary',
            'form.subject + " / " + string(form.amount)',
          ),
        ]),
      ],
    });

    expect(draft).toMatchObject({
      lastErrorCode: null,
      status: WorkflowWebhookDeliveryStatusEnum.PENDING,
    });
    expect(draft?.event.parameters).toEqual({
      amount: 1200,
      summary: 'Laptop / 1200',
    });
  });

  it.each([
    ['form.subject + 1', 'EXPRESSION_TYPE_ERROR'],
    ['erp_plant_v1(form.subject)', 'EXPRESSION_SYNTAX_ERROR'],
    ['row.subject', 'EXPRESSION_SYNTAX_ERROR'],
    ['[form.subject]', 'EXPRESSION_INVALID_RESULT'],
  ])(
    'records %s as a FAILED delivery, never throwing (%s)',
    async (expression, code): Promise<void> => {
      const [draft] = await buildWorkflowWebhookDeliveryDrafts({
        context: CONTEXT,
        expressions: createNotifyWebhookExpressionEvaluator(conditionService),
        resolveEndpoint: async () => entry(),
        targets: [target([AMOUNT_FIELD, expressionBinding('summary', expression)])],
      });

      expect(draft).toMatchObject({
        lastErrorCode: 'WEBHOOK_PARAMETER_INVALID',
        status: WorkflowWebhookDeliveryStatusEnum.FAILED,
      });
      expect(draft?.lastErrorDetail).toContain(`(${code})`);
      expect(draft?.lastErrorDetail).not.toContain('Laptop');
      expect(draft?.lastErrorDetail).not.toContain(expression);
    },
  );

  it('fails the delivery once its own budget is spent', async (): Promise<void> => {
    const budget = createExpressionBudget({ cumulativeMs: 1, perExpressionMs: 1 });

    budget.record(5);

    const [draft] = await buildWorkflowWebhookDeliveryDrafts({
      context: CONTEXT,
      expressions: createNotifyWebhookExpressionEvaluator(conditionService, budget),
      resolveEndpoint: async () => entry(),
      targets: [target([AMOUNT_FIELD, expressionBinding('summary', 'form.subject')])],
    });

    expect(draft).toMatchObject({
      lastErrorCode: 'WEBHOOK_PARAMETER_INVALID',
      status: WorkflowWebhookDeliveryStatusEnum.FAILED,
    });
    expect(draft?.lastErrorDetail).toContain('(EXPRESSION_BUDGET_EXCEEDED)');
  });

  it('uses its own budget, not the transaction operation budget', (): void => {
    const outcome = runExpressionOperation(() => {
      // The transaction's gateway conditions have spent its whole budget.
      currentExpressionBudget()?.record(60_000);

      return createNotifyWebhookExpressionEvaluator(conditionService).evaluate(
        'form.subject',
        CONTEXT.instance.formData,
      );
    });

    expect(outcome).toEqual({ ok: true, value: 'Laptop' });
  });

  it('is unavailable without the injected ConditionService', async (): Promise<void> => {
    const [draft] = await buildWorkflowWebhookDeliveryDrafts({
      context: CONTEXT,
      expressions: createNotifyWebhookExpressionEvaluator(null),
      resolveEndpoint: async () => entry(),
      targets: [target([AMOUNT_FIELD, expressionBinding('summary', 'form.subject')])],
    });

    expect(draft?.lastErrorDetail).toContain('(EXPRESSION_UNAVAILABLE)');
  });

  it('only hands the fields it reads to the engine', (): void => {
    const evaluateValue = jest.spyOn(conditionService, 'evaluateValue');

    try {
      createNotifyWebhookExpressionEvaluator(conditionService).evaluate(
        'form.subject',
        CONTEXT.instance.formData,
      );

      expect(evaluateValue).toHaveBeenCalledWith(
        'form.subject',
        { form: { subject: 'Laptop' } },
        'webhook.binding',
        expect.objectContaining({
          allowedRootIdentifiers: ['form'],
          dialect: 'cel-v2',
        }),
      );
    } finally {
      evaluateValue.mockRestore();
    }
  });
});

describe('NOTIFY EXPRESSION bindings at publish', (): void => {
  const definition = (
    bindings: readonly NotifyWebhookBinding[],
  ): WorkflowDefinition => ({
    edges: [],
    meta: { schemaVersion: 1 },
    nodes: [
      {
        data: {
          action: {
            channels: ['IN_APP'],
            recipients: { memberIds: [], type: 'DIRECT' },
            type: 'NOTIFY',
            webhooks: [target(bindings)],
          },
          label: '通知 ERP',
          triggerMode: 'AND',
        },
        id: 'notify_erp',
        position: { x: 0, y: 0 },
        type: 'serviceTask',
      },
    ],
  });
  const lint = (
    bindings: readonly NotifyWebhookBinding[],
    service: ConditionService | null = conditionService,
  ): Promise<readonly string[]> =>
    lintWorkflowWebhookTargets({
      conditionService: service,
      definition: definition(bindings),
      formSchema: FORM_SCHEMA,
      hasEndpointSources: true,
      resolveEndpoint: async () => entry(),
    });
  const label = 'workflow.nodes.notify_erp.action.webhooks[0].bindings[1].from.expression';

  it('accepts a well-formed expression of the right type', async (): Promise<void> => {
    expect(
      await lint([
        AMOUNT_FIELD,
        expressionBinding('summary', 'form.subject + " / " + string(form.amount)'),
        expressionBinding('payload', 'form.amount > 1000'),
      ]),
    ).toEqual([]);
  });

  it.each([
    ['summary', 'row.subject', `${label}: EXPR_ROOT_NOT_ALLOWED row`],
    ['summary', 'instance.id', `${label}: EXPR_ROOT_NOT_ALLOWED instance`],
    ['summary', 'form.missing', `${label}: EXPR_FIELD_UNKNOWN missing`],
    [
      'summary',
      'erp_plant_v1(form.subject)',
      `${label}: EXPR_FUNCTION_NOT_ALLOWED erp_plant_v1`,
    ],
    ['summary', 'form.amount', `${label}: EXPR_RESULT_TYPE_MISMATCH`],
    ['tags', 'form.subject', `${label}: EXPR_RESULT_TYPE_MISMATCH`],
  ])('refuses %s = %s', async (parameter, expression, line): Promise<void> => {
    expect(
      await lint([AMOUNT_FIELD, expressionBinding(parameter, expression)]),
    ).toContain(line);
  });

  it('cannot check an expression without the injected ConditionService', async (): Promise<void> => {
    expect(
      await lint(
        [AMOUNT_FIELD, expressionBinding('summary', 'form.subject')],
        null,
      ),
    ).toEqual([
      `${label} cannot be checked: no ConditionService is available`,
    ]);
  });

  it('still reports a malformed EXPRESSION source structurally', (): void => {
    // The shared structural lint knows the kind (Phase 23 P4／P5 integration):
    // a blank expression is its own code, a well-formed one passes.
    expect(
      readNotifyWebhookStructureIssues([
        target([
          expressionBinding('summary', '   '),
          expressionBinding('payload', 'form.subject'),
        ]),
      ]).map((issue) => [issue.bindingIndex, issue.code]),
    ).toEqual([[0, 'BINDING_EXPRESSION_REQUIRED']]);
  });

  it('reports an EXPRESSION bound to a parameter the endpoint does not declare', async (): Promise<void> => {
    expect(
      await lint([AMOUNT_FIELD, expressionBinding('unknown', 'form.subject')]),
    ).toEqual([
      'workflow.nodes.notify_erp.action.webhooks[0].bindings[1].parameter "unknown" is not declared by the endpoint (WORKFLOW_WEBHOOK_PARAMETER_UNKNOWN)',
    ]);
  });
});
