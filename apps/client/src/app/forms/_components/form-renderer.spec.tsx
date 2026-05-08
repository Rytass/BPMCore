import { fireEvent, render } from '@testing-library/react';
import { FormDefinitionSchema, FormUiSchema } from '@bpm/shared/form';
import { FormRenderer } from './form-renderer';

jest.mock('@mezzanine-ui/react', () => {
  const React = require('react') as typeof import('react');

  function FormField({
    children,
    name,
  }: {
    readonly children?: React.ReactNode;
    readonly name?: string;
  }): React.ReactElement {
    return React.createElement('div', { 'data-field-name': name }, children);
  }

  function DatePicker({
    onChange,
    placeholder,
    value,
  }: {
    readonly onChange?: (value?: string) => void;
    readonly placeholder?: string;
    readonly value?: string;
  }): React.ReactElement {
    return React.createElement('input', {
      'data-component': 'DatePicker',
      onChange: (event: React.ChangeEvent<HTMLInputElement>): void =>
        onChange?.(event.target.value || undefined),
      placeholder,
      type: 'text',
      value: value ?? '',
    });
  }

  function DateTimePicker({
    onChange,
    placeholderLeft,
    placeholderRight,
    value,
  }: {
    readonly onChange?: (value?: string) => void;
    readonly placeholderLeft?: string;
    readonly placeholderRight?: string;
    readonly value?: string;
  }): React.ReactElement {
    return React.createElement('input', {
      'data-component': 'DateTimePicker',
      onChange: (event: React.ChangeEvent<HTMLInputElement>): void =>
        onChange?.(event.target.value || undefined),
      placeholder: `${placeholderLeft ?? ''} ${placeholderRight ?? ''}`.trim(),
      type: 'text',
      value: value ?? '',
    });
  }

  function Input({
    inputType,
    onChange,
    placeholder,
    value,
  }: {
    readonly inputType?: string;
    readonly onChange?: React.ChangeEventHandler<HTMLInputElement>;
    readonly placeholder?: string;
    readonly value?: string;
  }): React.ReactElement {
    return React.createElement('input', {
      onChange,
      placeholder,
      type: inputType ?? 'text',
      value,
    });
  }

  function Select(): React.ReactElement {
    return React.createElement('select');
  }

  function Textarea({
    onChange,
    placeholder,
    value,
  }: {
    readonly onChange?: React.ChangeEventHandler<HTMLTextAreaElement>;
    readonly placeholder?: string;
    readonly value?: string;
  }): React.ReactElement {
    return React.createElement('textarea', {
      onChange,
      placeholder,
      value,
    });
  }

  function Toggle(): React.ReactElement {
    return React.createElement('input', { type: 'checkbox' });
  }

  function Typography({
    children,
    component,
  }: {
    readonly children?: React.ReactNode;
    readonly component?: React.ElementType;
  }): React.ReactElement {
    return React.createElement(component ?? 'span', null, children);
  }

  function Upload(): React.ReactElement {
    return React.createElement('input', { type: 'file' });
  }

  return {
    DatePicker,
    DateTimePicker,
    FormField,
    Input,
    Select,
    Textarea,
    Toggle,
    Typography,
    Upload,
  };
});

jest.mock('@mezzanine-ui/core/form', () => ({
  FormFieldDensity: { WIDE: 'wide' },
  FormFieldLayout: { STRETCH: 'stretch' },
}));

const schema: FormDefinitionSchema = {
  fields: [
    {
      fieldKey: 'amount',
      label: '申請金額',
      required: true,
      type: 'number',
    },
    {
      fieldKey: 'reason',
      label: '申請原因',
      required: false,
      type: 'textarea',
      visibleWhen: 'form.amount > 100',
    },
  ],
  schemaVersion: 1,
};

const uiSchema: FormUiSchema = {
  layout: [
    { fieldKey: 'amount', width: 'HALF' },
    { fieldKey: 'reason', width: 'FULL' },
  ],
  schemaVersion: 1,
};

describe('FormRenderer', () => {
  it('renders visible fields and updates conditional fields when values change', (): void => {
    const { getByPlaceholderText, queryByText } = render(
      <FormRenderer schema={schema} uiSchema={uiSchema} />,
    );

    expect(queryByText('申請金額')).toBeTruthy();
    expect(queryByText('申請原因')).toBeNull();

    fireEvent.change(getByPlaceholderText('請輸入數字'), {
      target: { value: '120' },
    });

    expect(queryByText('申請原因')).toBeTruthy();
  });

  it('reports the next form values to callers', (): void => {
    const handleChange = jest.fn<void, [Readonly<Record<string, unknown>>]>();
    const { getByPlaceholderText } = render(
      <FormRenderer
        onChange={handleChange}
        schema={schema}
        uiSchema={uiSchema}
        value={{}}
      />,
    );

    fireEvent.change(getByPlaceholderText('請輸入數字'), {
      target: { value: '240' },
    });

    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 240 }),
    );
  });

  it('uses Mezzanine pickers for date and datetime fields', (): void => {
    const handleChange = jest.fn<void, [Readonly<Record<string, unknown>>]>();
    const dateSchema: FormDefinitionSchema = {
      fields: [
        {
          fieldKey: 'startDate',
          label: '開始日期',
          required: false,
          type: 'date',
        },
        {
          fieldKey: 'startAt',
          label: '開始時間',
          required: false,
          type: 'datetime',
        },
      ],
      schemaVersion: 1,
    };
    const dateUiSchema: FormUiSchema = {
      layout: [
        { fieldKey: 'startDate', width: 'FULL' },
        { fieldKey: 'startAt', width: 'FULL' },
      ],
      schemaVersion: 1,
    };
    const { getByPlaceholderText } = render(
      <FormRenderer
        onChange={handleChange}
        schema={dateSchema}
        uiSchema={dateUiSchema}
        value={{}}
      />,
    );

    const dateInput = getByPlaceholderText('請選擇日期');
    const dateTimeInput = getByPlaceholderText('選擇日期 選擇時間');

    expect(dateInput.getAttribute('data-component')).toBe('DatePicker');
    expect(dateTimeInput.getAttribute('data-component')).toBe(
      'DateTimePicker',
    );

    fireEvent.change(dateInput, {
      target: { value: '2026-05-08' },
    });
    fireEvent.change(dateTimeInput, {
      target: { value: '2026-05-07T14:30' },
    });

    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: '2026-05-08' }),
    );
    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({ startAt: '2026-05-07T14:30' }),
    );
  });
});
