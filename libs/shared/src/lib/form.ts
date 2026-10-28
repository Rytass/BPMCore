export interface FormDefinitionSchema {
  readonly fields: readonly FormFieldDefinition[];
  readonly schemaVersion: 1;
}

export type FormFieldDefinition =
  | TextFieldDefinition
  | NumberFieldDefinition
  | DateFieldDefinition
  | SelectFieldDefinition
  | AutoCompleteFieldDefinition
  | RadioFieldDefinition
  | CheckboxFieldDefinition
  | BooleanFieldDefinition
  | FileUploadFieldDefinition
  | MemberFieldDefinition
  | TableFieldDefinition;

interface BaseFormFieldDefinition<TType extends string> {
  readonly defaultValue?: FormFieldValue;
  readonly description?: string;
  readonly fieldKey: string;
  /**
   * 只存不顯示：值照存進 `form_data`，填寫、唯讀、重送畫面都不渲染；供宿主
   * 系統放技術欄位（單據編號、版本等）。不是權限邊界 — API 回傳的 `formData`
   * 仍包含這個值。條件（`visibleWhen` 等）仍可引用它；與 `visibleWhen` 同時
   * 設定時以 `hidden` 為準；不可與 `required: true` 並用，也不支援 table 欄。
   */
  readonly hidden?: boolean;
  readonly label: string;
  readonly placeholder?: string;
  readonly readonlyWhen?: string;
  readonly required: boolean;
  readonly requiredWhen?: string;
  readonly type: TType;
  readonly visibleWhen?: string;
}

/**
 * The value contract every non-table field keeps, and the only shape a table
 * cell may hold. Table rows are records of these primitives, so the "no
 * `{ value, label }` in stored form data" rule holds inside tables too.
 */
export type FormTableCellValue =
  | boolean
  | number
  | string
  | readonly string[]
  | null;

/**
 * One table row. Keys are column keys; rows carry no identity of their own —
 * array order is display order (see ADR 16 §3.2).
 */
export type FormTableRowValue = Readonly<Record<string, FormTableCellValue>>;

export type FormFieldValue = FormTableCellValue | readonly FormTableRowValue[];

export type TextFieldDefinition = BaseFormFieldDefinition<
  'text' | 'textarea'
> & {
  /**
   * 唯讀畫面以連結呈現：值仍是字串，條件與驗證不變。只有站內相對路徑或
   * `http(s)://` 網址會變成連結，其他值照純文字顯示。不支援 table 欄。
   */
  readonly displayAs?: 'link';
  /** 字數上限，以字元（code point）計。送出時前後端都會檢查。 */
  readonly maxLength?: number;
  /** 字數下限，以字元（code point）計；空值交給 `required` 判斷。 */
  readonly minLength?: number;
  /**
   * 格式：整個值必須符合的正規表示式，不用自己寫 `^`／`$`（同 HTML `pattern`），
   * 以 `u` 旗標比對。送出時前後端都會檢查，空值不檢查。
   */
  readonly pattern?: string;
  /** 不符合 `pattern` 時給填寫者看的訊息；沒填時顯示預設訊息。 */
  readonly patternErrorMessage?: string;
};

export type NumberFieldDefinition = BaseFormFieldDefinition<
  'number' | 'money'
> & {
  readonly maximum?: number;
  readonly minimum?: number;
};

export type DateFieldDefinition = BaseFormFieldDefinition<'date' | 'datetime'>;

export type FormSelectionMode = 'multiple' | 'single';

export interface FormDataSourceReference {
  readonly bindings: readonly FormDataSourceBinding[];
  readonly key: string;
  readonly version: number;
}

export type FormDataSourceBindingSource =
  | {
      readonly fieldKey: string;
      readonly kind: 'FIELD';
    }
  | {
      readonly kind: 'CONSTANT';
      readonly value: boolean | number | string | null;
    }
  | {
      readonly columnKey: string;
      readonly kind: 'ROW_FIELD';
    };

