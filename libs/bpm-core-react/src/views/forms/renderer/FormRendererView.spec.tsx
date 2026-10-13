import {
  act,
  type ChangeEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createRoot } from 'react-dom/client';
import type {
  FormDataSourceOptionFieldDefinition,
  FormDefinitionSchema,
  FormUiSchema,
} from '@rytass/bpm-core-shared/form';
import {
  previewFormFieldOptions,
  type FormDataSourceOptionsResultRecord,
  type FormRendererValues,
} from '@rytass/bpm-core-client/form';
import { FormRenderer } from './FormRendererView';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

jest.mock('@mezzanine-ui/core/form', () => ({
  FormFieldDensity: { TIGHT: 'TIGHT' },
  FormFieldLayout: { HORIZONTAL: 'HORIZONTAL' },
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

  function MockTypography(
    props: Readonly<Record<string, unknown>>,
  ): ReactElement {
    return <span>{props.children as ReactNode}</span>;
  }

  function MockButton(
    props: Readonly<Record<string, unknown>>,
  ): ReactElement {
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

  function MockOptionControl(
    props: Readonly<Record<string, unknown>>,
    controlName: string,
  ): ReactElement {
    const options = readMockOptions(props.options);
    const onSearch =
      typeof props.onSearch === 'function'
        ? (props.onSearch as (value: string) => void)
        : undefined;

    return (
      <div
        data-mock-control={controlName}
        data-mock-disabled={String(props.disabled === true)}
      >
        <input
          data-mock-search={controlName}
          onChange={(event): void => onSearch?.(event.target.value)}
        />
        {options.map((option) => (
          <span key={option.id}>{option.name}</span>
        ))}
      </div>
    );
  }

  function MockRadioGroup(
    props: Readonly<Record<string, unknown>>,
  ): ReactElement {
    const options = readMockOptions(props.options);
    const onChange =
      typeof props.onChange === 'function'
        ? (props.onChange as (event: ChangeEvent<HTMLInputElement>) => void)
        : undefined;

    return (
      <div
        data-mock-control="RadioGroup"
        data-mock-disabled={String(props.disabled === true)}
      >
        {options.map((option) => (
          <label key={option.id}>
            <input
              name={String(props.name ?? '')}
              onChange={(event): void => onChange?.(event)}
              type="radio"
              value={option.id}
            />
            {option.name}
          </label>
        ))}
      </div>
    );
  }

  function MockCheckboxGroup(
    props: Readonly<Record<string, unknown>>,
  ): ReactElement {
    const options = readMockOptions(props.options);
    const onChange =
      typeof props.onChange === 'function'
        ? (props.onChange as (
            event: ChangeEvent<HTMLInputElement> & {
              readonly target: HTMLInputElement & { readonly values: string[] };
            },
          ) => void)
        : undefined;

    return (
      <div
        data-mock-control="CheckboxGroup"
        data-mock-disabled={String(props.disabled === true)}
      >
        {options.map((option) => (
          <label key={option.id}>
            <input
              name={String(props.name ?? '')}
              onChange={(event): void => {
                const nextEvent = event as ChangeEvent<HTMLInputElement> & {
                  target: HTMLInputElement & { values: string[] };
                };
                nextEvent.target.values = [option.id];
                onChange?.(nextEvent);
              }}
              type="checkbox"
              value={option.id}
            />
            {option.name}
          </label>
        ))}
      </div>
    );
  }

  function MockBasicControl(
    props: Readonly<Record<string, unknown>>,
  ): ReactElement {
    return <div>{props.children as ReactNode}</div>;
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
    const actions = props.actions as
      | { readonly render: (row: unknown) => readonly unknown[] }
      | undefined;

    return (
      <div data-mock-table="">
        {rows.map((row, rowIndex): ReactElement => (
          <div
            data-mock-table-row={String(rowIndex)}
            // The row's own key, the way Mezzanine's Table uses it: the
            // ephemeral row id is what keeps per-row state (from P3, each
            // cell's DataSource state) attached to the right row.
            key={String((row as { readonly key?: unknown }).key ?? rowIndex)}
          >
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

  return {
    AutoComplete: (props: Readonly<Record<string, unknown>>): ReactElement =>
      MockOptionControl(props, 'AutoComplete'),
    Button: MockButton,
    CheckboxGroup: MockCheckboxGroup,
    DatePicker: MockBasicControl,
    DateTimePicker: MockBasicControl,
    FormField: MockFormField,
    Input: MockInput,
    RadioGroup: MockRadioGroup,
    Select: (props: Readonly<Record<string, unknown>>): ReactElement =>
      MockOptionControl(props, 'Select'),
    Table: MockTable,
    Textarea: MockBasicControl,
    Toggle: MockBasicControl,
    Typography: MockTypography,
    Upload: MockBasicControl,
  };
});

jest.mock('@rytass/bpm-core-client/form', (): typeof import('@rytass/bpm-core-client/form') => {
  const actual = jest.requireActual(
    '@rytass/bpm-core-client/form',
  ) as typeof import('@rytass/bpm-core-client/form');

  return {
    ...actual,
    previewFormFieldOptions: jest.fn(),
  };
});

// The picker itself is covered by member-field.spec.tsx; here only the wiring
// from a `member` field definition to its props is under test.
jest.mock('./member-field', () => ({
  MemberFieldControl: (props: Readonly<Record<string, unknown>>): ReactElement => (
    <div
      data-mock-member-field={String(props.name)}
      data-mock-member-multiple={String(props.multiple)}
      data-mock-member-readonly={String(props.readonly)}
      data-mock-member-value={JSON.stringify(props.value ?? null)}
    >
      <button
        data-mock-member-pick=""
        onClick={(): void =>
          (props.onChange as (value: unknown) => void)(
            props.multiple ? ['m1', 'm2'] : 'm1',
          )
        }
        type="button"
      />
    </div>
  ),
}));

const previewOptionsMock = previewFormFieldOptions as jest.MockedFunction<
  typeof previewFormFieldOptions
>;

interface MockOption {
  readonly id: string;
  readonly name: string;
}

function readMockOptions(value: unknown): readonly MockOption[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((option): readonly MockOption[] => {
    if (
      typeof option === 'object' &&
      option !== null &&
      'id' in option &&
      'name' in option &&
      typeof option.id === 'string' &&
      typeof option.name === 'string'
    ) {
      return [{ id: option.id, name: option.name }];
    }

    if (
      typeof option === 'object' &&
      option !== null &&
      'label' in option &&
      'value' in option &&
      typeof option.label === 'string' &&
      typeof option.value === 'string'
    ) {
      return [{ id: option.value, name: option.label }];
    }

    return [];
  });
}

describe('FormRenderer DataSource controls', () => {
  afterEach((): void => {
    jest.clearAllMocks();
  });

  it('renders Select, AutoComplete, Radio, and Checkbox as dynamic controls', async (): Promise<void> => {
    previewOptionsMock.mockImplementation(
      async (input): Promise<FormDataSourceOptionsResultRecord> => ({
        dataSourceKey: 'demo.options',
        dataSourceVersion: 1,
        nextCursor: null,
        options: [
          { label: `${input.fieldKey} A`, value: 'A' },
          { label: `${input.fieldKey} B`, value: 'B' },
        ],
        waitingForFieldKeys: [],
      }),
    );

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const values: FormRendererValues[] = [];

    try {
      act((): void => {
        root.render(
          <FormRenderer
            dataSourceContext={{ kind: 'preview' }}
            onChange={(nextValues): void => values.push(nextValues)}
            schema={createControlSchema()}
            uiSchema={createUiSchema()}
          />,
        );
      });

      await waitForCondition(
        (): boolean =>
          previewOptionsMock.mock.calls.length === 3 &&
          container.textContent?.includes('radio A') === true &&
          container.textContent?.includes('checkbox A') === true,
      );

      expect(
        container.querySelector('[data-form-field-key="select"]'),
      ).not.toBeNull();
      expect(
        container.querySelector('[data-form-field-key="autocomplete"]'),
      ).not.toBeNull();
      expect(
        container.querySelector('[data-form-field-key="radio"] input[type="radio"]'),
      ).not.toBeNull();
      expect(
        container.querySelector(
          '[data-form-field-key="checkbox"] input[type="checkbox"]',
        ),
      ).not.toBeNull();
      expect(container.textContent).toContain('radio A');
      expect(container.textContent).toContain('checkbox A');

      const radio = container.querySelector(
        '[data-form-field-key="radio"] input[type="radio"]',
      ) as HTMLInputElement | null;
      expect(radio).not.toBeNull();

      act((): void => {
        if (radio) {
          radio.click();
        }
      });

      expect(values.at(-1)?.radio).toBe('A');

      const checkbox = container.querySelector(
        '[data-form-field-key="checkbox"] input[type="checkbox"]',
      ) as HTMLInputElement | null;
      expect(checkbox).not.toBeNull();

      act((): void => {
        if (checkbox) {
          checkbox.click();
        }
      });

      expect(values.at(-1)?.checkbox).toEqual(['A']);
    } finally {
      await act(async (): Promise<void> => {
        root.unmount();
      });
      container.remove();
    }
  });

  // AutoComplete is the one control that must stay editable while the host says
  // a dependency is missing: it has no pre-query gate, so by the time the answer
  // arrives the filler has already typed, and disabling it would strand that
  // text. Every other control blocks up front.
  it('disables every control but AutoComplete while a dependency is missing', async (): Promise<void> => {
    previewOptionsMock.mockImplementation(
      async (): Promise<FormDataSourceOptionsResultRecord> => ({
        dataSourceKey: 'demo.options',
        dataSourceVersion: 1,
        nextCursor: null,
        options: [],
        waitingForFieldKeys: ['plant'],
      }),
    );

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    try {
      act((): void => {
        root.render(
          <FormRenderer
            dataSourceContext={{ kind: 'preview' }}
            schema={createControlSchema()}
            uiSchema={createUiSchema()}
          />,
        );
      });

      await waitForCondition(
        (): boolean =>
          container.textContent?.includes('請先填寫相依欄位。') === true,
      );

      // AutoComplete only learns a dependency is missing from the answer to a
      // search, so it has to be typed into before its wait state exists at all.
      const search = container.querySelector(
        '[data-form-field-key="autocomplete"] [data-mock-search]',
      ) as HTMLInputElement | null;
      expect(search).not.toBeNull();

      act((): void => {
        if (search) {
          // React tracks the input's value internally, so assigning `.value`
          // directly is invisible to it; the native setter is what makes the
          // synthetic change event fire.
          Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value',
          )?.set?.call(search, 'TW');
          search.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });

      // Wait for the answer to be applied, not merely requested: the wait state
      // only exists once `waitingForFieldKeys` has come back.
      await waitForCondition(
        (): boolean =>
          container
            .querySelector('[data-form-field-key="autocomplete"]')
            ?.textContent?.includes('請先填寫相依欄位。') === true,
      );

      const readDisabled = (fieldKey: string): string | null =>
        container
          .querySelector(`[data-form-field-key="${fieldKey}"] [data-mock-disabled]`)
          ?.getAttribute('data-mock-disabled') ?? null;

      expect(readDisabled('autocomplete')).toBe('false');
      expect(readDisabled('select')).toBe('true');
      expect(readDisabled('radio')).toBe('true');
      expect(readDisabled('checkbox')).toBe('true');
    } finally {
      act((): void => {
        root.unmount();
      });
      container.remove();
    }
  });

});

describe('FormRenderer table field', () => {
  it('starts with minRows rows seeded from the column defaults', async (): Promise<void> => {
    const harness = await mountRenderer({
      schema: createTableSchema({ minRows: 2 }),
    });

    try {
      expect(readRowCount(harness.container)).toBe(2);
    } finally {
      await unmountRenderer(harness);
    }
  });

  it('adds and removes rows within the configured bounds', async (): Promise<void> => {
    const harness = await mountRenderer({
      schema: createTableSchema({ maxRows: 2, minRows: 1 }),
    });

    try {
      expect(readRowCount(harness.container)).toBe(1);
      expect(
        readTableAction(harness.container, '刪除此列', 0)?.disabled,
      ).toBe(true);

      clickRendererButton(harness.container, '新增一列');
      expect(readRowCount(harness.container)).toBe(2);
      expect(readAddRowButton(harness.container)?.disabled).toBe(true);
      expect(
        readTableAction(harness.container, '刪除此列', 0)?.disabled,
      ).toBe(false);

      clickTableAction(harness.container, '刪除此列', 0);
      expect(readRowCount(harness.container)).toBe(1);
      expect(readAddRowButton(harness.container)?.disabled).toBe(false);
    } finally {
      await unmountRenderer(harness);
    }
  });

  it('writes a cell edit into its own row only', async (): Promise<void> => {
    const harness = await mountRenderer({
      schema: createTableSchema({ minRows: 2 }),
    });

    try {
      typeIntoCell(harness.container, 'name', 1, 'Bolt');

      expect(harness.readValues().items).toEqual([
        { inStock: false },
        { inStock: false, name: 'Bolt' },
      ]);
    } finally {
      await unmountRenderer(harness);
    }
  });

  // The seeded `inStock: false` surviving both edits is what proves the initial
  // rows came from the column defaults rather than being empty records.
  it('keeps a cleared text cell as an empty string beside its seeded siblings', async (): Promise<void> => {
    const harness = await mountRenderer({
      schema: createTableSchema({ minRows: 1 }),
    });

    try {
      typeIntoCell(harness.container, 'name', 0, 'Bolt');
      expect(harness.readValues().items).toEqual([
        { inStock: false, name: 'Bolt' },
      ]);

      typeIntoCell(harness.container, 'name', 0, '');
      expect(harness.readValues().items).toEqual([
        { inStock: false, name: '' },
      ]);
    } finally {
      await unmountRenderer(harness);
    }
  });

  it('addresses a cell error by its instance path', async (): Promise<void> => {
    const harness = await mountRenderer({
      errors: { 'items[1].name': '品項為必填欄位。' },
      schema: createTableSchema({ minRows: 2 }),
    });

    try {
      expect(
        harness.container.querySelector('[data-form-field-key="items[1].name"]'),
      ).not.toBeNull();
      expect(harness.container.textContent).toContain('品項為必填欄位。');
    } finally {
      await unmountRenderer(harness);
    }
  });

  it('keeps the single-column cap off the table and floors its width per column', async (): Promise<void> => {
    const tableSchema = createTableSchema({ minRows: 1 });
    const harness = await mountRenderer({
      maxWidth: 480,
      schema: {
        ...tableSchema,
        fields: [
          ...tableSchema.fields,
          { fieldKey: 'purpose', label: '事由', required: false, type: 'text' },
        ],
      },
      singleColumn: true,
    });

    try {
      // Capping a table at the single-column reading width shrinks every column
      // until each cell's control overflows its own cell and covers the next
      // column's select chevron (docs/17 P4).
      expect(readFieldWrapper(harness.container, 'items')?.style.maxWidth).toBe(
        '',
      );
      expect(
        readFieldWrapper(harness.container, 'purpose')?.style.maxWidth,
      ).toBe('480px');
      // Mezzanine's Table fills its box, so only this floor makes the
      // surrounding `overflow-x: auto` wrapper actually scroll: two columns at
      // 160 plus the 56 wide row-actions column.
      expect(readTableWidthFloor(harness.container)?.style.minWidth).toBe(
        '376px',
      );
    } finally {
      await unmountRenderer(harness);
    }
  });

  it('hides row actions and the add button in readonly mode', async (): Promise<void> => {
    const harness = await mountRenderer({
      readonly: true,
      schema: createTableSchema({ minRows: 1 }),
    });

    try {
      expect(readRowCount(harness.container)).toBe(1);
      expect(readAddRowButton(harness.container)).toBeNull();
      expect(readTableAction(harness.container, '刪除此列', 0)).toBeNull();
    } finally {
      await unmountRenderer(harness);
    }
  });
});

describe('FormRenderer hidden fields', () => {
  const schema: FormDefinitionSchema = {
    fields: [
      { fieldKey: 'reason', label: '事由', required: true, type: 'text' },
      {
        fieldKey: 'sourceDocId',
        hidden: true,
        label: '來源單據',
        required: false,
        type: 'text',
      },
      {
        fieldKey: 'docVersion',
        hidden: true,
        label: '單據版本',
        required: false,
        type: 'number',
      },
    ],
    schemaVersion: 1,
  };
  const stored = { docVersion: 3, reason: 'old', sourceDocId: 'PO-1' };

  function typeIntoReason(container: HTMLElement, text: string): void {
    const input = container.querySelector(
      '[data-mock-form-field="reason"] input',
    ) as HTMLInputElement | null;

    if (!input) {
      throw new Error('The reason input was not rendered.');
    }

    act((): void => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set?.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  it.each([
    ['fill-in', false],
    ['read-only', true],
  ])('renders no hidden field in %s mode', async (_mode, readonly): Promise<void> => {
    const harness = await mountRenderer({
      readonly,
      schema,
      value: stored,
    });

    try {
      expect(
        harness.container.querySelector('[data-form-field-key="reason"]'),
      ).not.toBeNull();
      expect(
        harness.container.querySelector('[data-form-field-key="sourceDocId"]'),
      ).toBeNull();
      expect(
        harness.container.querySelector('[data-form-field-key="docVersion"]'),
      ).toBeNull();
      expect(harness.container.textContent).not.toContain('來源單據');
    } finally {
      await unmountRenderer(harness);
    }
  });

  // A resubmit mounts the renderer on the stored form data; the hidden values
  // must come back out of the very next edit instead of being dropped.
  it('keeps hidden values in what an edit emits (fill-in and resubmit)', async (): Promise<void> => {
    const resubmit = await mountRenderer({ schema, value: stored });

    try {
      typeIntoReason(resubmit.container, 'new');

      expect(resubmit.readValues()).toEqual({
        docVersion: 3,
        reason: 'new',
        sourceDocId: 'PO-1',
      });
    } finally {
      await unmountRenderer(resubmit);
    }

    const fillIn = await mountRenderer({ schema });

    try {
      typeIntoReason(fillIn.container, 'first');

      expect(fillIn.readValues()).toMatchObject({ reason: 'first' });
      expect(Object.keys(fillIn.readValues())).toEqual(
        expect.arrayContaining(['sourceDocId', 'docVersion']),
      );
    } finally {
      await unmountRenderer(fillIn);
    }
  });
});

describe('FormRenderer link display', () => {
  function createLinkSchema(
    overrides: Readonly<Record<string, unknown>> = {},
  ): FormDefinitionSchema {
    return {
      fields: [
        {
          displayAs: 'link',
          fieldKey: 'source',
          label: '來源單據',
          required: false,
          type: 'text',
          ...overrides,
        } as FormDefinitionSchema['fields'][number],
      ],
      schemaVersion: 1,
    };
  }

  async function readAnchor(
    value: string,
    options: {
      readonly overrides?: Readonly<Record<string, unknown>>;
      readonly readonly?: boolean;
    } = {},
  ): Promise<{
    readonly anchor: HTMLAnchorElement | null;
    readonly container: HTMLElement;
    readonly unmount: () => Promise<void>;
  }> {
    const harness = await mountRenderer({
      readonly: options.readonly ?? true,
      schema: createLinkSchema(options.overrides),
      value: { source: value },
    });

    return {
      anchor: harness.container.querySelector('a'),
      container: harness.container,
      unmount: (): Promise<void> => unmountRenderer(harness),
    };
  }

  it('renders a site-relative path as a same-tab anchor', async (): Promise<void> => {
    const view = await readAnchor('/document-approval/PO/abc');

    try {
      expect(view.anchor?.getAttribute('href')).toBe(
        '/document-approval/PO/abc',
      );
      expect(view.anchor?.getAttribute('target')).toBeNull();
      expect(view.anchor?.getAttribute('title')).toBeNull();
      expect(view.anchor?.getAttribute('aria-label')).toBeNull();
    } finally {
      await view.unmount();
    }
  });

  it('opens an absolute URL in a new tab with noopener noreferrer', async (): Promise<void> => {
    const view = await readAnchor('https://example.com/x');

    try {
      expect(view.anchor?.getAttribute('href')).toBe('https://example.com/x');
      expect(view.anchor?.getAttribute('target')).toBe('_blank');
      expect(view.anchor?.getAttribute('rel')).toBe('noopener noreferrer');
      expect(view.anchor?.getAttribute('title')).toBe('另開新分頁');
      expect(view.anchor?.getAttribute('aria-label')).toBe(
        'https://example.com/x（另開新分頁）',
      );
      // Selecting or copying the link must yield just the URL.
      expect(view.anchor?.textContent).toBe('https://example.com/x');
      expect(view.anchor?.children).toHaveLength(0);
    } finally {
      await view.unmount();
    }
  });

  it.each([['javascript:alert(1)'], ['//evil.example/x'], ['plain text']])(
    'keeps %s as plain text',
    async (value): Promise<void> => {
      const view = await readAnchor(value);

      try {
        expect(view.anchor).toBeNull();
        expect(
          (view.container.querySelector('input') as HTMLInputElement).value,
        ).toBe(value);
      } finally {
        await view.unmount();
      }
    },
  );

  it('keeps the normal text input while filling in', async (): Promise<void> => {
    const view = await readAnchor('/document-approval/PO/abc', {
      readonly: false,
    });

    try {
      expect(view.anchor).toBeNull();
      expect(view.container.querySelector('input')).not.toBeNull();
    } finally {
      await view.unmount();
    }
  });

  it('renders no anchor for a text field without displayAs', async (): Promise<void> => {
    const harness = await mountRenderer({
      readonly: true,
      schema: {
        fields: [
          { fieldKey: 'source', label: '來源單據', required: false, type: 'text' },
        ],
        schemaVersion: 1,
      },
      value: { source: '/document-approval/PO/abc' },
    });

    try {
      expect(harness.container.querySelector('a')).toBeNull();
    } finally {
      await unmountRenderer(harness);
    }
  });
});

describe('FormRenderer member field', () => {
  function createMemberSchema(): FormDefinitionSchema {
    return {
      fields: [
        { fieldKey: 'reviewer', label: '審核人', required: true, type: 'member' },
        {
          fieldKey: 'watchers',
          label: '關注者',
          multiple: true,
          required: false,
          type: 'member',
        },
      ],
      schemaVersion: 1,
    };
  }

  function readMember(
    container: HTMLElement,
    fieldKey: string,
  ): HTMLElement | null {
    return container.querySelector(`[data-mock-member-field="${fieldKey}"]`);
  }

  it('renders the picker with the field mode and writes member ids back', async (): Promise<void> => {
    const harness = await mountRenderer({ schema: createMemberSchema() });

    try {
      expect(
        readMember(harness.container, 'reviewer')?.dataset.mockMemberMultiple,
      ).toBe('false');
      expect(
        readMember(harness.container, 'watchers')?.dataset.mockMemberMultiple,
      ).toBe('true');
      // A multiple member field starts as an empty list, a single one empty.
      expect(
        readMember(harness.container, 'watchers')?.dataset.mockMemberValue,
      ).toBe('[]');
      expect(
        readMember(harness.container, 'reviewer')?.dataset.mockMemberValue,
      ).toBe('null');

      act((): void => {
        (
          readMember(harness.container, 'reviewer')?.querySelector(
            'button',
          ) as HTMLButtonElement
        ).click();
      });
      act((): void => {
        (
          readMember(harness.container, 'watchers')?.querySelector(
            'button',
          ) as HTMLButtonElement
        ).click();
      });

      expect(harness.readValues().reviewer).toBe('m1');
      expect(harness.readValues().watchers).toEqual(['m1', 'm2']);
    } finally {
      await unmountRenderer(harness);
    }
  });

  it('hands the stored ids to a read-only picker so it can show names', async (): Promise<void> => {
    const harness = await mountRenderer({
      readonly: true,
      schema: createMemberSchema(),
      value: { reviewer: 'm1', watchers: ['m1', 'm2'] },
    });

    try {
      expect(
        readMember(harness.container, 'reviewer')?.dataset.mockMemberReadonly,
      ).toBe('true');
      expect(
        readMember(harness.container, 'watchers')?.dataset.mockMemberValue,
      ).toBe('["m1","m2"]');
    } finally {
      await unmountRenderer(harness);
    }
  });
});

interface RendererHarness {
  readonly container: HTMLElement;
  readonly readValues: () => FormRendererValues;
  readonly root: ReturnType<typeof createRoot>;
}

async function mountRenderer({
  errors,
  maxWidth,
  readonly,
  schema,
  singleColumn,
  value,
}: {
  readonly errors?: Readonly<Record<string, string>>;
  readonly maxWidth?: number;
  readonly readonly?: boolean;
  readonly schema: FormDefinitionSchema;
  readonly singleColumn?: boolean;
  readonly value?: FormRendererValues;
}): Promise<RendererHarness> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let latest: FormRendererValues = {};

  await act(async (): Promise<void> => {
    root.render(
      <FormRenderer
        errors={errors ?? {}}
        {...(typeof maxWidth === 'number' ? { maxWidth } : {})}
        onChange={(nextValues): void => {
          latest = nextValues;
        }}
        readonly={readonly ?? false}
        schema={schema}
        {...(singleColumn ? { singleColumn: true } : {})}
        uiSchema={createUiSchema()}
        {...(value ? { value } : {})}
      />,
    );
  });

  return {
    container,
    readValues: (): FormRendererValues => latest,
    root,
  };
}

async function unmountRenderer(harness: RendererHarness): Promise<void> {
  await act(async (): Promise<void> => {
    harness.root.unmount();
  });
  harness.container.remove();
}

function createTableSchema({
  maxRows,
  minRows,
}: {
  readonly maxRows?: number;
  readonly minRows?: number;
}): FormDefinitionSchema {
  return {
    fields: [
      {
        columns: [
          { fieldKey: 'name', label: '品項', required: true, type: 'text' },
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
        ...(typeof maxRows === 'number' ? { maxRows } : {}),
        ...(typeof minRows === 'number' ? { minRows } : {}),
        required: false,
        type: 'table',
      },
    ],
    schemaVersion: 1,
  };
}

function readRowCount(container: HTMLElement): number {
  return container.querySelectorAll('[data-mock-table-row]').length;
}

function readAddRowButton(container: HTMLElement): HTMLButtonElement | null {
  return container.querySelector('[data-mock-button="新增一列"]');
}

function readTableAction(
  container: HTMLElement,
  actionName: string,
  rowIndex: number,
): HTMLButtonElement | null {
  return container.querySelector(
    `[data-mock-table-row="${rowIndex}"] [data-mock-table-action="${actionName}"]`,
  );
}

function clickRendererButton(container: HTMLElement, label: string): void {
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
  const action = readTableAction(container, actionName, rowIndex);

  if (!action) {
    throw new Error(`Table action ${actionName} row ${rowIndex} is missing.`);
  }

  act((): void => {
    action.click();
  });
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

function createControlSchema(): FormDefinitionSchema {
  return {
    fields: [
      createDynamicField('select', 'select'),
      createDynamicField('autocomplete', 'autocomplete'),
      createDynamicField('radio', 'radio'),
      createDynamicField('checkbox', 'checkbox'),
    ],
    schemaVersion: 1,
  };
}

function createDynamicField(
  type: FormDataSourceOptionFieldDefinition['type'],
  fieldKey: string,
): FormDataSourceOptionFieldDefinition {
  return {
    dataSource: {
      bindings: [],
      key: 'demo.options',
      version: 1,
    },
    fieldKey,
    label: fieldKey,
    mode: type === 'select' || type === 'autocomplete' ? 'single' : undefined,
    required: false,
    type,
  } as FormDataSourceOptionFieldDefinition;
}

function readFieldWrapper(
  container: HTMLElement,
  fieldKey: string,
): HTMLElement | null {
  return container.querySelector<HTMLElement>(
    `[data-form-field-key="${fieldKey}"]`,
  );
}

function readTableWidthFloor(container: HTMLElement): HTMLElement | null {
  const table = container.querySelector<HTMLElement>('[data-mock-table]');

  return table?.parentElement ?? null;
}

function createUiSchema(): FormUiSchema {
  return {
    layout: [],
    schemaVersion: 1,
  };
}

async function waitForCondition(predicate: () => boolean): Promise<void> {
  const timeoutAt = Date.now() + 1000;

  while (!predicate()) {
    if (Date.now() > timeoutAt) {
      throw new Error('Timed out waiting for renderer state.');
    }

    await act(async (): Promise<void> => {
      await new Promise<void>((resolve): void => {
        setTimeout(resolve, 0);
      });
    });
  }
}
