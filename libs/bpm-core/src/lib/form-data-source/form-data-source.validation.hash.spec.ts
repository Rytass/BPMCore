import type {
  FormDataSourceBindingSource,
  FormDataSourceOptionFieldDefinition,
} from '@rytass/bpm-core-shared/form';
import { BPM_FORM_DATA_SOURCE_ERROR_CODES } from './form-data-source.errors';
import type { BPMFormDataSourceDescriptor } from './form-data-source.types';
import {
  readBindingHash,
  readBindingValues,
  readWaitingForFieldKeys,
} from './form-data-source.validation';

/**
 * Phase 23 P5 (docs/24 §2.8). The binding hash is a stored contract: every
 * persisted snapshot carries one, and resubmit reuses a snapshot only when it
 * matches. These hex values were computed with the serialization the hash had
 * before `EXPRESSION` bindings existed (the private `hashBindings` of
 * `form-data-source-value-resolver.service.ts`); they must never change.
 */
const OPTIONAL_FILTER_DESCRIPTOR: BPMFormDataSourceDescriptor = {
  key: 'demo.cost-centers-optional-filter',
  label: 'Cost centers',
  maximumResultCount: 50,
  minimumSearchLength: 0,
  pageSize: 10,
  paginationMode: 'CURSOR',
  parameters: [
    { key: 'plant', required: true, type: 'STRING' },
    { key: 'category', required: false, type: 'STRING' },
    { key: 'active', required: false, type: 'BOOLEAN' },
    { key: 'limit', required: false, type: 'NUMBER' },
    { key: 'tags', required: false, type: 'STRING_ARRAY' },
  ],
  revalidationPolicy: 'WHEN_VALUE_OR_BINDINGS_CHANGE',
  returnsCompleteList: false,
  supportedControls: ['select'],
  supportsSearch: true,
  version: 1,
};

const PLANT_DESCRIPTOR: BPMFormDataSourceDescriptor = {
  ...OPTIONAL_FILTER_DESCRIPTOR,
  key: 'demo.cost-centers',
  parameters: [{ key: 'plant', required: true, type: 'STRING' }],
};

describe('readBindingHash golden fixture', (): void => {
  it('hashes every parameter type exactly as before', (): void => {
    expect(
      readBindingHash(OPTIONAL_FILTER_DESCRIPTOR, {
        active: true,
        category: 'CAPEX',
        limit: 3,
        plant: 'TW01',
        tags: ['a', 'b'],
      }),
    ).toBe('1b86c73768817e859c1c9931732c39d07fce32a68c82055563718f24032f3941');
  });

  it('hashes missing parameters as null, in descriptor order', (): void => {
    expect(readBindingHash(OPTIONAL_FILTER_DESCRIPTOR, { plant: 'TW01' })).toBe(
      '84ae3b14338ff900ffa4060fb37c575c9148bfd5a8fde82ab9734fb58390c0f4',
    );
  });

  it('hashes the demo.cost-centers binding as before', (): void => {
    expect(readBindingHash(PLANT_DESCRIPTOR, { plant: 'TW01' })).toBe(
      'f8e5207b0f89a973f1171690cb9267e24fa5c12347e27995a2185420a9795eb6',
    );
  });

  it('does not depend on the order values were collected in', (): void => {
    expect(
      readBindingHash(OPTIONAL_FILTER_DESCRIPTOR, {
        tags: ['a', 'b'],
        limit: 3,
        active: true,
        category: 'CAPEX',
        plant: 'TW01',
      }),
    ).toBe('1b86c73768817e859c1c9931732c39d07fce32a68c82055563718f24032f3941');
  });
});

const fieldWith = (
  from: FormDataSourceBindingSource,
): FormDataSourceOptionFieldDefinition => ({
  dataSource: {
    bindings: [{ from, parameter: 'plant' }],
    key: 'demo.cost-centers',
    version: 1,
  },
  fieldKey: 'costCenter',
  label: 'Cost center',
  required: true,
  type: 'select',
});

/** A source kind this version does not know, as a newer schema could hold. */
const UNKNOWN_SOURCE = {
  columnKey: 'plant',
  fieldKey: 'plant',
  kind: 'LOOKUP',
} as unknown as FormDataSourceBindingSource;

describe('binding sources fail closed (docs/24 §2.8)', (): void => {
  it('refuses an unknown source kind instead of reading it as ROW_FIELD', (): void => {
    // Before the exhaustive switch an unknown kind fell into the ROW_FIELD
    // branch and silently read `rowValues.plant`.
    expect(() =>
      readBindingValues(
        fieldWith(UNKNOWN_SOURCE),
        PLANT_DESCRIPTOR,
        { plant: 'TW01' },
        { plant: 'TW02' },
      ),
    ).toThrow(
      expect.objectContaining({
        code: BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_BINDING,
      }),
    );
  });

  it('refuses an unknown source kind when naming the fields to wait for', (): void => {
    expect(() =>
      readWaitingForFieldKeys(fieldWith(UNKNOWN_SOURCE), ['plant']),
    ).toThrow(
      expect.objectContaining({
        code: BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_BINDING,
      }),
    );
  });

  it('refuses an EXPRESSION binding when no evaluator was given', (): void => {
    expect(() =>
      readBindingValues(
        fieldWith({ expression: 'form.plant', kind: 'EXPRESSION' }),
        PLANT_DESCRIPTOR,
        { plant: 'TW01' },
      ),
    ).toThrow(
      expect.objectContaining({
        code: BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_BINDING,
      }),
    );
  });

  it('keeps the existing kinds as they were', (): void => {
    expect(
      readBindingValues(
        fieldWith({ fieldKey: 'plant', kind: 'FIELD' }),
        PLANT_DESCRIPTOR,
        { plant: 'TW01' },
      ),
    ).toEqual({ missingParameters: [], values: { plant: 'TW01' } });
    expect(
      readBindingValues(
        fieldWith({ columnKey: 'plant', kind: 'ROW_FIELD' }),
        PLANT_DESCRIPTOR,
        {},
      ),
    ).toEqual({ missingParameters: ['plant'], values: {} });
    expect(
      readWaitingForFieldKeys(
        fieldWith({ columnKey: 'plant', kind: 'ROW_FIELD' }),
        ['plant'],
      ),
    ).toEqual(['plant']);
    expect(() =>
      readWaitingForFieldKeys(
        fieldWith({ kind: 'CONSTANT', value: '' }),
        ['plant'],
      ),
    ).toThrow(
      expect.objectContaining({
        code: BPM_FORM_DATA_SOURCE_ERROR_CODES.INVALID_BINDING,
      }),
    );
  });
});