export interface FormDataSourceBinding {
  readonly from: FormDataSourceBindingSource;
  readonly parameter: string;
}

export type FormFieldOptionSource =
  | {
      readonly dataSource?: never;
      readonly options: readonly FormFieldOption[];
    }
  | {
      readonly dataSource: FormDataSourceReference;
      readonly options?: never;
    };

export type SelectFieldDefinition = BaseFormFieldDefinition<'select'> &
  FormFieldOptionSource & {
    readonly mode?: FormSelectionMode;
  };

export type AutoCompleteFieldDefinition =
  BaseFormFieldDefinition<'autocomplete'> &
    FormFieldOptionSource & {
      readonly mode?: FormSelectionMode;
    };

export type RadioFieldDefinition = BaseFormFieldDefinition<'radio'> &
  FormFieldOptionSource;

export type CheckboxFieldDefinition = BaseFormFieldDefinition<'checkbox'> &
  FormFieldOptionSource;

export type FormOptionFieldDefinition =
  | SelectFieldDefinition
  | AutoCompleteFieldDefinition
  | RadioFieldDefinition
  | CheckboxFieldDefinition;

export interface FormFieldOption {
  readonly label: string;
  readonly value: string;
}

export type FormDataSourceValueSnapshot = {
  readonly bindingHash: string;
  readonly dataSourceKey: string;
  readonly dataSourceVersion: number;
  readonly options: readonly FormFieldOption[];
  /**
   * The policy the source declared when this snapshot was written. Once the
   * source leaves the registry its descriptor is gone, so without this record
   * there is no way to tell whether reusing the snapshot would quietly skip an
   * `ALWAYS` revalidation. Optional because snapshots persisted before this
   * field existed must keep loading.
   */
  readonly revalidationPolicy?: 'ALWAYS' | 'WHEN_VALUE_OR_BINDINGS_CHANGE';
  readonly validatedAt: string;
};

export type FormDataSourceValueSnapshots = Readonly<
  Record<string, FormDataSourceValueSnapshot>
>;

export type BooleanFieldDefinition = BaseFormFieldDefinition<'boolean'>;

export type FileUploadFieldDefinition =
  BaseFormFieldDefinition<'file_upload'> & {
    readonly acceptedMimeTypes?: readonly string[];
    readonly maxFiles?: number;
  };

/**
 * 人員選擇. The stored value is a member id (`multiple` unset or `false`) or an
 * array of member ids (`multiple: true`) — ids only, never `{ id, name }`, so
 * the same value feeds a `DYNAMIC_FORM` approver resolver unchanged. Names are
 * resolved for display at render time. Not a table column type in V1.
 */
export type MemberFieldDefinition = BaseFormFieldDefinition<'member'> & {
  readonly multiple?: boolean;
};

/**
 * Field types a table column may use. `textarea`, `radio`, `checkbox`,
 * `file_upload` and nested `table` are intentionally excluded in V1
 * (ADR 16 §3.10); opening any of them later is an additive change.
 */
export type TableColumnDefinition =
  | TextFieldDefinition
  | NumberFieldDefinition
  | DateFieldDefinition
  | SelectFieldDefinition
  | AutoCompleteFieldDefinition
  | BooleanFieldDefinition;

/**
 * The column types the structural lint accepts. `text` is listed without
 * `textarea` on purpose — {@link TextFieldDefinition} covers both, and only
 * `text` is allowed inside a table cell.
 */
export const TABLE_COLUMN_FIELD_TYPES: readonly TableColumnDefinition['type'][] =
  [
    'autocomplete',
    'boolean',
    'date',
    'datetime',
    'money',
    'number',
    'select',
    'text',
  ];

/**
 * Hard ceiling on table rows, matching the 65,536 byte `formDataJson` GraphQL
 * input limit (ADR 14 §3.12). A table without `maxRows` is capped here.
 */
