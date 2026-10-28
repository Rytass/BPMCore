import {
  compileTextFieldPattern,
  FormDefinitionSchema,
  isFormIdentifierKey,
  isFormMemberValue,
  isFormTableCellValue,
  isFormTableRowValue,
  isFormTableRowValues,
  isMemberFieldDefinition,
  isTableColumnFieldType,
  isTableFieldDefinition,
  normalizeFormDefinitionSchema,
  readFormMemberIds,
  readFormTableCellValue,
  hasRepeatedTextFieldPatternGroup,
  readTextFieldValueIssue,
  TABLE_COLUMN_FIELD_TYPES,
} from './form';

describe('form table contracts', () => {
  it('normalizes select and autocomplete columns inside a table', (): void => {
    const schema: FormDefinitionSchema = {
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
              fieldKey: 'qty',
              label: 'Quantity',
              required: true,
              type: 'number',
            },
          ],
          fieldKey: 'items',
          label: 'Items',
          required: true,
          type: 'table',
        },
      ],
      schemaVersion: 1,
    };
    const normalized = normalizeFormDefinitionSchema(schema);
    const table = normalized.fields[0];

    expect(table && isTableFieldDefinition(table)).toBe(true);
    expect(table && isTableFieldDefinition(table) ? table.columns : []).toEqual([
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
        fieldKey: 'qty',
        label: 'Quantity',
        required: true,
        type: 'number',
      },
    ]);
  });

  it('leaves a table-free schema byte-identical after normalization', (): void => {
    const schema: FormDefinitionSchema = {
      fields: [
        {
          defaultValue: 'A-001',
          fieldKey: 'code',
          label: 'Code',
          required: true,
          type: 'text',
        },
        {
          fieldKey: 'kind',
          label: 'Kind',
          mode: 'single',
          options: [{ label: 'A', value: 'a' }],
          required: false,
          type: 'select',
        },
      ],
      schemaVersion: 1,
    };

    expect(normalizeFormDefinitionSchema(schema)).toEqual(schema);
  });

  it('reports which field types a column may use', (): void => {
    expect(isTableColumnFieldType('text')).toBe(true);
    expect(isTableColumnFieldType('select')).toBe(true);
    expect(isTableColumnFieldType('textarea')).toBe(false);
    expect(isTableColumnFieldType('radio')).toBe(false);
    expect(isTableColumnFieldType('checkbox')).toBe(false);
    expect(isTableColumnFieldType('file_upload')).toBe(false);
    expect(isTableColumnFieldType('table')).toBe(false);
    expect(TABLE_COLUMN_FIELD_TYPES).not.toContain('textarea');
  });

  it('separates cell values from row values', (): void => {
    expect(isFormTableCellValue('a')).toBe(true);
    expect(isFormTableCellValue(['a', 'b'])).toBe(true);
    expect(isFormTableCellValue(null)).toBe(true);
    expect(isFormTableCellValue({ qty: 1 })).toBe(false);
    expect(isFormTableRowValue({ name: 'a', qty: 1, tags: ['x'] })).toBe(true);
    expect(isFormTableRowValue({ nested: { qty: 1 } })).toBe(false);
    expect(isFormTableRowValue(['a'])).toBe(false);
    expect(isFormTableRowValues([{ qty: 1 }, { qty: 2 }])).toBe(true);
    expect(isFormTableRowValues(['a'])).toBe(false);
    expect(isFormTableRowValues('a')).toBe(false);
  });

  it('treats an empty array as the primitive it has always been', (): void => {
    // `[]` is both an empty multi-select value and an empty table; without a
    // field definition the primitive reading is the compatible one.
    expect(isFormTableRowValues([])).toBe(true);
    expect(readFormTableCellValue([])).toEqual([]);
  });

  it('narrows table row values away from primitive read paths', (): void => {
    expect(readFormTableCellValue('a')).toBe('a');
    expect(readFormTableCellValue(42)).toBe(42);
    expect(readFormTableCellValue(null)).toBeNull();
    expect(readFormTableCellValue(undefined)).toBeUndefined();
    expect(readFormTableCellValue([{ qty: 1 }])).toBeUndefined();
  });

  it('accepts only plain identifiers as table and column keys', (): void => {
    expect(isFormIdentifierKey('items')).toBe(true);
    expect(isFormIdentifierKey('_items2')).toBe(true);
    expect(isFormIdentifierKey('2items')).toBe(false);
    expect(isFormIdentifierKey('line-items')).toBe(false);
    expect(isFormIdentifierKey('items.qty')).toBe(false);
    expect(isFormIdentifierKey('')).toBe(false);
  });
});

