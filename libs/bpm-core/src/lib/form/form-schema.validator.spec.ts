import {
  lintFormSchemaJson,
  parseAndValidateFormSchemas,
} from './form-schema.validator';

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

  it('normalizes legacy option fields and preserves static multiple values', (): void => {
    const parsed = parseAndValidateFormSchemas(
      JSON.stringify({
        fields: [
          {
            fieldKey: 'category',
            label: 'Category',
            options: [{ label: 'A', value: 'a' }],
            required: false,
            type: 'select',
          },
          {
            defaultValue: ['a'],
            fieldKey: 'tags',
            label: 'Tags',
            mode: 'multiple',
            options: [{ label: 'A', value: 'a' }],
            required: false,
            type: 'select',
          },
          {
            defaultValue: ['a'],
            fieldKey: 'flags',
            label: 'Flags',
            options: [{ label: 'A', value: 'a' }],
            required: false,
            type: 'checkbox',
          },
          {
            fieldKey: 'search',
            label: 'Search',
            mode: 'multiple',
            options: [{ label: 'A', value: 'a' }],
            required: false,
            type: 'autocomplete',
          },
        ],
        schemaVersion: 1,
      }),
      JSON.stringify({ layout: [], schemaVersion: 1 }),
    );

    expect(parsed.schema.fields[0]).toMatchObject({ mode: 'single' });
    expect(parsed.schema.fields[1]).toMatchObject({
      defaultValue: ['a'],
      mode: 'multiple',
    });
    expect(parsed.schema.fields[2]).not.toHaveProperty('mode');
    expect(parsed.schema.fields[3]).toMatchObject({ mode: 'multiple' });
  });

  it('requires exactly one option source and rejects dynamic defaults', (): void => {
    const result = lintFormSchemaJson(
      JSON.stringify({
        fields: [
          {
            dataSource: {
              bindings: [],
              key: 'cost-centers',
              version: 1,
            },
            fieldKey: 'both',
            label: 'Both',
            options: [{ label: 'A', value: 'a' }],
            required: false,
            type: 'select',
          },
          {
            fieldKey: 'neither',
            label: 'Neither',
            required: false,
            type: 'select',
          },
          {
            dataSource: {
              bindings: [],
              key: 'vendors',
              version: 1,
            },
            defaultValue: 'vendor-1',
            fieldKey: 'dynamic',
            label: 'Dynamic',
            required: false,
            type: 'autocomplete',
          },
        ],
        schemaVersion: 1,
      }),
      JSON.stringify({ layout: [], schemaVersion: 1 }),
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'schema.fields[0] must contain exactly one of options or dataSource',
    );
    expect(result.errors).toContain(
      'schema.fields[1] must contain exactly one of options or dataSource',
    );
    expect(result.errors).toContain(
      'schema.fields[2].defaultValue is not supported for dynamic data sources',
    );
  });

  it('validates direct bindings, duplicate parameters, and dependency cycles', (): void => {
    const result = lintFormSchemaJson(
      JSON.stringify({
        fields: [
          {
            dataSource: {
              bindings: [
                {
                  from: { fieldKey: 'missing', kind: 'FIELD' },
                  parameter: 'companyId',
                },
                {
                  from: { kind: 'CONSTANT', value: 'active' },
                  parameter: 'companyId',
                },
              ],
              key: 'vendors',
              version: 1,
            },
            fieldKey: 'vendor',
            label: 'Vendor',
            required: false,
            type: 'select',
          },
          {
            dataSource: {
              bindings: [
                {
                  from: { fieldKey: 'cycle-b', kind: 'FIELD' },
                  parameter: 'dependency',
                },
              ],
              key: 'cycle-a-source',
              version: 1,
            },
            fieldKey: 'cycle-a',
            label: 'Cycle A',
            required: false,
            type: 'select',
          },
          {
            dataSource: {
              bindings: [
                {
                  from: { fieldKey: 'cycle-a', kind: 'FIELD' },
                  parameter: 'dependency',
                },
              ],
              key: 'cycle-b-source',
              version: 1,
            },
            fieldKey: 'cycle-b',
            label: 'Cycle B',
            required: false,
            type: 'select',
          },
        ],
        schemaVersion: 1,
      }),
      JSON.stringify({ layout: [], schemaVersion: 1 }),
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'schema.fields[0].dataSource.bindings[0].from.fieldKey does not match a schema field',
    );
    expect(result.errors).toContain(
      'schema.fields[0].dataSource.bindings.parameter is duplicated: companyId',
    );
    expect(result.errors).toContain(
      'schema.fields dependency cycle: cycle-a -> cycle-b -> cycle-a',
    );
  });

  it('rejects malformed source versions and fixed-mode overrides', (): void => {
    const result = lintFormSchemaJson(
      JSON.stringify({
        fields: [
          {
            dataSource: { bindings: [], key: 'radio-source', version: 0 },
            fieldKey: 'radio',
            label: 'Radio',
            mode: 'multiple',
            required: false,
            type: 'radio',
          },
        ],
        schemaVersion: 1,
      }),
      JSON.stringify({ layout: [], schemaVersion: 1 }),
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'schema.fields[0].dataSource.version must be an integer greater than or equal to 1',
    );
    expect(result.errors).toContain(
      'schema.fields[0].mode is not supported for radio; mode is fixed',
    );
  });

  it('keeps a table-free schema linting exactly as before', (): void => {
    const legacySchemaJson = JSON.stringify({
      fields: [
        {
          defaultValue: 'A-001',
          fieldKey: 'code',
          label: 'Code',
          maxLength: 20,
          required: true,
          type: 'text',
          visibleWhen: "form.kind == 'general'",
        },
        {
          dataSource: {
            bindings: [
              { from: { fieldKey: 'code', kind: 'FIELD' }, parameter: 'code' },
              { from: { kind: 'CONSTANT', value: 'active' }, parameter: 'state' },
            ],
            key: 'vendors',
            version: 1,
          },
          fieldKey: 'vendor',
          label: 'Vendor',
          required: false,
          type: 'select',
        },
      ],
      schemaVersion: 1,
    });
    const uiSchemaJson = JSON.stringify({
      layout: [
        { fieldKey: 'code', width: 'HALF' },
        { fieldKey: 'vendor', width: 'THIRD' },
      ],
      schemaVersion: 1,
    });

    expect(lintFormSchemaJson(legacySchemaJson, uiSchemaJson)).toEqual({
      errors: [],
      valid: true,
    });
    expect(
      parseAndValidateFormSchemas(legacySchemaJson, uiSchemaJson).schema,
    ).toEqual({
      fields: [
        {
          defaultValue: 'A-001',
          fieldKey: 'code',
          label: 'Code',
          maxLength: 20,
          required: true,
          type: 'text',
          visibleWhen: "form.kind == 'general'",
        },
        {
          dataSource: {
            bindings: [
              { from: { fieldKey: 'code', kind: 'FIELD' }, parameter: 'code' },
              { from: { kind: 'CONSTANT', value: 'active' }, parameter: 'state' },
            ],
            key: 'vendors',
            version: 1,
          },
          fieldKey: 'vendor',
          label: 'Vendor',
          mode: 'single',
          required: false,
          type: 'select',
        },
      ],
      schemaVersion: 1,
    });
  });

  describe('table fields', () => {
    it('accepts a table with supported columns, row bounds, and row-scoped bindings', (): void => {
      const result = lintFormSchemaJson(
        JSON.stringify({
          fields: [
            {
              fieldKey: 'plant',
              label: 'Plant',
              options: [{ label: 'Plant A', value: 'a' }],
              required: true,
              type: 'select',
            },
            {
              addRowLabel: '新增明細',
              columns: [
                {
                  fieldKey: 'name',
                  label: 'Name',
                  maxLength: 40,
                  required: true,
                  type: 'text',
                },
                {
                  fieldKey: 'qty',
                  label: 'Quantity',
                  minimum: 1,
                  required: true,
                  type: 'number',
                },
                {
                  dataSource: {
                    bindings: [
                      {
                        from: { columnKey: 'name', kind: 'ROW_FIELD' },
                        parameter: 'name',
                      },
                      {
                        from: { fieldKey: 'plant', kind: 'FIELD' },
                        parameter: 'plant',
                      },
                    ],
                    key: 'cost-centers',
                    version: 1,
                  },
                  fieldKey: 'costCenter',
                  label: 'Cost Center',
                  required: false,
                  type: 'select',
                },
              ],
              fieldKey: 'items',
              label: 'Items',
              maxRows: 100,
              minRows: 1,
              required: true,
              type: 'table',
            },
          ],
          schemaVersion: 1,
        }),
        JSON.stringify({
          layout: [
            { fieldKey: 'plant', width: 'HALF' },
            { fieldKey: 'items', width: 'FULL' },
          ],
          schemaVersion: 1,
        }),
      );

      expect(result).toEqual({ errors: [], valid: true });
    });

    it('normalizes select and autocomplete columns to a default mode', (): void => {
      const parsed = parseAndValidateFormSchemas(
        JSON.stringify({
          fields: [
            {
              columns: [
                {
                  fieldKey: 'kind',
                  label: 'Kind',
                  options: [{ label: 'A', value: 'a' }],
                  required: false,
                  type: 'select',
                },
                {
                  fieldKey: 'vendor',
                  label: 'Vendor',
                  mode: 'multiple',
                  options: [{ label: 'A', value: 'a' }],
                  required: false,
                  type: 'autocomplete',
                },
                {
                  fieldKey: 'note',
                  label: 'Note',
                  required: false,
                  type: 'text',
                },
              ],
              fieldKey: 'items',
              label: 'Items',
              required: false,
              type: 'table',
            },
          ],
          schemaVersion: 1,
        }),
        JSON.stringify({
          layout: [{ fieldKey: 'items', width: 'FULL' }],
          schemaVersion: 1,
        }),
      );
      const table = parsed.schema.fields[0];

      expect(table.type).toBe('table');
      expect(table.type === 'table' ? table.columns : []).toEqual([
        {
          fieldKey: 'kind',
          label: 'Kind',
          mode: 'single',
          options: [{ label: 'A', value: 'a' }],
          required: false,
          type: 'select',
        },
        {
          fieldKey: 'vendor',
          label: 'Vendor',
          mode: 'multiple',
          options: [{ label: 'A', value: 'a' }],
          required: false,
          type: 'autocomplete',
        },
        {
          fieldKey: 'note',
          label: 'Note',
          required: false,
          type: 'text',
        },
      ]);
    });

    it('rejects empty, unsupported, nested, and duplicated columns', (): void => {
      const result = lintFormSchemaJson(
        JSON.stringify({
          fields: [
            {
              columns: [],
              fieldKey: 'empty',
              label: 'Empty',
              required: false,
              type: 'table',
            },
            {
              columns: [
                {
                  fieldKey: 'memo',
                  label: 'Memo',
                  required: false,
                  type: 'textarea',
                },
                {
                  fieldKey: 'receipt',
                  label: 'Receipt',
                  required: false,
                  type: 'file_upload',
                },
                {
                  columns: [],
                  fieldKey: 'nested',
                  label: 'Nested',
                  required: false,
                  type: 'table',
                },
                {
                  fieldKey: 'memo',
                  label: 'Memo again',
                  required: false,
                  type: 'text',
                },
              ],
              fieldKey: 'items',
              label: 'Items',
              required: false,
              type: 'table',
            },
          ],
          schemaVersion: 1,
        }),
        JSON.stringify({
          layout: [
            { fieldKey: 'empty', width: 'FULL' },
            { fieldKey: 'items', width: 'FULL' },
          ],
          schemaVersion: 1,
        }),
      );

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'schema.fields[0].columns must contain at least one column',
      );
      expect(result.errors).toContain(
        'schema.fields[1].columns[0].type is not supported for a table column',
      );
      expect(result.errors).toContain(
        'schema.fields[1].columns[1].type is not supported for a table column',
      );
      expect(result.errors).toContain(
        'schema.fields[1].columns[2].type must not be a nested table',
      );
      expect(result.errors).toContain(
        'schema.fields[1].columns fieldKey is duplicated: memo',
      );
    });

    it('rejects keys that are not plain identifiers', (): void => {
      const result = lintFormSchemaJson(
        JSON.stringify({
          fields: [
            {
              columns: [
                {
                  fieldKey: 'unit price',
                  label: 'Unit Price',
                  required: false,
                  type: 'number',
                },
              ],
              fieldKey: 'line-items',
              label: 'Items',
              required: false,
              type: 'table',
            },
          ],
          schemaVersion: 1,
        }),
        JSON.stringify({
          layout: [{ fieldKey: 'line-items', width: 'FULL' }],
          schemaVersion: 1,
        }),
      );

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'schema.fields[0].fieldKey must match /^[A-Za-z_][A-Za-z0-9_]*$/',
      );
      expect(result.errors).toContain(
        'schema.fields[0].columns[0].fieldKey must match /^[A-Za-z_][A-Za-z0-9_]*$/',
      );
    });

    it('rejects row bounds outside the supported range', (): void => {
      const result = lintFormSchemaJson(
        JSON.stringify({
          fields: [
            {
              columns: [
                { fieldKey: 'a', label: 'A', required: false, type: 'text' },
              ],
              fieldKey: 'wide',
              label: 'Wide',
              maxRows: 101,
              minRows: -1,
              required: false,
              type: 'table',
            },
            {
              columns: [
                { fieldKey: 'a', label: 'A', required: false, type: 'text' },
              ],
              fieldKey: 'inverted',
              label: 'Inverted',
              maxRows: 2,
              minRows: 5,
              required: false,
              type: 'table',
            },
          ],
          schemaVersion: 1,
        }),
        JSON.stringify({
          layout: [
            { fieldKey: 'wide', width: 'FULL' },
            { fieldKey: 'inverted', width: 'FULL' },
          ],
          schemaVersion: 1,
        }),
      );

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'schema.fields[0].minRows must be an integer greater than or equal to 0',
      );
      expect(result.errors).toContain(
        'schema.fields[0].maxRows must be less than or equal to 100',
      );
      expect(result.errors).toContain(
        'schema.fields[1].minRows must be less than or equal to schema.fields[1].maxRows',
      );
    });

    it('rejects table defaults and row-scoped conditions', (): void => {
      const result = lintFormSchemaJson(
        JSON.stringify({
          fields: [
            {
              columns: [
                {
                  fieldKey: 'qty',
                  label: 'Quantity',
                  readonlyWhen: 'form.qty > 1',
                  required: false,
                  requiredWhen: 'form.qty > 1',
                  type: 'number',
                  visibleWhen: 'form.qty > 1',
                },
              ],
              defaultValue: null,
              fieldKey: 'items',
              label: 'Items',
              required: false,
              type: 'table',
            },
          ],
          schemaVersion: 1,
        }),
        JSON.stringify({
          layout: [{ fieldKey: 'items', width: 'FULL' }],
          schemaVersion: 1,
        }),
      );

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'schema.fields[0].defaultValue is not supported for table fields',
      );
      expect(result.errors).toContain(
        'schema.fields[0].columns[0].visibleWhen is not supported for table columns',
      );
      expect(result.errors).toContain(
        'schema.fields[0].columns[0].requiredWhen is not supported for table columns',
      );
      expect(result.errors).toContain(
        'schema.fields[0].columns[0].readonlyWhen is not supported for table columns',
      );
    });

    it('rejects misplaced and unresolvable binding sources', (): void => {
      const result = lintFormSchemaJson(
        JSON.stringify({
          fields: [
            {
              dataSource: {
                bindings: [
                  {
                    from: { columnKey: 'qty', kind: 'ROW_FIELD' },
                    parameter: 'qty',
                  },
                ],
                key: 'vendors',
                version: 1,
              },
              fieldKey: 'vendor',
              label: 'Vendor',
              required: false,
              type: 'select',
            },
            {
              dataSource: {
                bindings: [
                  {
                    from: { fieldKey: 'items', kind: 'FIELD' },
                    parameter: 'items',
                  },
                ],
                key: 'plants',
                version: 1,
              },
              fieldKey: 'plant',
              label: 'Plant',
              required: false,
              type: 'select',
            },
            {
              columns: [
                {
                  dataSource: {
                    bindings: [
                      {
                        from: { columnKey: 'missing', kind: 'ROW_FIELD' },
                        parameter: 'missing',
                      },
                    ],
                    key: 'cost-centers',
                    version: 1,
                  },
                  fieldKey: 'costCenter',
                  label: 'Cost Center',
                  required: false,
                  type: 'select',
                },
              ],
              fieldKey: 'items',
              label: 'Items',
              required: false,
              type: 'table',
            },
          ],
          schemaVersion: 1,
        }),
        JSON.stringify({
          layout: [
            { fieldKey: 'vendor', width: 'HALF' },
            { fieldKey: 'plant', width: 'HALF' },
            { fieldKey: 'items', width: 'FULL' },
          ],
          schemaVersion: 1,
        }),
      );

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'schema.fields[0].dataSource.bindings[0].from.kind ROW_FIELD is only supported inside a table column',
      );
      expect(result.errors).toContain(
        'schema.fields[1].dataSource.bindings[0].from.fieldKey must not reference a table field',
      );
      expect(result.errors).toContain(
        'schema.fields[2].columns[0].dataSource.bindings[0].from.columnKey does not match a table column',
      );
    });

    it('rejects row-scoped dependency cycles', (): void => {
      const result = lintFormSchemaJson(
        JSON.stringify({
          fields: [
            {
              columns: [
                {
                  dataSource: {
                    bindings: [
                      {
                        from: { columnKey: 'b', kind: 'ROW_FIELD' },
                        parameter: 'dependency',
                      },
                    ],
                    key: 'a-source',
                    version: 1,
                  },
                  fieldKey: 'a',
                  label: 'A',
                  required: false,
                  type: 'select',
                },
                {
                  dataSource: {
                    bindings: [
                      {
                        from: { columnKey: 'a', kind: 'ROW_FIELD' },
                        parameter: 'dependency',
                      },
                    ],
                    key: 'b-source',
                    version: 1,
                  },
                  fieldKey: 'b',
                  label: 'B',
                  required: false,
                  type: 'select',
                },
              ],
              fieldKey: 'items',
              label: 'Items',
              required: false,
              type: 'table',
            },
          ],
          schemaVersion: 1,
        }),
        JSON.stringify({
          layout: [{ fieldKey: 'items', width: 'FULL' }],
          schemaVersion: 1,
        }),
      );

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'schema.fields dependency cycle: items.a -> items.b -> items.a',
      );
    });

    it('rejects conditions that reach into table internals', (): void => {
      const result = lintFormSchemaJson(
        JSON.stringify({
          fields: [
            {
              columns: [
                { fieldKey: 'qty', label: 'Qty', required: false, type: 'number' },
              ],
              fieldKey: 'items',
              label: 'Items',
              required: false,
              type: 'table',
            },
            {
              fieldKey: 'note',
              label: 'Note',
              required: false,
              type: 'text',
              visibleWhen: 'form.items[0].qty > 1',
            },
            {
              fieldKey: 'summary',
              label: 'Summary',
              required: false,
              type: 'text',
              visibleWhen: 'size(form.items) > 0',
            },
          ],
          schemaVersion: 1,
        }),
        JSON.stringify({
          layout: [
            { fieldKey: 'items', width: 'FULL' },
            { fieldKey: 'note', width: 'HALF' },
            { fieldKey: 'summary', width: 'HALF' },
          ],
          schemaVersion: 1,
        }),
      );

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual([
        'schema.fields[1].visibleWhen must not reference table field internals: items',
      ]);
    });

    it('rejects a table laid out at less than full width', (): void => {
      const result = lintFormSchemaJson(
        JSON.stringify({
          fields: [
            {
              columns: [
                { fieldKey: 'qty', label: 'Qty', required: false, type: 'number' },
              ],
              fieldKey: 'items',
              label: 'Items',
              required: false,
              type: 'table',
            },
          ],
          schemaVersion: 1,
        }),
        JSON.stringify({
          layout: [{ fieldKey: 'items', width: 'HALF' }],
          schemaVersion: 1,
        }),
      );

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual([
        'uiSchema.layout[0].width must be FULL for table fields',
      ]);
    });
  });
});
