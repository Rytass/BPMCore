import { lintFormSchemaJson } from './form-schema.validator';

describe('form schema validator', () => {
  it('accepts supported fields and matching layout entries', (): void => {
    const result = lintFormSchemaJson(
      JSON.stringify({
        fields: [
          {
            defaultValue: 'A-001',
            fieldKey: 'amount',
            label: 'Amount',
            maxLength: 20,
            minLength: 1,
            placeholder: 'Enter amount',
            required: true,
            type: 'text',
            visibleWhen: "form.kind == 'general'",
          },
          {
            defaultValue: 100,
            fieldKey: 'total',
            label: 'Total',
            maximum: 1000,
            minimum: 0,
            required: false,
            type: 'money',
          },
          {
            defaultValue: true,
            fieldKey: 'enabled',
            label: 'Enabled',
            required: false,
            type: 'boolean',
          },
          {
            acceptedMimeTypes: ['application/pdf'],
            defaultValue: ['attachment-id'],
            fieldKey: 'receipt',
            label: 'Receipt',
            maxFiles: 3,
            required: false,
            type: 'file_upload',
          },
          {
            fieldKey: 'kind',
            label: 'Kind',
            options: [{ label: 'General', value: 'general' }],
            required: false,
            type: 'select',
          },
        ],
        schemaVersion: 1,
      }),
      JSON.stringify({
        layout: [
          { fieldKey: 'amount', width: 'HALF' },
          { fieldKey: 'total', width: 'HALF' },
          { fieldKey: 'enabled', width: 'HALF' },
          { fieldKey: 'receipt', width: 'FULL' },
          { fieldKey: 'kind', width: 'HALF' },
        ],
        schemaVersion: 1,
      }),
    );

    expect(result).toEqual({ errors: [], valid: true });
  });

  it('rejects duplicated field keys and stale layout references', (): void => {
    const result = lintFormSchemaJson(
      JSON.stringify({
        fields: [
          {
            fieldKey: 'amount',
            label: 'Amount',
            required: true,
            type: 'text',
          },
          {
            fieldKey: 'amount',
            label: 'Amount 2',
            required: false,
            type: 'textarea',
          },
        ],
        schemaVersion: 1,
      }),
      JSON.stringify({
        layout: [{ fieldKey: 'missing', width: 'FULL' }],
        schemaVersion: 1,
      }),
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('schema.fields fieldKey is duplicated: amount');
    expect(result.errors).toContain(
      'uiSchema.layout[0].fieldKey does not match a schema field',
    );
  });

  it('rejects invalid type-specific field settings', (): void => {
    const result = lintFormSchemaJson(
      JSON.stringify({
        fields: [
          {
            defaultValue: 12,
            fieldKey: 'title',
            label: 'Title',
            maxLength: 1,
            minLength: 10,
            placeholder: 123,
            required: true,
            type: 'text',
          },
          {
            defaultValue: '100',
            fieldKey: 'amount',
            label: 'Amount',
            maximum: 1,
            minimum: 10,
            required: true,
            type: 'number',
          },
          {
            fieldKey: 'kind',
            label: 'Kind',
            options: [
              { label: 'General', value: 'general' },
              { label: 'General copy', value: 'general' },
            ],
            required: false,
            type: 'select',
          },
          {
            acceptedMimeTypes: [''],
            fieldKey: 'receipt',
            label: 'Receipt',
            maxFiles: 0,
            required: false,
            type: 'file_upload',
          },
        ],
        schemaVersion: 1,
      }),
      JSON.stringify({
        layout: [
          { fieldKey: 'title', width: 'HALF' },
          { fieldKey: 'amount', width: 'HALF' },
          { fieldKey: 'kind', width: 'HALF' },
          { fieldKey: 'receipt', width: 'FULL' },
        ],
        schemaVersion: 1,
      }),
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'schema.fields[0].minLength must be less than or equal to schema.fields[0].maxLength',
    );
    expect(result.errors).toContain('schema.fields[0].placeholder must be a string');
    expect(result.errors).toContain(
      'schema.fields[0].defaultValue has invalid type for field type',
    );
    expect(result.errors).toContain(
      'schema.fields[1].minimum must be less than or equal to schema.fields[1].maximum',
    );
    expect(result.errors).toContain(
      'schema.fields[1].defaultValue has invalid type for field type',
    );
    expect(result.errors).toContain(
      'schema.fields[2].options.value is duplicated: general',
    );
    expect(result.errors).toContain(
      'schema.fields[3].maxFiles must be an integer greater than or equal to 1',
    );
    expect(result.errors).toContain(
      'schema.fields[3].acceptedMimeTypes must be an array of non-empty strings',
    );
  });
});