export const FORM_TABLE_MAX_ROWS = 100;

export type TableFieldDefinition = BaseFormFieldDefinition<'table'> & {
  readonly addRowLabel?: string;
  readonly columns: readonly TableColumnDefinition[];
  /**
   * Prefilled rows are out of scope for V1; initial rows come from `minRows`
   * multiplied by each column's own `defaultValue`.
   */
  readonly defaultValue?: never;
  readonly maxRows?: number;
  readonly minRows?: number;
};

export interface FormUiSchema {
  readonly layout: readonly FormLayoutItem[];
  readonly schemaVersion: 1;
}

export interface FormLayoutItem {
  readonly fieldKey: string;
  readonly width: 'FULL' | 'HALF' | 'THIRD';
}

export function isFormOptionFieldDefinition(
  field: FormFieldDefinition,
): field is FormOptionFieldDefinition {
  return (
    field.type === 'select' ||
    field.type === 'autocomplete' ||
    field.type === 'radio' ||
    field.type === 'checkbox'
  );
}

export function isMemberFieldDefinition(
  field: FormFieldDefinition,
): field is MemberFieldDefinition {
  return field.type === 'member';
}

/**
 * Whether `value` is a well-formed stored member value: a non-empty string
 * (`multiple` false) or an array of non-empty strings (`multiple` true). `[]`
 * is a well-formed multiple value — whether "nothing picked" is acceptable is
 * the caller's required check, not this shape guard's.
 */
export function isFormMemberValue(value: unknown, multiple: boolean): boolean {
  if (multiple) {
    return (
      Array.isArray(value) &&
      value.every((item) => typeof item === 'string' && item.trim().length > 0)
    );
  }

  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * The member ids held by a member field value, whichever shape it has. Anything
 * that is not a string or an array of strings yields no ids.
 */
export function readFormMemberIds(
  value: FormFieldValue | undefined,
): readonly string[] {
  if (typeof value === 'string') {
    return value.trim() ? [value] : [];
  }

  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === 'string' && item.trim().length > 0,
      )
    : [];
}

export type TextFieldValueIssue =
  | Readonly<{ kind: 'maxLength'; limit: number }>
  | Readonly<{ kind: 'minLength'; limit: number }>
  | Readonly<{ kind: 'pattern'; message: string | null }>
  | Readonly<{ kind: 'type' }>;

/**
 * Compiles a text field `pattern` the way the value check applies it: the whole
 * value has to match, under the `u` flag. Returns `null` for a pattern that
 * does not compile, which the schema lint rejects at publish time.
 */
export function compileTextFieldPattern(pattern: string): RegExp | null {
  try {
    return new RegExp(`^(?:${pattern})$`, 'u');
  } catch {
    return null;
  }
}

const REPEATING_QUANTIFIER = /^(?:([*+])|\{(\d+)(,(\d*))?\})\??/;

/**
 * Length of the quantifier at `index` when it lets the preceding atom repeat
 * (`*`, `+`, `{n,}`, `{n,m}` with m > 1, `{n}` with n > 1, each optionally
 * lazy), or 0. `?` and `{1}` do not repeat anything.
 */
function readRepeatingQuantifierLength(pattern: string, index: number): number {
  const match = REPEATING_QUANTIFIER.exec(pattern.slice(index));

  if (!match) {
    return 0;
  }

  const [quantifier, starOrPlus, minimum, range, maximum] = match;
  const repeats = starOrPlus
    ? true
    : range === undefined
      ? Number(minimum) > 1
      : maximum === '' || Number(maximum) > 1;

  return repeats ? quantifier.length : 0;
}

/**
 * Whether a text field `pattern` repeats a group that already repeats
 * something inside it — `(a+)*`, `([A-Za-z0-9]+\s?)*`. The engine runs the
 * pattern on whatever a filler sends, and this is the shape whose backtracking
 * grows exponentially with the length of a value that almost matches, long
 * enough to stall the server. A heuristic, so it errs both ways: it also flags
 * some patterns that are safe, such as `[a-z]+(-[a-z]+)*`, and it does not
 * catch a repeated alternation whose branches overlap, such as `(a|ab)*`.
 */
