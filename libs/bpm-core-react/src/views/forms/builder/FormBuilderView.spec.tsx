import { act, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type {
  FormDefinitionSchema,
  FormUiSchema,
} from '@rytass/bpm-core-shared/form';
import { listFormDataSources } from '@rytass/bpm-core-client/form';
import { FormBuilderView } from './FormBuilderView';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

jest.mock('@mezzanine-ui/core/form', () => ({
  FormFieldDensity: { TIGHT: 'TIGHT' },
  FormFieldLayout: { HORIZONTAL: 'HORIZONTAL' },
}));

jest.mock('@mezzanine-ui/core/table', () => ({}));

jest.mock('@mezzanine-ui/icons', () => new Proxy({}, {
  get: (_target, property): unknown => ({ name: String(property) }),
}));

jest.mock('@hello-pangea/dnd', () => {
  const provided = {
    dragHandleProps: {},
    draggableProps: { style: {} },
    droppableProps: {},
    innerRef: (): void => undefined,
    placeholder: null,
  };

  return {
    DragDropContext: (props: Readonly<Record<string, unknown>>): ReactNode =>
      props.children as ReactNode,
    Draggable: (props: Readonly<Record<string, unknown>>): ReactNode =>
      (props.children as (p: unknown, s: unknown) => ReactNode)(provided, {
        isDragging: false,
      }),
    Droppable: (props: Readonly<Record<string, unknown>>): ReactNode =>
      (props.children as (p: unknown) => ReactNode)(provided),
  };
});

jest.mock('./json-code-editor', () => ({
  JsonCodeEditor: (): ReactElement => <div data-mock-json-editor />,
}));

jest.mock('../renderer/FormRendererView', () => ({
  FormRenderer: (): ReactElement => <div data-mock-form-renderer />,
}));

jest.mock('@mezzanine-ui/react', () => {
  function MockFormField(
    props: Readonly<Record<string, unknown>>,
  ): ReactElement {
    return (
      <div data-mock-form-field={String(props.name ?? '')}>
        <span>{String(props.label ?? '')}</span>
        {props.children as ReactNode}
      </div>
    );
  }

  function MockInput(props: Readonly<Record<string, unknown>>): ReactElement {
    return (
      <input
        data-mock-input=""
        onChange={props.onChange as never}
        readOnly={false}
        value={String(props.value ?? '')}
      />
    );
  }

  function MockTextarea(
    props: Readonly<Record<string, unknown>>,
  ): ReactElement {
    return (
      <textarea
        data-mock-textarea=""
        onChange={props.onChange as never}
        value={String(props.value ?? '')}
      />
    );
  }

  function MockSelect(props: Readonly<Record<string, unknown>>): ReactElement {
    const options = Array.isArray(props.options) ? props.options : [];
    const onChange = props.onChange as
      | ((option: unknown) => void)
      | undefined;

    return (
      <div data-mock-select="">
        {options.map((option): ReactElement => {
          const entry = option as { readonly id: string; readonly name: string };

          return (
            <button
              data-mock-select-option={entry.id}
              key={entry.id}
              onClick={(): void => onChange?.(entry)}
              type="button"
            >
              {entry.name}
            </button>
          );
        })}
      </div>
    );
  }

  function MockToggle(props: Readonly<Record<string, unknown>>): ReactElement {
    return (
      <input
        checked={props.checked === true}
        data-mock-toggle={String(props.label ?? '')}
        onChange={props.onChange as never}
        type="checkbox"
      />
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

  function MockTable(props: Readonly<Record<string, unknown>>): ReactElement {
    const columns = Array.isArray(props.columns) ? props.columns : [];
    const rows = Array.isArray(props.dataSource) ? props.dataSource : [];
    const actions = props.actions as
      | { readonly render: (row: unknown) => readonly unknown[] }
      | undefined;

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
            {(actions?.render(row) ?? []).map((action, actionIndex): ReactElement => {
              const entry = action as {
                readonly disabled?: () => boolean;
                readonly name: string;
                readonly onClick: () => void;
              };

              return (
                <button
                  data-mock-table-action={entry.name}
                  disabled={entry.disabled?.() === true}
                  key={actionIndex}
                  onClick={entry.onClick}
                  type="button"
                >
                  {entry.name}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    );
  }

  function MockModal(props: Readonly<Record<string, unknown>>): ReactElement {
    return (
      <div data-mock-modal={String(props.title ?? '')}>
        {props.children as ReactNode}
        <button
          data-mock-modal-confirm=""
          onClick={props.onConfirm as never}
          type="button"
        >
          confirm
        </button>
      </div>
    );
  }

  function MockContainer(
    props: Readonly<Record<string, unknown>>,
  ): ReactElement {
    return <div>{props.children as ReactNode}</div>;
  }

  return {
    Accordion: MockContainer,
    AutoComplete: MockContainer,
    BaseCard: MockContainer,
    Badge: (props: Readonly<Record<string, unknown>>): ReactElement => (
      <span data-mock-badge={String(props.text ?? '')} />
    ),
    Button: MockButton,
    CheckboxGroup: MockContainer,
    DatePicker: MockContainer,
    DateTimePicker: MockContainer,
    FormField: MockFormField,
    Icon: (): ReactElement => <span data-mock-icon="" />,
    Input: MockInput,
    Modal: MockModal,
    RadioGroup: MockContainer,
    Section: MockContainer,
    SectionGroup: MockContainer,
    Select: MockSelect,
    Tab: MockContainer,
    TabItem: MockContainer,
    Table: MockTable,
    Textarea: MockTextarea,
    Toggle: MockToggle,
    Typography: MockContainer,
    Upload: MockContainer,
  };
});

jest.mock(
  '@rytass/bpm-core-client/form',
  (): typeof import('@rytass/bpm-core-client/form') => {
    const actual = jest.requireActual(
      '@rytass/bpm-core-client/form',
    ) as typeof import('@rytass/bpm-core-client/form');

    return {
      ...actual,
      listFormDataSources: jest.fn(),
      lintFormSchema: jest.fn(),
    };
  },
);

const listDataSourcesMock = listFormDataSources as jest.MockedFunction<
  typeof listFormDataSources
>;

interface BuilderHarness {
  readonly container: HTMLElement;
  readonly readSchema: () => FormDefinitionSchema;
  readonly readUiSchema: () => FormUiSchema;
  readonly root: Root;
}

/**
 * These lock the type-specific settings renderers, which were rewritten to take
 * `(field, commit)` so one implementation can serve both a top-level field and
 * a table column (ADR 16 §3.9). Everything asserted here is behaviour that
 * predates that refactor.
 */
describe('FormBuilderView field settings', () => {
  beforeEach((): void => {
    listDataSourcesMock.mockResolvedValue([]);
  });

  afterEach((): void => {
    jest.clearAllMocks();
  });

  it('edits a text field default value, min length and max length', async (): Promise<void> => {
    const harness = await mountBuilder(
      createSchema([
        { fieldKey: 'reason', label: '事由', required: false, type: 'text' },
      ]),
    );

    try {
      typeInto(harness.container, 'fieldDefaultValue', '預設事由');
      expect(readField(harness.readSchema(), 'reason')).toMatchObject({
        defaultValue: '預設事由',
      });

      typeInto(harness.container, 'fieldMinLength', '2');
      typeInto(harness.container, 'fieldMaxLength', '20');
      expect(readField(harness.readSchema(), 'reason')).toMatchObject({
        maxLength: 20,
        minLength: 2,
      });
    } finally {
      await unmount(harness);
    }
  });

  it('edits a number field default, minimum and maximum', async (): Promise<void> => {
    const harness = await mountBuilder(
      createSchema([
        { fieldKey: 'amount', label: '金額', required: false, type: 'number' },
      ]),
    );

    try {
      typeInto(harness.container, 'fieldMinimum', '10');
      typeInto(harness.container, 'fieldMaximum', '100');
      typeInto(harness.container, 'fieldDefaultValue', '50');

      expect(readField(harness.readSchema(), 'amount')).toMatchObject({
        defaultValue: 50,
        maximum: 100,
        minimum: 10,
      });
    } finally {
      await unmount(harness);
    }
  });

  it('edits a boolean field default value', async (): Promise<void> => {
    const harness = await mountBuilder(
      createSchema([
        { fieldKey: 'urgent', label: '急件', required: false, type: 'boolean' },
      ]),
    );

    try {
      selectOption(harness.container, 'fieldDefaultValue', 'true');
      expect(readField(harness.readSchema(), 'urgent')).toMatchObject({
        defaultValue: true,
      });

      selectOption(harness.container, 'fieldDefaultValue', 'unset');
      expect(readField(harness.readSchema(), 'urgent')).not.toHaveProperty(
        'defaultValue',
        true,
      );
    } finally {
      await unmount(harness);
    }
  });

  it('adds and removes static options through the option table', async (): Promise<void> => {
    const harness = await mountBuilder(
      createSchema([
        {
          fieldKey: 'level',
          label: '層級',
          options: [
            { label: '選項 A', value: 'option_a' },
            { label: '選項 B', value: 'option_b' },
          ],
          required: false,
          type: 'select',
        },
      ]),
    );

    try {
      clickButton(harness.container, '新增選項');
      expect(readOptionValues(harness.readSchema(), 'level')).toEqual([
        'option_a',
        'option_b',
        'option_3',
      ]);

      clickTableAction(harness.container, '移除選項', 0);
      expect(readOptionValues(harness.readSchema(), 'level')).toEqual([
        'option_b',
        'option_3',
      ]);

      typeIntoTableCell(harness.container, 'value', 0, 'option_z');
      expect(readOptionValues(harness.readSchema(), 'level')).toEqual([
        'option_z',
        'option_3',
      ]);
    } finally {
      await unmount(harness);
    }
  });

  it('renames a field key and keeps the ui schema layout aligned', async (): Promise<void> => {
    const harness = await mountBuilder(
      createSchema([
        { fieldKey: 'reason', label: '事由', required: false, type: 'text' },
      ]),
    );

    try {
      typeInto(harness.container, 'fieldKey', 'purpose');

      expect(harness.readSchema().fields[0]?.fieldKey).toBe('purpose');
      expect(harness.readUiSchema().layout[0]?.fieldKey).toBe('purpose');
    } finally {
      await unmount(harness);
    }
  });
});

async function mountBuilder(
  value: {
    readonly schema: FormDefinitionSchema;
    readonly uiSchema: FormUiSchema;
  },
): Promise<BuilderHarness> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let latest = value;

  await act(async (): Promise<void> => {
    root.render(
      <FormBuilderView
        onChange={(next): void => {
          latest = next;
        }}
        value={value}
      />,
    );
  });

  return {
    container,
    readSchema: (): FormDefinitionSchema => latest.schema,
    readUiSchema: (): FormUiSchema => latest.uiSchema,
    root,
  };
}

async function unmount(harness: BuilderHarness): Promise<void> {
  await act(async (): Promise<void> => {
    harness.root.unmount();
  });
  harness.container.remove();
}

function createSchema(fields: readonly unknown[]): {
  readonly schema: FormDefinitionSchema;
  readonly uiSchema: FormUiSchema;
} {
  return {
    schema: {
      fields: fields as FormDefinitionSchema['fields'],
      schemaVersion: 1,
    },
    uiSchema: {
      layout: (fields as readonly { readonly fieldKey: string }[]).map(
        (field) => ({ fieldKey: field.fieldKey, width: 'HALF' as const }),
      ),
      schemaVersion: 1,
    },
  };
}

function readField(
  schema: FormDefinitionSchema,
  fieldKey: string,
): Readonly<Record<string, unknown>> {
  const field = schema.fields.find(
    (candidate) => candidate.fieldKey === fieldKey,
  );

  if (!field) {
    throw new Error(`Field ${fieldKey} is missing from the schema.`);
  }

  return field as unknown as Readonly<Record<string, unknown>>;
}

function readOptionValues(
  schema: FormDefinitionSchema,
  fieldKey: string,
): readonly string[] {
  const options = readField(schema, fieldKey).options;

  return Array.isArray(options)
    ? options.map((option) => (option as { readonly value: string }).value)
    : [];
}

function typeInto(
  container: HTMLElement,
  fieldName: string,
  value: string,
): void {
  const input = container.querySelector(
    `[data-mock-form-field="${fieldName}"] input, [data-mock-form-field="${fieldName}"] textarea`,
  ) as HTMLInputElement | HTMLTextAreaElement | null;

  if (!input) {
    throw new Error(`Settings control ${fieldName} was not rendered.`);
  }

  setControlValue(input, value);
}

function typeIntoTableCell(
  container: HTMLElement,
  cellKey: string,
  rowIndex: number,
  value: string,
): void {
  const input = container.querySelector(
    `[data-mock-table-row="${rowIndex}"] [data-mock-table-cell="${cellKey}"] input`,
  ) as HTMLInputElement | null;

  if (!input) {
    throw new Error(`Table cell ${cellKey} row ${rowIndex} was not rendered.`);
  }

  setControlValue(input, value);
}

/**
 * React tracks an input's value internally, so assigning `.value` directly is
 * invisible to it; going through the native setter is what makes the synthetic
 * change event fire.
 */
function setControlValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;

  act((): void => {
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(
      element,
      value,
    );
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function selectOption(
  container: HTMLElement,
  fieldName: string,
  optionId: string,
): void {
  const option = container.querySelector(
    `[data-mock-form-field="${fieldName}"] [data-mock-select-option="${optionId}"]`,
  ) as HTMLButtonElement | null;

  if (!option) {
    throw new Error(`Option ${optionId} of ${fieldName} was not rendered.`);
  }

  act((): void => {
    option.click();
  });
}

function clickButton(container: HTMLElement, label: string): void {
  const button = container.querySelector(
    `[data-mock-button="${label}"]`,
  ) as HTMLButtonElement | null;

  if (!button) {
    throw new Error(`Button ${label} was not rendered.`);
  }

  act((): void => {
    button.click();
  });
}

function clickTableAction(
  container: HTMLElement,
  actionName: string,
  rowIndex: number,
): void {
  const action = container.querySelector(
    `[data-mock-table-row="${rowIndex}"] [data-mock-table-action="${actionName}"]`,
  ) as HTMLButtonElement | null;

  if (!action) {
    throw new Error(`Table action ${actionName} row ${rowIndex} is missing.`);
  }

  act((): void => {
    action.click();
  });
}
