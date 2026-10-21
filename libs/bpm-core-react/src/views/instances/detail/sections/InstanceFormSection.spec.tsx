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
        <span data-mock-label-marker="">
          {String(props.labelOptionalMarker ?? '')}
        </span>
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
        readOnly={props.readonly === true}
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
    InlineMessage: (props: Readonly<Record<string, unknown>>): ReactElement => (
      <div data-mock-inline-message={String(props.severity)}>
        {String(props.content)}
      </div>
    ),
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

describe('InstanceFormSection fill mode', () => {
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

  const schema = INSTANCE.formDefinitionSnapshot.schema;

  async function render(
    props: Partial<Parameters<typeof InstanceFormSection>[0]>,
  ): Promise<void> {
    await act(async (): Promise<void> => {
      root.render(
        <InstanceFormSection
          canResubmitInstance={false}
          deciding={false}
          error={null}
          instance={INSTANCE}
          loading={false}
          onDataSourceStateChange={jest.fn()}
          onResubmitFormChange={jest.fn()}
          onResubmitInstance={jest.fn()}
          onUploadAttachment={jest.fn()}
          resubmitFormData={{}}
          resubmitFormErrors={{}}
          {...props}
        />,
      );
    });
  }

  const input = (fieldKey: string): HTMLInputElement | null =>
    container.querySelector<HTMLInputElement>(
      `${FORM_FIELD_SELECTOR(fieldKey)} [data-mock-input]`,
    );

  it('lets the approver edit only the fill fields, with a notice and markers', async (): Promise<void> => {
    const onChange = jest.fn();

    await render({
      fieldAccess: {
        financeNote: { editable: true, visible: true },
        reason: { editable: false, visible: true },
      },
      fieldLabelMarkers: { financeNote: '本關補填' },
      fill: {
        errors: { financeNote: '財務備註為必填欄位。' },
        fieldCount: 1,
        onChange,
        schema: schema ?? { fields: [], schemaVersion: 1 },
        value: { financeNote: '草稿', reason: '出差' },
      },
    });

    expect(
      container.querySelector('[data-mock-inline-message="info"]')?.textContent,
    ).toBe('本關需要你補填 1 個欄位，按「同意」時會一起送出並納入簽章。');
    expect(input('reason')?.readOnly).toBe(true);
    expect(input('financeNote')?.readOnly).toBe(false);
    expect(input('financeNote')?.value).toBe('草稿');
    expect(
      container.querySelector(
        `${FORM_FIELD_SELECTOR('financeNote')} [data-mock-label-marker]`,
      )?.textContent,
    ).toBe('本關補填');

    act((): void => {
      const target = input('financeNote');

      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set?.call(target, '新值');
      target?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ financeNote: '新值' }),
    );
  });

  it('hides a field the viewer may not see yet', async (): Promise<void> => {
    await render({
      fieldAccess: {
        financeNote: { editable: false, visible: false },
        reason: { editable: false, visible: true },
      },
    });

    expect(container.querySelector(FORM_FIELD_SELECTOR('financeNote'))).toBeNull();
    expect(container.querySelector('[data-mock-inline-message]')).toBeNull();
  });

  it('offers a reload after a conflict', async (): Promise<void> => {
    const onReload = jest.fn();

    await render({ onReloadAfterConflict: onReload });

    expect(
      container.querySelector('[data-mock-inline-message="error"]')?.textContent,
    ).toContain('表單在你填寫期間被更新了');

    act((): void => {
      container
        .querySelector<HTMLButtonElement>('[data-mock-button="重新載入"]')
        ?.click();
    });

    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
