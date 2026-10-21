import { act, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ApprovalInstanceRecord } from '@rytass/bpm-core-client/workflow';
import type { WorkflowDefinition } from '@rytass/bpm-core-shared';
import { InstanceFormSection } from './InstanceFormSection';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

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

const FORM_FIELD_SELECTOR = (fieldKey: string): string =>
  `[data-mock-form-field="${fieldKey}"]`;

const WORKFLOW: WorkflowDefinition = {
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
        fieldAccess: [
          {
            display: 'SHOW',
            fieldKey: 'financeNote',
            fill: 'OPTIONAL',
          },
        ],
        label: 'finance',
        returnBehavior: { allowReturn: true, allowedTargets: 'PREVIOUS' },
      },
      id: 'finance',
      position: { x: 0, y: 0 },
      type: 'userTask',
    },
  ],
};

const INSTANCE = {
  formData: { financeNote: '已核銷', reason: '出差' },
  formDataOptionSnapshot: {},
  formDefinitionSnapshot: {
    schema: {
      fields: [
        { fieldKey: 'reason', label: '事由', required: false, type: 'text' },
        {
          fieldKey: 'financeNote',
          label: '財務備註',
          required: false,
          type: 'text',
        },
      ],
      schemaVersion: 1,
    },
    uiSchema: {
      layout: [
        { fieldKey: 'reason', width: 'FULL' },
        { fieldKey: 'financeNote', width: 'FULL' },
      ],
      schemaVersion: 1,
    },
  },
  id: 'instance-1',
  workflowSnapshot: WORKFLOW,
} as unknown as ApprovalInstanceRecord;

describe('InstanceFormSection approver-filled fields', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach((): void => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach((): void => {
    act((): void => root.unmount());
    container.remove();
  });

  async function render(canResubmitInstance: boolean): Promise<void> {
    await act(async (): Promise<void> => {
      root.render(
        <InstanceFormSection
          canResubmitInstance={canResubmitInstance}
          deciding={false}
          error={null}
          instance={INSTANCE}
          loading={false}
          onDataSourceStateChange={jest.fn()}
          onResubmitFormChange={jest.fn()}
          onResubmitInstance={jest.fn()}
          onUploadAttachment={jest.fn()}
          resubmitFormData={{ reason: '出差' }}
          resubmitFormErrors={{}}
        />,
      );
    });
  }

  it('hides approver-filled fields while resubmitting', async (): Promise<void> => {
    await render(true);

    expect(
      container.querySelector(FORM_FIELD_SELECTOR('reason')),
    ).not.toBeNull();
    expect(
      container.querySelector(FORM_FIELD_SELECTOR('financeNote')),
    ).toBeNull();
  });

  it('keeps the read-only view unchanged', async (): Promise<void> => {
    await render(false);

    expect(
      container.querySelector(FORM_FIELD_SELECTOR('reason')),
    ).not.toBeNull();
    expect(
      container.querySelector(FORM_FIELD_SELECTOR('financeNote')),
    ).not.toBeNull();
  });
});
