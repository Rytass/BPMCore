import { BadRequestException, Logger } from '@nestjs/common';
import type { BPMExpressionValue } from '@rytass/bpm-core-shared';
import type { FormDefinitionSchema } from '@rytass/bpm-core-shared/form';
import type { WorkflowDefinition } from '@rytass/bpm-core-shared/workflow';
import { WORKFLOW_EXPRESSION_LABELS } from '@rytass/bpm-core-shared/workflow-graph';
import type { Repository } from 'typeorm';
import { ConditionService } from '../condition/condition.service';
import { StaticBPMExpressionFunctionRegistry } from '../expression-function/expression-function.registry';
import type { BPMExpressionFunctionRegistry } from '../expression-function/expression-function.types';
import type { FormDefinitionVersionEntity } from '../form/form-definition-version.entity';
import type { PreviewExpressionInput } from './dto/expression-designer.dto';
import { ExpressionDesignerService } from './expression-designer.service';

/**
 * The designer's expression tools against the real engines (Phase 23 P4).
 * The 403 for non-designers is pinned in `expression-designer.access.spec.ts`.
 */

const SECRET = 'host-secret-do-not-leak';
const FORM_VERSION_ID = '6f1c0d4e-8a8b-4b0e-9b52-0c7c1f4d2a11';

const FORM_SCHEMA: FormDefinitionSchema = {
  fields: [
    { fieldKey: 'amount', label: '金額', required: true, type: 'number' },
    { fieldKey: 'title', label: '標題', required: true, type: 'text' },
    { fieldKey: 'note', label: '備註', required: false, type: 'text' },
  ],
  schemaVersion: 1,
} as FormDefinitionSchema;

const HOST_FUNCTIONS = [
  {
    description: 'Cost band',
    handler: (amount: BPMExpressionValue): BPMExpressionValue =>
      typeof amount === 'number' && amount > 1000 ? 'HIGH' : 'LOW',
    label: '成本級距',
    name: 'erp_band_v1',
    parameters: [{ name: 'amount', type: 'double' as const }],
    returnType: 'string' as const,
  },
];

const createRepository = (): Repository<FormDefinitionVersionEntity> =>
  ({
    findOne: async ({
      where,
    }: {
      readonly where: { readonly id: string };
    }): Promise<FormDefinitionVersionEntity | null> =>
      where.id === FORM_VERSION_ID
        ? ({ id: FORM_VERSION_ID, schema: FORM_SCHEMA } as FormDefinitionVersionEntity)
        : null,
  }) as unknown as Repository<FormDefinitionVersionEntity>;

const createService = (
  registry: BPMExpressionFunctionRegistry = new StaticBPMExpressionFunctionRegistry(
    HOST_FUNCTIONS,
  ),
): ExpressionDesignerService =>
  new ExpressionDesignerService(
    createRepository(),
    new ConditionService(registry),
    registry,
  );

const preview = (
  overrides: Partial<PreviewExpressionInput>,
  service: ExpressionDesignerService = createService(),
): ReturnType<ExpressionDesignerService['previewExpression']> =>
  service.previewExpression({
    dialect: 'cel-v2',
    expression: 'true',
    formDefinitionVersionId: FORM_VERSION_ID,
    mode: 'LINT',
    usagePoint: 'FLOW_CONDITION',
    ...overrides,
  } as PreviewExpressionInput);

const definition = (
  overrides: Partial<WorkflowDefinition> = {},
): WorkflowDefinition =>
  ({
    edges: [
      { data: {}, id: 'e0', source: 'start', target: 'task', type: 'smoothstep' },
      {
        data: { condition: 'lastDecision.action == "APPROVE"' },
        id: 'e1',
        source: 'task',
        target: 'gw',
        type: 'smoothstep',
      },
      {
        data: { condition: 'lastDecision == null && 7 / 2 == 3' },
        id: 'e2',
        source: 'gw',
        target: 'end',
        type: 'smoothstep',
      },
      {
        data: { condition: 'form.amount > 100', isDefault: false },
        id: 'e3',
        source: 'gw',
        target: 'end',
        type: 'smoothstep',
      },
    ],
    meta: { schemaVersion: 1 },
    nodes: [
      { data: { label: '開始' }, id: 'start', position: { x: 0, y: 0 }, type: 'startEvent' },
      {
        data: {
          approverResolver: { expression: 'form.title', type: 'EXPRESSION' },
          label: '簽核',
        },
        id: 'task',
        position: { x: 0, y: 0 },
        type: 'userTask',
      },
      { data: { label: '分流' }, id: 'gw', position: { x: 0, y: 0 }, type: 'exclusiveGateway' },
      { data: { endState: 'APPROVED', label: '完成' }, id: 'end', position: { x: 0, y: 0 }, type: 'endEvent' },
    ],
    ...overrides,
  }) as unknown as WorkflowDefinition;

