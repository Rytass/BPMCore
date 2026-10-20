import { act, type ReactElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { WorkflowDefinition } from '@rytass/bpm-core-shared';
import type { FormDefinitionSchema } from '@rytass/bpm-core-shared/form';
import {
  readLaunchContext,
  submitApprovalInstance,
} from '@rytass/bpm-core-client/workflow';
import { InstanceNewView } from './InstanceNewView';

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  // jsdom ships no global `CSS`, which `focusFormRendererField` uses to escape
  // the instance path before querying for the cell. Every real browser has it.
  ...(typeof CSS === 'undefined'
    ? { CSS: { escape: (value: string): string => value } }
    : {}),
});

// jsdom implements no layout, so it has no `scrollIntoView` either.
if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = (): void => undefined;
}

jest.mock('@mezzanine-ui/core/form', () => ({
  FormFieldDensity: { TIGHT: 'TIGHT' },
  FormFieldLayout: { HORIZONTAL: 'HORIZONTAL' },
}));

jest.mock('@mezzanine-ui/core/table', () => ({}));

jest.mock('@mezzanine-ui/react/ContentHeader', () => ({
  __esModule: true,
  default: (props: Readonly<Record<string, unknown>>): ReactElement => (
    <div>{props.children as ReactNode}</div>
  ),
}));

