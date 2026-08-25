import {
  FormDataSourceOptionFieldDefinition,
  FormFieldOption,
  FormFieldValue,
} from '@rytass/bpm-core-shared/form';
import { FormRendererValues } from './form-rendering';

export type FormDataSourceFieldStatus =
  | 'IDLE'
  | 'WAITING_FOR_DEPENDENCIES'
  | 'LOADING'
  | 'VALID'
  | 'STALE'
  | 'INVALID'
  | 'UNAVAILABLE';

/**
 * Merges immutable option pages while preserving the first-seen order and
 * letting newer results replace labels for an existing value.
 */
export function mergeFormDataSourceOptions(
  ...optionLists: readonly (readonly FormFieldOption[])[]
): readonly FormFieldOption[] {
  const optionByValue = new Map<string, FormFieldOption>();
  const optionOrder: readonly string[] = optionLists.reduce<readonly string[]>(
    (order, options) =>
      options.reduce<readonly string[]>((currentOrder, option) => {
        if (optionByValue.has(option.value)) {
          optionByValue.set(option.value, option);

          return currentOrder;
        }

        optionByValue.set(option.value, option);

        return [...currentOrder, option.value];
      }, order),
    [],
  );

  return optionOrder.flatMap((value) => {
    const option = optionByValue.get(value);

    return option ? [option] : [];
  });
}

/**
 * Reads the selected option values carried by a field value, dropping blanks.
 * Single fields yield at most one value, multiple fields yield the whole list.
 */
export function readFormDataSourceSelectedValues(
  value: FormFieldValue | undefined,
): readonly string[] {
  return readSelectedValues(value);
}

export function readSelectedFormDataSourceOptions(
  value: FormFieldValue | undefined,
  options: readonly FormFieldOption[],
): readonly FormFieldOption[] {
  const selectedValues = readSelectedValues(value);
  const selectedValueSet = new Set(selectedValues);

  return options.filter((option) => selectedValueSet.has(option.value));
}

export function readMissingFormDataSourceOptionValues(
  value: FormFieldValue | undefined,
  options: readonly FormFieldOption[],
): readonly string[] {
  const selectedValues = readSelectedValues(value);
  const optionValues = new Set(options.map((option) => option.value));

  return selectedValues.filter((selectedValue) => !optionValues.has(selectedValue));
}

/**
 * Lists the FIELD-bound source fields that currently hold no value.
 *
 * Advisory only: the browser never receives the DataSource descriptor, so it
 * cannot tell a required parameter from an optional one. Runtime callers must
 * take `waitingForFieldKeys` from the server result instead of blocking a
 * control on this list — an optional binding left empty is not a blocker.
 */
export function readMissingFormDataSourceDependencies(
  field: FormDataSourceOptionFieldDefinition,
  values: FormRendererValues,
): readonly string[] {
  return field.dataSource.bindings.flatMap((binding) => {
    if (binding.from.kind !== 'FIELD') {
      return [];
    }

    return isPresentFormDataSourceValue(values[binding.from.fieldKey])
      ? []
      : [binding.from.fieldKey];
  });
}

export function readFormDataSourceValueSignature(
  value: FormFieldValue | undefined,
): string {
  return JSON.stringify(value ?? null);
}

function readSelectedValues(value: FormFieldValue | undefined): readonly string[] {
  if (typeof value === 'string' && value.trim()) {
    return [value];
  }

  // The element check also keeps table row records out: they are arrays too,
  // and a record has no `trim`.
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === 'string' && Boolean(item.trim()),
      )
    : [];
}

function isPresentFormDataSourceValue(
  value: FormFieldValue | undefined,
): boolean {
  if (typeof value === 'undefined' || value === null) {
    return false;
  }

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return true;
}
