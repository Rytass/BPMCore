import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type {
  ExpressionCatalogRecord,
  ExpressionPreviewRecord,
  PreviewExpressionInput,
} from '@rytass/bpm-core-client/template';
import {
  ExpressionField,
  type ExpressionFieldApi,
  type ExpressionFieldLint,
  appendExpressionSnippet,
  readExpressionCatalogFunctionNotes,
  readExpressionCatalogOptions,
  readExpressionEvaluationText,
  readExpressionSample,
} from './ExpressionField';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const CATALOG: ExpressionCatalogRecord = {
  fields: [
    { fieldKey: 'amount', fieldType: 'number', label: '金額', path: 'form.amount', required: true },
  ],
  functions: [
    {
      builtIn: false,
      description: '',
      label: '成本級距',
      name: 'erp_costBand_v1',
      parameters: [{ name: 'amount', type: 'number' }],
      returnType: 'string',
    },
  ],
  functionsAvailable: true,
  roots: ['form'],
  usagePoint: 'ENTRY_CONDITION',
};

const [COST_BAND_FUNCTION] = CATALOG.functions as readonly [
  ExpressionCatalogRecord['functions'][number],
];

interface Harness {
  readonly api: ExpressionFieldApi;
  readonly previews: PreviewExpressionInput[];
}

function createApi(answer: ExpressionPreviewRecord | Error): Harness {
  const previews: PreviewExpressionInput[] = [];

  return {
    api: {
      preview: async (input): Promise<ExpressionPreviewRecord> => {
        previews.push(input);

        if (answer instanceof Error) {
          throw answer;
        }

        return answer;
      },
      readCatalog: async (): Promise<ExpressionCatalogRecord> => CATALOG,
    },
    previews,
  };
}