describe('member field contracts', () => {
  it('recognises a member field and keeps it out of table columns', () => {
    expect(
      isMemberFieldDefinition({
        fieldKey: 'reviewer',
        label: 'Reviewer',
        required: false,
        type: 'member',
      }),
    ).toBe(true);
    expect(
      isMemberFieldDefinition({
        fieldKey: 'note',
        label: 'Note',
        required: false,
        type: 'text',
      }),
    ).toBe(false);
    expect(isTableColumnFieldType('member')).toBe(false);
  });

  it('normalizes a schema holding a member field without touching it', () => {
    const schema: FormDefinitionSchema = {
      fields: [
        {
          fieldKey: 'watchers',
          label: 'Watchers',
          multiple: true,
          required: false,
          type: 'member',
        },
      ],
      schemaVersion: 1,
    };

    expect(normalizeFormDefinitionSchema(schema)).toEqual(schema);
  });

  it('accepts a non-empty string for a single field and ids for a multiple one', () => {
    expect(isFormMemberValue('m1', false)).toBe(true);
    expect(isFormMemberValue(['m1', 'm2'], true)).toBe(true);
    expect(isFormMemberValue([], true)).toBe(true);
  });

  it('rejects the wrong shape for the field mode', () => {
    expect(isFormMemberValue('', false)).toBe(false);
    expect(isFormMemberValue('  ', false)).toBe(false);
    expect(isFormMemberValue(['m1'], false)).toBe(false);
    expect(isFormMemberValue('m1', true)).toBe(false);
    expect(isFormMemberValue([''], true)).toBe(false);
    expect(isFormMemberValue(['m1', 2], true)).toBe(false);
    expect(isFormMemberValue(null, false)).toBe(false);
    expect(isFormMemberValue({ id: 'm1' }, false)).toBe(false);
  });

  it('reads member ids out of either stored shape', () => {
    expect(readFormMemberIds('m1')).toEqual(['m1']);
    expect(readFormMemberIds(['m1', '', 'm2'])).toEqual(['m1', 'm2']);
    expect(readFormMemberIds('   ')).toEqual([]);
    expect(readFormMemberIds(undefined)).toEqual([]);
    expect(readFormMemberIds(null)).toEqual([]);
    expect(readFormMemberIds(true)).toEqual([]);
    expect(readFormMemberIds([{ qty: 1 }])).toEqual([]);
  });
});

describe('hasRepeatedTextFieldPatternGroup', () => {
  it('flags a group followed by a repeating quantifier', () => {
    // Repeats inside, overlapping alternatives, optional atoms: every
    // exponential shape needs a repeated group.
    [
      '(a+)*',
      '([A-Za-z0-9]+\\s?)*',
      '(\\w|\\d)+',
      '(.|\\s)*@',
      '(a|ab)*',
      '(a?a?)+',
      '(aa?)+',
      '(ab?|b)+',
      '([0-9][0-9]?)+',
      '(?:[A-Z][A-Z]?-?)+',
      '(?<n>ab?|b)+',
      '(?:ab)*',
      '(ab){2}',
      '(ab){2,}',
      '(ab){0,3}',
      '(ab)+?',
    ].forEach((pattern) => {
      expect(hasRepeatedTextFieldPatternGroup(pattern)).toBe(true);
    });
  });

  it('accepts groups that do not repeat and repeated single atoms', () => {
    [
      '[A-Z]{2}[0-9]{8}',
      '\\d{8}|[A-Z]{2}\\d{8}',
      '(foo|bar)?',
      '(ab){1}',
      '(ab){0,1}',
      '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}',
      '\\w*\\w*\\w*!',
    ].forEach((pattern) => {
      expect(hasRepeatedTextFieldPatternGroup(pattern)).toBe(false);
    });
  });

  it('reads an escaped or bracketed parenthesis as a literal', () => {
    expect(hasRepeatedTextFieldPatternGroup('\\(a\\)+')).toBe(false);
    expect(hasRepeatedTextFieldPatternGroup('[)]+')).toBe(false);
    expect(hasRepeatedTextFieldPatternGroup('[\\])]+')).toBe(false);
    // A `)+` inside a class is two literal characters.
    expect(hasRepeatedTextFieldPatternGroup('[)+]')).toBe(false);
    expect(hasRepeatedTextFieldPatternGroup('[\\])+]')).toBe(false);
    expect(hasRepeatedTextFieldPatternGroup('[(]a)+')).toBe(true);
  });

  it('reads braced and fixed-width escapes as one atom', () => {
    // A `)` inside an escape's braces or name is not a group end, so the
    // quantifier after it does not repeat a group.
    expect(hasRepeatedTextFieldPatternGroup('\\p{L)+}')).toBe(false);
    expect(hasRepeatedTextFieldPatternGroup('\\u{4)+}')).toBe(false);
    expect(hasRepeatedTextFieldPatternGroup('(?<a>x)\\k<a)+>')).toBe(false);
    expect(hasRepeatedTextFieldPatternGroup('\\u{41}+\\x41+\\u0041+\\cA+')).toBe(
      false,
    );
  });

  it('is conservative: it also refuses repeated groups that are safe', () => {
    expect(hasRepeatedTextFieldPatternGroup('[a-z]+(-[a-z]+)*')).toBe(true);
    expect(hasRepeatedTextFieldPatternGroup('(\\d{3},)*\\d{3}')).toBe(true);
  });
});

