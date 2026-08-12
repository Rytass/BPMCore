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
    return <button type="button">{props.children as ReactNode}</button>;
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
      <div data-mock-control={controlName}>
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
      <div data-mock-control="RadioGroup">
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
      <div data-mock-control="CheckboxGroup">
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

  return {
    AutoComplete: (props: Readonly<Record<string, unknown>>): ReactElement =>
      MockOptionControl(props, 'AutoComplete'),
    Button: MockButton,
    CheckboxGroup: MockCheckboxGroup,
    DatePicker: MockBasicControl,
    DateTimePicker: MockBasicControl,
    FormField: MockFormField,
    Input: MockBasicControl,
    RadioGroup: MockRadioGroup,
    Select: (props: Readonly<Record<string, unknown>>): ReactElement =>
      MockOptionControl(props, 'Select'),
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
});

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