export function hasNestedTextFieldPatternQuantifier(pattern: string): boolean {
  // `groups` holds, per open group, whether anything inside it repeats; the
  // first entry is the pattern itself.
  const scan = (
    index: number,
    groups: readonly boolean[],
    inClass: boolean,
  ): boolean => {
    if (index >= pattern.length) {
      return false;
    }

    const char = pattern[index];
    const markRepeating = (current: readonly boolean[]): readonly boolean[] => [
      ...current.slice(0, -1),
      true,
    ];

    if (char === '\\') {
      return scan(index + 2, groups, inClass);
    }

    if (inClass) {
      return scan(index + 1, groups, char !== ']');
    }

    if (char === '[') {
      return scan(index + 1, groups, true);
    }

    if (char === '(') {
      return scan(index + 1, [...groups, false], false);
    }

    if (char === ')') {
      const innerRepeats = groups[groups.length - 1] ?? false;
      const outer = groups.length > 1 ? groups.slice(0, -1) : [false];
      const quantifierLength = readRepeatingQuantifierLength(pattern, index + 1);

      if (quantifierLength > 0 && innerRepeats) {
        return true;
      }

      return scan(
        index + 1 + quantifierLength,
        quantifierLength > 0 || innerRepeats ? markRepeating(outer) : outer,
        false,
      );
    }

    const quantifierLength = readRepeatingQuantifierLength(pattern, index);

    return quantifierLength > 0
      ? scan(index + quantifierLength, markRepeating(groups), false)
      : scan(index + 1, groups, false);
  };

  return scan(0, [false], false);
}

/**
 * The first rule a filled-in text value breaks — length first, then format —
 * or `null` when it passes. The one check the form renderer and the engine
 * both run, so a value the filler is allowed to send is one the server takes.
 * An empty value is left to the required check. Any other value that is not a
 * string is a `type` issue when the field sets a length or a format, since
 * none of those rules can be applied to it; a field without rules keeps
 * accepting what it accepted before. A pattern that does not compile fails
 * closed: the lint keeps one from being published, and silently accepting
 * every value would be worse.
 */
export function readTextFieldValueIssue(
  field: Pick<
    TextFieldDefinition,
    'maxLength' | 'minLength' | 'pattern' | 'patternErrorMessage'
  >,
  value: unknown,
): TextFieldValueIssue | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    return typeof field.minLength === 'number' ||
      typeof field.maxLength === 'number' ||
      Boolean(field.pattern)
      ? { kind: 'type' }
      : null;
  }

  const length = Array.from(value).length;

  if (typeof field.minLength === 'number' && length < field.minLength) {
    return { kind: 'minLength', limit: field.minLength };
  }

  if (typeof field.maxLength === 'number' && length > field.maxLength) {
    return { kind: 'maxLength', limit: field.maxLength };
  }

  if (
    typeof field.pattern === 'string' &&
    field.pattern !== '' &&
    !compileTextFieldPattern(field.pattern)?.test(value)
  ) {
    return {
      kind: 'pattern',
      message: field.patternErrorMessage?.trim() || null,
    };
  }

  return null;
}

export function isTableFieldDefinition(
  field: FormFieldDefinition,
): field is TableFieldDefinition {
  return field.type === 'table';
}

export function isTableColumnFieldType(
  type: FormFieldDefinition['type'],
): type is TableColumnDefinition['type'] {
  return TABLE_COLUMN_FIELD_TYPES.includes(
    type as TableColumnDefinition['type'],
  );
}

export function isFormTableCellValue(
  value: unknown,
): value is FormTableCellValue {
  return (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string' ||
    (Array.isArray(value) && value.every((item) => typeof item === 'string'))
  );
}