describe('readTextFieldValueIssue', () => {
  const invoiceNumber = {
    pattern: '[A-Z]{2}[0-9]{8}',
    patternErrorMessage: '發票號碼為 2 碼英文加 8 碼數字',
  };

  it('accepts a value that matches the whole pattern', () => {
    expect(readTextFieldValueIssue(invoiceNumber, 'AB12345678')).toBeNull();
  });

  it('rejects a value that only contains a match, with the configured message', () => {
    expect(readTextFieldValueIssue(invoiceNumber, 'xAB12345678')).toEqual({
      kind: 'pattern',
      message: '發票號碼為 2 碼英文加 8 碼數字',
    });
    expect(readTextFieldValueIssue(invoiceNumber, 'AB123456789')).toEqual({
      kind: 'pattern',
      message: '發票號碼為 2 碼英文加 8 碼數字',
    });
  });

  it('falls back to no message when none is configured', () => {
    expect(
      readTextFieldValueIssue({ pattern: '[0-9]+', patternErrorMessage: '  ' }, 'abc'),
    ).toEqual({ kind: 'pattern', message: null });
  });

  it('counts characters, not UTF-16 units, against the length limits', () => {
    expect(readTextFieldValueIssue({ maxLength: 2 }, '台灣')).toBeNull();
    expect(readTextFieldValueIssue({ maxLength: 2 }, '😀😀')).toBeNull();
    expect(readTextFieldValueIssue({ maxLength: 2 }, '台灣好')).toEqual({
      kind: 'maxLength',
      limit: 2,
    });
    expect(readTextFieldValueIssue({ minLength: 3 }, '台灣')).toEqual({
      kind: 'minLength',
      limit: 3,
    });
  });

  it('checks length before format', () => {
    expect(
      readTextFieldValueIssue({ ...invoiceNumber, maxLength: 10 }, 'AB123456789'),
    ).toEqual({ kind: 'maxLength', limit: 10 });
  });

  it('leaves an empty value to the required check', () => {
    expect(readTextFieldValueIssue({ ...invoiceNumber, minLength: 10 }, '')).toBeNull();
    expect(readTextFieldValueIssue({ ...invoiceNumber, minLength: 10 }, null)).toBeNull();
    expect(readTextFieldValueIssue({ ...invoiceNumber, minLength: 10 }, undefined)).toBeNull();
  });

  it('reports a value that is not text when the field has a rule to apply', () => {
    expect(readTextFieldValueIssue(invoiceNumber, 1234567890)).toEqual({ kind: 'type' });
    expect(readTextFieldValueIssue({ maxLength: 3 }, ['ab'])).toEqual({ kind: 'type' });
    expect(readTextFieldValueIssue({ minLength: 1 }, true)).toEqual({ kind: 'type' });
    // A field without rules accepts what it accepted before.
    expect(readTextFieldValueIssue({}, 1234567890)).toBeNull();
  });

  it('runs the pattern through the given test, failing when it does not pass', () => {
    const seen: string[] = [];
    const refuse = (pattern: RegExp, text: string): boolean => {
      seen.push(`${pattern.source}:${text}`);

      return false;
    };

    expect(
      readTextFieldValueIssue(invoiceNumber, 'AB12345678', {
        testPattern: refuse,
      }),
    ).toEqual({ kind: 'pattern', message: '發票號碼為 2 碼英文加 8 碼數字' });
    expect(seen).toEqual(['^(?:[A-Z]{2}[0-9]{8})$:AB12345678']);
  });

  it('fails closed on a pattern that does not compile', () => {
    expect(compileTextFieldPattern('[')).toBeNull();
    expect(readTextFieldValueIssue({ pattern: '[' }, 'anything')).toEqual({
      kind: 'pattern',
      message: null,
    });
  });

  it('cannot be widened by an alternation in the pattern', () => {
    expect(readTextFieldValueIssue({ pattern: 'a|b' }, 'ab')).toEqual({
      kind: 'pattern',
      message: null,
    });
    expect(readTextFieldValueIssue({ pattern: 'a|b' }, 'b')).toBeNull();
  });

  // Wrapped as is, `a)|(?:b` would compile to `^(?:a)|(?:b)$` and let "ab"
  // through on the anchored `a` alone.
  it('refuses a pattern whose parentheses close the anchoring early', () => {
    expect(compileTextFieldPattern('a)|(?:b')).toBeNull();
    expect(readTextFieldValueIssue({ pattern: 'a)|(?:b' }, 'ab')).toEqual({
      kind: 'pattern',
      message: null,
    });
  });

  it('compiles a pattern once and reuses it', () => {
    const compiled = compileTextFieldPattern('[A-Z]{3}');

    expect(compiled).not.toBeNull();
    expect(compileTextFieldPattern('[A-Z]{3}')).toBe(compiled);
    expect(compileTextFieldPattern('a)|(?:b')).toBe(
      compileTextFieldPattern('a)|(?:b'),
    );
  });
});