describe('ExpressionDesignerService', (): void => {
  let logged: string[];

  beforeEach((): void => {
    logged = [];
    (['debug', 'log', 'warn', 'error'] as const).forEach((level): void => {
      jest
        .spyOn(Logger.prototype, level)
        .mockImplementation((message: unknown): void => {
          logged.push(String(message));
        });
    });
  });

  afterEach((): void => {
    jest.restoreAllMocks();
  });

  describe('previewExpression', (): void => {
    it('lints with the bound form and the registry, as the publish lint does', async (): Promise<void> => {
      await expect(
        preview({ expression: 'form.title.contains("急") && erp_band_v1(form.amount) == "HIGH"' }),
      ).resolves.toEqual({ evaluation: null, issues: [], valid: true });

      const unknownField = await preview({ expression: 'form.missing > 1' });

      expect(unknownField.valid).toBe(false);
      expect(unknownField.issues).toEqual([
        { code: 'EXPR_FIELD_UNKNOWN', label: 'expression', severity: 'ERROR', subject: 'missing' },
      ]);

      const unregistered = await preview({ expression: 'erp_gone_v1(form.amount) == "x"' });

      expect(unregistered.issues.map((issue) => issue.code)).toEqual([
        'EXPR_FUNCTION_NOT_REGISTERED',
      ]);
    });

    it('answers a use point that is not one with refusals, not a throw', async (): Promise<void> => {
      const result = await preview({ expression: 'form.amount > 1', usagePoint: 'toString' });

      expect(result.valid).toBe(false);
    });

    it('evaluates the sample only through the use point roots and returns codes, never values of a failure', async (): Promise<void> => {
      const ok = await preview({
        expression: 'form.title.contains("急") ? erp_band_v1(form.amount) : "LOW"',
        mode: 'EVALUATE',
        sampleContextJson: JSON.stringify({ form: { amount: 1500, note: null, title: '急件' } }),
        usagePoint: 'SERVICE_FORM_FIELD_VALUE',
      });

      expect(ok.evaluation).toEqual({
        errorCode: null,
        outcome: 'OK',
        resultJson: '"HIGH"',
        resultType: 'string',
      });

      const missing = await preview({
        expression: 'form.amount > 1',
        mode: 'EVALUATE',
        sampleContextJson: JSON.stringify({ form: { title: SECRET } }),
      });

      expect(missing.evaluation).toEqual({
        errorCode: 'EXPRESSION_MISSING_KEY',
        outcome: 'ERROR',
        resultJson: null,
        resultType: null,
      });
      expect(JSON.stringify(missing)).not.toContain(SECRET);
      expect(logged.join('\n')).not.toContain(SECRET);
    });

    it('fails a throwing host function closed without its message', async (): Promise<void> => {
      const registry = new StaticBPMExpressionFunctionRegistry([
        {
          ...HOST_FUNCTIONS[0],
          handler: (): BPMExpressionValue => {
            throw new Error(SECRET);
          },
        },
      ]);
      const result = await preview(
        {
          expression: 'erp_band_v1(form.amount) == "HIGH" || true',
          mode: 'EVALUATE',
          sampleContextJson: JSON.stringify({ form: { amount: 5 } }),
        },
        createService(registry),
      );

      expect(result.evaluation?.errorCode).toBe('EXPRESSION_FUNCTION_FAILED');
      expect(JSON.stringify(result)).not.toContain(SECRET);
      expect(logged.join('\n')).not.toContain(SECRET);
    });

    it('does not evaluate an expression the lint refuses, and refuses a sample that is not an object', async (): Promise<void> => {
      await expect(
        preview({ expression: 'form["sec" + "ret"]', mode: 'EVALUATE', sampleContextJson: '{}' }),
      ).resolves.toEqual(
        expect.objectContaining({ evaluation: null, valid: false }),
      );
      await expect(
        preview({ expression: 'true', mode: 'EVALUATE', sampleContextJson: '[1]' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(preview({ dialect: 'cel-v3' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('warns when an edge leaving a node without tasks reads lastDecision', async (): Promise<void> => {
      const gateway = await preview({
        edgeSourceNodeType: 'exclusiveGateway',
        expression: 'lastDecision != null && lastDecision.action == "APPROVE"',
      });

      expect(gateway.valid).toBe(true);
      expect(gateway.issues).toEqual([
        {
          code: 'EXPR_LAST_DECISION_UNAVAILABLE',
          label: 'expression',
          severity: 'WARNING',
          subject: null,
        },
      ]);

      for (const nodeType of ['parallelGateway', 'serviceTask', 'startEvent']) {
        const result = await preview({
          dialect: 'cel-legacy',
          edgeSourceNodeType: nodeType,
          expression: 'lastDecision != null',
        });

        expect(result.issues.map((issue) => issue.code)).toEqual([
          'EXPR_LAST_DECISION_UNAVAILABLE',
        ]);
      }

      await expect(
        preview({
          edgeSourceNodeType: 'userTask',
          expression: 'lastDecision != null && lastDecision.action == "APPROVE"',
        }),
      ).resolves.toEqual({ evaluation: null, issues: [], valid: true });
      await expect(
        preview({
          edgeSourceNodeType: 'exclusiveGateway',
          expression: '"lastDecision" == form.title',
        }),
      ).resolves.toEqual({ evaluation: null, issues: [], valid: true });
    });
  });

  describe('expressionCatalog', (): void => {
    it('lists the use point roots, the form fields and the functions without handlers', async (): Promise<void> => {
      const catalog = await createService().expressionCatalog({
        formDefinitionVersionId: FORM_VERSION_ID,
        usagePoint: 'FLOW_CONDITION',
      });

      expect(catalog.roots).toEqual([
        'env',
        'form',
        'formData',
        'initiator',
        'instance',
        'lastDecision',
      ]);
      expect(catalog.fields.map((field) => field.path)).toEqual([
        'form.amount',
        'form.title',
        'form.note',
      ]);
      expect(catalog.functionsAvailable).toBe(true);
      expect(catalog.functions.map((fn) => fn.name)).toContain('erp_band_v1');
      expect(catalog.functions.find((fn) => fn.name === 'round')?.builtIn).toBe(
        true,
      );
      expect(JSON.stringify(catalog)).not.toContain('handler');
    });

    it('offers bindings only the built-ins, and a policy no form fields', async (): Promise<void> => {
      const binding = await createService().expressionCatalog({
        formDefinitionVersionId: FORM_VERSION_ID,
        usagePoint: 'DATA_SOURCE_BINDING',
      });

      expect(binding.functions.every((fn) => fn.builtIn)).toBe(true);
      expect(binding.functions).toHaveLength(9);

      const policy = await createService().expressionCatalog({
        formDefinitionVersionId: FORM_VERSION_ID,
        usagePoint: 'INITIATOR_POLICY',
      });

      expect(policy.roots).toEqual(['env', 'initiator', 'subject']);
      expect(policy.fields).toEqual([]);
    });

    it('isolates a registry that throws or answers out of shape', async (): Promise<void> => {
      const throwing: BPMExpressionFunctionRegistry = {
        assertPublishable: (): readonly string[] => [],
        get: (): null => null,
        list: (): never => {
          throw new Error(SECRET);
        },
      };
      const misshapen = {
        assertPublishable: (): readonly string[] => [],
        get: (): null => null,
        list: (): unknown => SECRET,
      } as unknown as BPMExpressionFunctionRegistry;

      for (const registry of [throwing, misshapen]) {
        const catalog = await new ExpressionDesignerService(
          createRepository(),
          new ConditionService(),
          registry,
        ).expressionCatalog({ usagePoint: 'ENTRY_CONDITION' });

        expect(catalog.functionsAvailable).toBe(false);
        expect(catalog.functions).toEqual([]);
        expect(JSON.stringify(catalog)).not.toContain(SECRET);
      }

      expect(logged.join('\n')).not.toContain(SECRET);
      expect(logged).toContain('code=EXPRESSION_CATALOG_UNAVAILABLE reason=registry');
    });
  });

  describe('analyzeWorkflowExpressions', (): void => {
    it('reports the fields each expression reads and its findings, warnings included', async (): Promise<void> => {
      const result = await createService().analyzeWorkflowExpressions({
        formDefinitionVersionId: FORM_VERSION_ID,
        initiatorPolicyCel: null,
        workflowDefinitionJson: JSON.stringify(
          definition({ expressionDialect: 'cel-v2' }),
        ),
      });
      const byLabel = new Map(
        result.expressions.map((entry) => [entry.label, entry]),
      );

      expect(result.dialect).toBe('cel-v2');
      expect(
        byLabel.get(WORKFLOW_EXPRESSION_LABELS.edgeCondition('e3'))?.fieldKeys,
      ).toEqual(['amount']);
      expect(
        byLabel.get(
          WORKFLOW_EXPRESSION_LABELS.nodeApproverResolverExpression('task'),
        )?.fieldKeys,
      ).toEqual(['title']);
      // Leaves a gateway: no decision to read.
      expect(
        byLabel
          .get(WORKFLOW_EXPRESSION_LABELS.edgeCondition('e2'))
          ?.issues.map((issue) => issue.code),
      ).toContain('EXPR_LAST_DECISION_UNAVAILABLE');
      // Leaves the approval node: fine.
      expect(
        byLabel
          .get(WORKFLOW_EXPRESSION_LABELS.edgeCondition('e1'))
          ?.issues.map((issue) => issue.code),
      ).not.toContain('EXPR_LAST_DECISION_UNAVAILABLE');
    });

    it('refuses a definition that is not a JSON object', async (): Promise<void> => {
      await expect(
        createService().analyzeWorkflowExpressions({
          workflowDefinitionJson: '[]',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('previewWorkflowDialectUpgrade', (): void => {
    it('lists the expressions whose result changes, P04 integer division included', async (): Promise<void> => {
      const result = await createService().previewWorkflowDialectUpgrade({
        formDefinitionVersionId: FORM_VERSION_ID,
        initiatorPolicyCel: null,
        workflowDefinitionJson: JSON.stringify(definition()),
      });

      expect(result.currentDialect).toBe('cel-legacy');
      expect(result.complete).toBe(true);
      expect(result.checkedCount).toBe(result.expressionCount);
      expect(result.differences).toEqual(
        expect.arrayContaining([
          {
            label: WORKFLOW_EXPRESSION_LABELS.edgeCondition('e2'),
            legacyOutcome: expect.stringMatching(/^(ok|err):/u) as unknown as string,
            sample: 'FILLED',
            usagePoint: 'FLOW_CONDITION',
            v2Outcome: expect.stringMatching(/^(ok|err):/u) as unknown as string,
          },
        ]),
      );

      const p04 = await createService().previewWorkflowDialectUpgrade({
        workflowDefinitionJson: JSON.stringify(
          definition({
            edges: [
              {
                data: { condition: '7 / 2 == 3.5' },
                id: 'p04',
                source: 'gw',
                target: 'end',
                type: 'smoothstep',
              },
            ],
          } as Partial<WorkflowDefinition>),
        ),
      });

      expect(p04.differences).toEqual([
        {
          label: WORKFLOW_EXPRESSION_LABELS.edgeCondition('p04'),
          legacyOutcome: 'ok:true',
          sample: 'FILLED',
          usagePoint: 'FLOW_CONDITION',
          v2Outcome: 'ok:false',
        },
      ]);
    });

    it('calls host functions through the injected service and reports the cel-v2 lint', async (): Promise<void> => {
      const result = await createService().previewWorkflowDialectUpgrade({
        formDefinitionVersionId: FORM_VERSION_ID,
        workflowDefinitionJson: JSON.stringify(
          definition({
            edges: [
              {
                data: { condition: 'erp_band_v1(form.amount) == "LOW" && 7 / 2 == 3' },
                id: 'fn',
                source: 'task',
                target: 'end',
                type: 'smoothstep',
              },
              {
                data: { condition: 'form.missing == 1' },
                id: 'unknown',
                source: 'task',
                target: 'end',
                type: 'smoothstep',
              },
            ],
          } as Partial<WorkflowDefinition>),
        ),
      });

      // cel-v2 reaches `ok:true` only if the host function was callable:
      // without the injected registry it would be EXPRESSION_FUNCTION_FAILED.
      expect(result.differences.map((difference) => difference.label)).toContain(
        WORKFLOW_EXPRESSION_LABELS.edgeCondition('fn'),
      );
      expect(
        result.differences.find(
          (difference) =>
            difference.label === WORKFLOW_EXPRESSION_LABELS.edgeCondition('fn'),
        )?.v2Outcome,
      ).toBe('ok:true');
      expect(result.v2Issues).toEqual(
        expect.arrayContaining([
          {
            code: 'EXPR_FIELD_UNKNOWN',
            label: WORKFLOW_EXPRESSION_LABELS.edgeCondition('unknown'),
            severity: 'ERROR',
            subject: 'missing',
          },
        ]),
      );
    });
  });
});
