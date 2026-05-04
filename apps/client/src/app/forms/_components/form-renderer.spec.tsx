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
});
