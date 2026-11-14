import type {
  FormDataSourceResolveResultRecord,
  PreviewResolveFormFieldOptionsInput,
} from '@rytass/bpm-core-client/form';
import {
  FormDefinitionSchema,
  FormFieldValue,
  FormOptionFieldDefinition,
  FormUiSchema,
  isFormOptionFieldDefinition,
} from '@rytass/bpm-core-shared/form';

export type PublishDefaultValueNoticeStatus = 'UNRESOLVED' | 'CHECK_FAILED';

interface PublishDefaultValueTarget {
  readonly field: FormOptionFieldDefinition;
  readonly values: readonly string[];
}

export interface PublishDefaultValueNotice {
  readonly fieldKey: string;
  readonly label: string;
  readonly status: PublishDefaultValueNoticeStatus;
  /** The default values the source no longer offers (empty on CHECK_FAILED). */
  readonly values: readonly string[];
}

export type PreviewResolveFormFieldOptions = (
  input: PreviewResolveFormFieldOptionsInput,
) => Promise<FormDataSourceResolveResultRecord>;

function isStringList(value: FormFieldValue): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * Reads a saved option default as the strings the data source is asked about.
 * An empty string is "no value", not a value the source should be asked for.
 */
export function readDefaultValueStrings(
  value: FormFieldValue | undefined,
): readonly string[] {
  if (typeof value === 'string') {
    return value === '' ? [] : [value];
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)];
  }

  if (value !== undefined && isStringList(value)) {
    return value.filter((item) => item !== '');
  }

  return [];
}

/**
 * Checks, without blocking, that each top-level dynamic option field's default
 * is still offered by its data source (ADR 27 §8). Only fields with no
 * dependency binding are checked: a dependent field may not carry a default at
 * all (the form validator rejects it), and its options cannot be known before
 * a respondent fills the other fields in.
 *
 * Never throws. A failed lookup comes back as a `CHECK_FAILED` notice so the
 * publish that already succeeded is not reported as a failure.
 */
export async function readPublishDefaultValueNotices(input: {
  readonly preview: PreviewResolveFormFieldOptions;
  readonly schema: FormDefinitionSchema;
  readonly uiSchema: FormUiSchema;
}): Promise<readonly PublishDefaultValueNotice[]> {
  const targets = input.schema.fields.flatMap(
    (field): readonly PublishDefaultValueTarget[] => {
      if (!isFormOptionFieldDefinition(field) || field.dataSource === undefined) {
        return [];
      }

      const hasDependency = field.dataSource.bindings.some(
        (binding): boolean => binding.from.kind !== 'CONSTANT',
      );
      const values = readDefaultValueStrings(field.defaultValue);

      return hasDependency || values.length === 0 ? [] : [{ field, values }];
    },
  );

  const notices = await Promise.all(
    targets.map(
      async ({ field, values }): Promise<readonly PublishDefaultValueNotice[]> => {
        try {
          const result = await input.preview({
            fieldKey: field.fieldKey,
            schema: input.schema,
            uiSchema: input.uiSchema,
            values,
          });
          const unresolved = values.filter((value): boolean =>
            result.unresolvedValues.includes(value),
          );

          return unresolved.length > 0
            ? [
                {
                  fieldKey: field.fieldKey,
                  label: field.label,
                  status: 'UNRESOLVED',
                  values: unresolved,
                },
              ]
            : [];
        } catch {
          return [
            {
              fieldKey: field.fieldKey,
              label: field.label,
              status: 'CHECK_FAILED',
              values: [],
            },
          ];
        }
      },
    ),
  );

  return notices.flat();
}

/**
 * One line for the designer. The publish has already succeeded when this shows,
 * so the text tells the author what to fix in the form, not that publish failed.
 */
export function readPublishDefaultValueNoticeMessage(
  notice: PublishDefaultValueNotice,
): string {
  return notice.status === 'UNRESOLVED'
    ? `欄位「${notice.label}」的預設值「${notice.values.join('、')}」已不在目前的選項來源中，使用者送出前需要重新選擇；建議移除或改用其他預設值。`
    : `欄位「${notice.label}」的預設值未能檢查（選項來源查詢失敗），發佈已完成，但尚未確認此預設值是否仍有效。`;
}