export function isFormTableRowValue(
  value: unknown,
): value is FormTableRowValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(isFormTableCellValue)
  );
}

/**
 * Note the inherent ambiguity of `[]`: an empty array satisfies both this
 * guard and the multi-select cell shape (`readonly string[]`). Callers that
 * hold the field definition should decide by `type === 'table'`; callers that
 * do not should treat `[]` as the primitive it has always been, which is what
 * {@link readFormTableCellValue} does.
 */
export function isFormTableRowValues(
  value: unknown,
): value is readonly FormTableRowValue[] {
  return Array.isArray(value) && value.every(isFormTableRowValue);
}

/**
 * Narrows a field value to the primitive contract the flat-field code paths
 * have always assumed, returning `undefined` for table row arrays. Use it
 * where "a table value does not apply here" is the correct answer.
 */
export function readFormTableCellValue(
  value: FormFieldValue | undefined,
): FormTableCellValue | undefined {
  return isFormTableCellValue(value) ? value : undefined;
}

/**
 * The identifier shape a table field key and every column key must take so
 * that `<tableKey>[<i>].<columnKey>` paths stay parseable (ADR 16 §3.3). It is
 * the same rule {@link readFormFieldReference} uses to decide between dot and
 * bracket access.
 */
export function isFormIdentifierKey(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/u.test(value);
}

export function isFormDataSourceFieldDefinition(
  field: FormFieldDefinition,
): field is FormDataSourceOptionFieldDefinition {
  return (
    isFormOptionFieldDefinition(field) &&
    'dataSource' in field &&
    typeof field.dataSource !== 'undefined'
  );
}

export function isFormStaticOptionFieldDefinition(
  field: FormFieldDefinition,
): field is FormStaticOptionFieldDefinition {
  return (
    isFormOptionFieldDefinition(field) &&
    'options' in field &&
    Array.isArray(field.options)
  );
}

export function readFormFieldSelectionMode(
  field: FormOptionFieldDefinition,
): FormSelectionMode {
  if (field.type === 'checkbox') {
    return 'multiple';
  }

  if (field.type === 'radio') {
    return 'single';
  }

  return field.mode ?? 'single';
}

export function normalizeFormDefinitionSchema(
  schema: FormDefinitionSchema,
): FormDefinitionSchema {
  return {
    ...schema,
    fields: schema.fields.map(normalizeFormFieldDefinition),
  };
}

export type FormDataSourceOptionFieldDefinition =
  | (SelectFieldDefinition & { readonly dataSource: FormDataSourceReference })
  | (AutoCompleteFieldDefinition & {
      readonly dataSource: FormDataSourceReference;
    })
  | (RadioFieldDefinition & { readonly dataSource: FormDataSourceReference })
  | (CheckboxFieldDefinition & {
      readonly dataSource: FormDataSourceReference;
    });

export type FormStaticOptionFieldDefinition =
  | (SelectFieldDefinition & { readonly options: readonly FormFieldOption[] })
  | (AutoCompleteFieldDefinition & {
      readonly options: readonly FormFieldOption[];
    })
  | (RadioFieldDefinition & { readonly options: readonly FormFieldOption[] })
  | (CheckboxFieldDefinition & {
      readonly options: readonly FormFieldOption[];
    });

function normalizeFormFieldDefinition(
  field: FormFieldDefinition,
): FormFieldDefinition {
  if (field.type === 'table') {
    return {
      ...field,
      columns: field.columns.map(normalizeTableColumnDefinition),
    };
  }

  if (field.type === 'select' || field.type === 'autocomplete') {
    return {
      ...field,
      mode: field.mode ?? 'single',
    };
  }

  return field;
}

function normalizeTableColumnDefinition(
  column: TableColumnDefinition,
): TableColumnDefinition {
  if (column.type === 'select' || column.type === 'autocomplete') {
    return {
      ...column,
      mode: column.mode ?? 'single',
    };
  }

  return column;
}