jest.mock('@mezzanine-ui/react', () => {
  function MockContainer(
    props: Readonly<Record<string, unknown>>,
  ): ReactElement {
    return <div>{props.children as ReactNode}</div>;
  }

  function MockFormField(
    props: Readonly<Record<string, unknown>>,
  ): ReactElement {
    return (
      <div data-mock-form-field={String(props.name ?? '')}>
        {props.children as ReactNode}
      </div>
    );
  }

  function MockButton(props: Readonly<Record<string, unknown>>): ReactElement {
    return (
      <button
        data-mock-button={String(props.children ?? '')}
        disabled={props.disabled === true}
        onClick={props.onClick as never}
        type="button"
      >
        {props.children as ReactNode}
      </button>
    );
  }

  function MockInput(props: Readonly<Record<string, unknown>>): ReactElement {
    return (
      <input
        data-mock-input=""
        onChange={props.onChange as never}
        value={String(props.value ?? '')}
      />
    );
  }

  function MockTable(props: Readonly<Record<string, unknown>>): ReactElement {
    const columns = Array.isArray(props.columns) ? props.columns : [];
    const rows = Array.isArray(props.dataSource) ? props.dataSource : [];

    return (
      <div data-mock-table="">
        {rows.map((row, rowIndex): ReactElement => (
          <div data-mock-table-row={String(rowIndex)} key={rowIndex}>
            {columns.map((column, columnIndex): ReactElement => {
              const entry = column as {
                readonly key: string;
                readonly render?: (row: unknown) => ReactNode;
              };

              return (
                <span data-mock-table-cell={entry.key} key={columnIndex}>
                  {entry.render ? entry.render(row) : null}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    );
  }

  return {
    AutoComplete: MockContainer,
    Button: MockButton,
    CheckboxGroup: MockContainer,
    DatePicker: MockContainer,
    DateTimePicker: MockContainer,
    FormField: MockFormField,
    Input: MockInput,
    PageHeader: MockContainer,
    RadioGroup: MockContainer,
    Section: MockContainer,
    SectionGroup: MockContainer,
    Select: MockContainer,
    Table: MockTable,
    Textarea: MockContainer,
    Toggle: MockContainer,
    Typography: (props: Readonly<Record<string, unknown>>): ReactElement => (
      <span>{props.children as ReactNode}</span>
    ),
    Upload: MockContainer,
  };
});

jest.mock(
  '@rytass/bpm-core-client/workflow',
  (): typeof import('@rytass/bpm-core-client/workflow') => {
    const actual = jest.requireActual(
      '@rytass/bpm-core-client/workflow',
    ) as typeof import('@rytass/bpm-core-client/workflow');

    return {
      ...actual,
      listLaunchableTemplates: jest.fn(),
      readLaunchContext: jest.fn(),
      submitApprovalInstance: jest.fn(),
      uploadAttachment: jest.fn(),
    };
  },
);

jest.mock('../../../lib/auth-provider', () => ({
  useAuth: (): Readonly<Record<string, unknown>> => ({
    member: { memberId: 'member-001' },
  }),
}));

jest.mock('../../../lib/router-adapter', () => ({
  useRouterAdapter: (): Readonly<Record<string, unknown>> => ({
    push: jest.fn(),
  }),
}));

jest.mock('../../../lib/routes-config', () => ({
  useBPMRoutes: (): Readonly<Record<string, unknown>> => ({
    caseDetail: (id: string): string => `/instances/${id}`,
    caseNew: (id: string): string => `/instances/new?templateId=${id}`,
  }),
}));

const readLaunchContextMock = readLaunchContext as jest.MockedFunction<
  typeof readLaunchContext
>;
const submitMock = submitApprovalInstance as jest.MockedFunction<
  typeof submitApprovalInstance
>;

/**
 * The launch page keeps its own copy of the form values, which stays empty
 * until the filler edits something — while the renderer already shows the rows
 * a table seeds from `minRows`. Without composing the two, submitting an
 * untouched table reported "至少需要 1 列" for a table with a visible row.
 * Browser testing found that; this is the guard.
 */
describe('InstanceNewView table launch', () => {
  beforeEach((): void => {
    readLaunchContextMock.mockResolvedValue({
      formVersion: {
        schema: createTableSchema(),
        uiSchema: {
          layout: [{ fieldKey: 'items', width: 'FULL' }],
          schemaVersion: 1,
        },
      },
      template: { id: 'template-1', name: '請購單' },
      templateVersion: { workflowDefinition: createWorkflowDefinition([]) },
    } as unknown as Awaited<ReturnType<typeof readLaunchContext>>);
    submitMock.mockResolvedValue('instance-1');
  });

  afterEach((): void => {
    jest.clearAllMocks();
  });

  // Submitting without touching anything is the case that broke: the page's
  // own copy is still `{}`, so the row count read as zero even though a row is
  // on screen.
  it('reports the empty cell, not a missing row, on an untouched table', async (): Promise<void> => {
    const harness = await mountLaunchView();

    try {
      await clickSubmit(harness.container);

      expect(harness.container.textContent).toContain('品項為必填欄位。');
      expect(harness.container.textContent).not.toContain('至少需要');
      expect(submitMock).not.toHaveBeenCalled();
    } finally {
      await unmountLaunchView(harness);
    }
  });

  it('submits the rows the renderer seeded even when nothing was edited', async (): Promise<void> => {
    readLaunchContextMock.mockResolvedValue({
      formVersion: {
        schema: createTableSchema({ requireName: false }),
        uiSchema: {
          layout: [{ fieldKey: 'items', width: 'FULL' }],
          schemaVersion: 1,
        },
      },
      template: { id: 'template-1', name: '請購單' },
      templateVersion: { workflowDefinition: createWorkflowDefinition([]) },
    } as unknown as Awaited<ReturnType<typeof readLaunchContext>>);

    const harness = await mountLaunchView();

    try {
      await clickSubmit(harness.container);

      expect(submitMock).toHaveBeenCalledWith(
        expect.objectContaining({
          formData: expect.objectContaining({ items: [{ inStock: false }] }),
        }),
      );
    } finally {
      await unmountLaunchView(harness);
    }
  });

  it('keeps a cell edit in the submitted rows', async (): Promise<void> => {
    const harness = await mountLaunchView();

    try {
      typeIntoCell(harness.container, 'name', 0, '螺絲');
      await clickSubmit(harness.container);

      expect(submitMock).toHaveBeenCalledWith(
        expect.objectContaining({
          formData: expect.objectContaining({
            items: [{ inStock: false, name: '螺絲' }],
          }),
        }),
      );
    } finally {
      await unmountLaunchView(harness);
    }
  });
});

/**
 * A field some approver fills in is not the applicant's to fill: the server
 * drops it on submit, so rendering it would swallow what they type, and a
 * `minRows` on it would block a launch nobody can complete.
 */
describe('InstanceNewView approver-filled fields', () => {
  const mockContext = (schema: FormDefinitionSchema): void => {
    readLaunchContextMock.mockResolvedValue({
      formVersion: {
        schema,
        uiSchema: {
          layout: schema.fields.map((field) => ({
            fieldKey: field.fieldKey,
            width: 'FULL',
          })),
          schemaVersion: 1,
        },
      },
      template: { id: 'template-1', name: '請購單' },
      templateVersion: {
        workflowDefinition: createWorkflowDefinition(['financeItems']),
      },
    } as unknown as Awaited<ReturnType<typeof readLaunchContext>>);
  };
  const withApplicantField: FormDefinitionSchema = {
    fields: [
      { fieldKey: 'reason', label: '事由', required: false, type: 'text' },
      ...createTableSchema().fields.map((field) => ({
        ...field,
        fieldKey: 'financeItems',
        label: '財務明細',
      })),
    ],
    schemaVersion: 1,
  };

  beforeEach((): void => {
    submitMock.mockResolvedValue('instance-1');
  });

  afterEach((): void => {
    jest.clearAllMocks();
  });

  it('does not render or submit approver-filled fields', async (): Promise<void> => {
    mockContext(withApplicantField);

    const harness = await mountLaunchView();

    try {
      expect(
        harness.container.querySelector('[data-mock-form-field="reason"]'),
      ).not.toBeNull();
      expect(
        harness.container.querySelector(
          '[data-mock-form-field="financeItems"]',
        ),
      ).toBeNull();

      await clickSubmit(harness.container);

      expect(submitMock).toHaveBeenCalledTimes(1);

      const submitted = submitMock.mock.calls[0]?.[0].formData ?? {};

      expect(Object.keys(submitted)).not.toContain('financeItems');
    } finally {
      await unmountLaunchView(harness);
    }
  });

  it('submits even when an approver-filled table declares minRows', async (): Promise<void> => {
    mockContext({
      fields: [
        ...withApplicantField.fields.slice(0, 1),
        ...withApplicantField.fields.slice(1).map((field) => ({
          ...field,
          required: true,
        })),
      ],
      schemaVersion: 1,
    });

    const harness = await mountLaunchView();

    try {
      await clickSubmit(harness.container);

      expect(harness.container.textContent).not.toContain('必填');
      expect(harness.container.textContent).not.toContain('至少需要');
      expect(submitMock).toHaveBeenCalledTimes(1);
    } finally {
      await unmountLaunchView(harness);
    }
  });
});

interface LaunchHarness {
  readonly container: HTMLElement;
  readonly root: ReturnType<typeof createRoot>;
}

async function mountLaunchView(): Promise<LaunchHarness> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  await act(async (): Promise<void> => {
    root.render(<InstanceNewView templateId="template-1" />);
  });
  await act(async (): Promise<void> => {
    await Promise.resolve();
  });

  return { container, root };
}

async function unmountLaunchView(harness: LaunchHarness): Promise<void> {
  await act(async (): Promise<void> => {
    harness.root.unmount();
  });
  harness.container.remove();
}

async function clickSubmit(container: HTMLElement): Promise<void> {
  const submit = container.querySelector(
    '[data-mock-button="送出"]',
  ) as HTMLButtonElement | null;

  if (!submit) {
    throw new Error('The submit button was not rendered.');
  }

  await act(async (): Promise<void> => {
    submit.click();
  });
}

function createTableSchema({
  requireName = true,
}: { readonly requireName?: boolean } = {}): FormDefinitionSchema {
  return {
    fields: [
      {
        columns: [
          {
            fieldKey: 'name',
            label: '品項',
            required: requireName,
            type: 'text',
          },
          {
            defaultValue: false,
            fieldKey: 'inStock',
            label: '有庫存',
            required: false,
            type: 'boolean',
          },
        ],
        fieldKey: 'items',
        label: '請購明細',
        minRows: 1,
        required: false,
        type: 'table',
      },
    ],
    schemaVersion: 1,
  };
}

function typeIntoCell(
  container: HTMLElement,
  columnKey: string,
  rowIndex: number,
  value: string,
): void {
  const input = container.querySelector(
    `[data-mock-table-row="${rowIndex}"] [data-mock-table-cell="${columnKey}"] input`,
  ) as HTMLInputElement | null;

  if (!input) {
    throw new Error(`Cell ${columnKey} of row ${rowIndex} was not rendered.`);
  }

  act((): void => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function createWorkflowDefinition(
  approverFilledFieldKeys: readonly string[],
): WorkflowDefinition {
  return {
    edges: [],
    meta: { schemaVersion: 1 },
    nodes: [
      {
        data: {
          allowAddSigner: false,
          allowReject: true,
          allowTransfer: false,
          approverResolver: { memberIds: ['m-1'], type: 'DIRECT' },
          decisionPolicy: { type: 'SINGLE' },
          fieldPermissions: approverFilledFieldKeys.map((fieldPath) => ({
            editable: true,
            fieldPath,
            required: false,
            visible: true,
          })),
          label: 'finance',
          returnBehavior: { allowReturn: true, allowedTargets: 'PREVIOUS' },
        },
        id: 'finance',
        position: { x: 0, y: 0 },
        type: 'userTask',
      },
    ],
  };
}