describe('ExpressionField (Phase 23 P4)', (): void => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach((): void => {
    jest.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach((): void => {
    act((): void => root.unmount());
    container.remove();
    jest.useRealTimers();
  });

  const render = async (
    harness: Harness,
    value: string,
    onLintChange?: (lint: ExpressionFieldLint) => void,
    evaluable = false,
  ): Promise<void> => {
    await act(async (): Promise<void> => {
      root.render(
        <ExpressionField
          api={harness.api}
          dialect="cel-v2"
          evaluable={evaluable}
          label="進入條件"
          name="entryCondition"
          onChange={(): void => undefined}
          onLintChange={onLintChange}
          usagePoint="ENTRY_CONDITION"
          value={value}
        />,
      );
    });
  };

  const flushDebounce = async (): Promise<void> => {
    await act(async (): Promise<void> => {
      jest.advanceTimersByTime(400);
    });
    await act(async (): Promise<void> => undefined);
  };

  it('lints on the backend after a pause and lists findings as sentences', async (): Promise<void> => {
    const harness = createApi({
      evaluation: null,
      issues: [{ code: 'EXPR_FIELD_UNKNOWN', label: 'expression', severity: 'ERROR', subject: 'amont' }],
      valid: false,
    });
    const lints: ExpressionFieldLint[] = [];

    await render(harness, 'form.amont > 1', (lint): void => {
      lints.push(lint);
    });

    expect(harness.previews).toEqual([]);
    expect(lints.at(-1)?.status).toBe('CHECKING');

    await flushDebounce();

    expect(harness.previews).toEqual([
      expect.objectContaining({ dialect: 'cel-v2', expression: 'form.amont > 1', mode: 'LINT' }),
    ]);
    expect(lints.at(-1)?.status).toBe('INVALID');
    expect(container.textContent).toContain('讀取了表單沒有的欄位「amont」。');
    expect(container.textContent).toContain('未通過檢查');
  });

  it('sends nothing for an empty expression and says when the check is unavailable', async (): Promise<void> => {
    const empty = createApi(new Error('network'));

    await render(empty, '   ');
    await flushDebounce();
    expect(empty.previews).toEqual([]);

    await render(empty, 'form.amount');
    await flushDebounce();
    expect(container.textContent).toContain('無法向後端檢查這個運算式');
  });

  it('shows each catalog function description as text under the picker', async (): Promise<void> => {
    const catalog: ExpressionCatalogRecord = {
      ...CATALOG,
      functions: [
        {
          ...COST_BAND_FUNCTION,
          description: '依金額回傳 <b>成本級距</b>',
        },
      ],
    };
    const api: ExpressionFieldApi = {
      preview: async (): Promise<ExpressionPreviewRecord> => ({
        evaluation: null,
        issues: [],
        valid: true,
      }),
      readCatalog: async (): Promise<ExpressionCatalogRecord> => catalog,
    };

    await act(async (): Promise<void> => {
      root.render(
        <ExpressionField
          api={api}
          dialect="cel-v2"
          label="進入條件"
          name="entryCondition"
          onChange={(): void => undefined}
          usagePoint="ENTRY_CONDITION"
          value=""
        />,
      );
    });
    await act(async (): Promise<void> => undefined);

    const notes = container.querySelector('[aria-label="函式說明"]');

    expect(notes?.textContent).toBe(
      'erp_costBand_v1（成本級距）：依金額回傳 <b>成本級距</b>',
    );
    // Text, never markup.
    expect(notes?.querySelector('b')).toBeNull();
  });

  it('shows a trial-run result as text, never as markup', async (): Promise<void> => {
    const harness = createApi({
      evaluation: {
        errorCode: null,
        outcome: 'OK',
        resultJson: '"<img src=x onerror=alert(1)>"',
        resultType: 'string',
      },
      issues: [],
      valid: true,
    });

    await render(harness, 'form.note', undefined, true);
    await flushDebounce();

    const button = Array.from(container.querySelectorAll('button')).find(
      (element) => element.textContent === '以樣本試算',
    );

    await act(async (): Promise<void> => {
      button?.click();
    });

    expect(harness.previews.at(-1)).toEqual(
      expect.objectContaining({ mode: 'EVALUATE', sampleContext: { form: {} } }),
    );
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('ExpressionField helpers', (): void => {
  it('lists the catalog as insertable snippets', (): void => {
    expect(readExpressionCatalogOptions(CATALOG).map((option) => option.id)).toEqual([
      'form',
      'form.amount',
      'erp_costBand_v1(',
    ]);
    expect(readExpressionCatalogOptions(null)).toEqual([]);
  });

  it('lists only the functions that carry a description', (): void => {
    expect(readExpressionCatalogFunctionNotes(CATALOG)).toEqual([]);
    expect(readExpressionCatalogFunctionNotes(null)).toEqual([]);
    expect(
      readExpressionCatalogFunctionNotes({
        ...CATALOG,
        functions: [
          { ...COST_BAND_FUNCTION, description: '  依金額回傳成本級距  ' },
          {
            builtIn: true,
            description: '字串是否包含子字串',
            label: '',
            name: 'contains',
            parameters: [],
            returnType: 'bool',
          },
        ],
      }),
    ).toEqual([
      { id: 'erp_costBand_v1', text: 'erp_costBand_v1（成本級距）：依金額回傳成本級距' },
      { id: 'contains', text: 'contains：字串是否包含子字串' },
    ]);
  });

  it('appends snippets with a single separating space', (): void => {
    expect(appendExpressionSnippet('', 'form.a')).toBe('form.a');
    expect(appendExpressionSnippet('fn(', 'form.a')).toBe('fn(form.a');
    expect(appendExpressionSnippet('form.a >', 'form.b')).toBe('form.a > form.b');
  });

  it('accepts only a JSON object as a sample and words outcomes', (): void => {
    expect(readExpressionSample('{"form":{}}')).toEqual({ form: {} });
    expect(typeof readExpressionSample('[]')).toBe('string');
    expect(typeof readExpressionSample('{')).toBe('string');
    expect(
      readExpressionEvaluationText({
        errorCode: 'EXPRESSION_MISSING_KEY',
        outcome: 'ERROR',
        resultJson: null,
        resultType: null,
      }),
    ).toBe('試算失敗（EXPRESSION_MISSING_KEY）');
  });
});
