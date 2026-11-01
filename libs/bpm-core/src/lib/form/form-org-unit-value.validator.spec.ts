import { FormFieldDefinition } from '@rytass/bpm-core-shared/form';
import { readSubmittedOrgUnitValueErrors } from './form-org-unit-value.validator';

const UNIT_ID = '3f2b8c1e-5d4a-4b7e-9c0a-1d2e3f4a5b6c';
const UNIT: FormFieldDefinition = {
  fieldKey: 'ownerUnit',
  label: '負責部門',
  required: false,
  type: 'org_unit',
};
const MEMBER: FormFieldDefinition = {
  fieldKey: 'reviewer',
  label: '審核人',
  required: false,
  type: 'member',
};

describe('readSubmittedOrgUnitValueErrors', () => {
  it('accepts an organization unit id', (): void => {
    expect(
      readSubmittedOrgUnitValueErrors([UNIT], { ownerUnit: UNIT_ID }),
    ).toEqual([]);
  });

  it('treats absent and null as no value, left to the required check', (): void => {
    expect(readSubmittedOrgUnitValueErrors([UNIT], {})).toEqual([]);
    expect(
      readSubmittedOrgUnitValueErrors([UNIT], { ownerUnit: null }),
    ).toEqual([]);
  });

  it.each([
    ['an array', [UNIT_ID]],
    ['a number', 7],
    ['a boolean', true],
    ['an object', { id: UNIT_ID }],
    ['an empty string', ''],
    ['a blank string', '   '],
    ['a string that is not a uuid', 'dept-1'],
  ])('rejects %s', (_kind, bad): void => {
    expect(
      readSubmittedOrgUnitValueErrors([UNIT], { ownerUnit: bad }),
    ).toEqual(['formData.ownerUnit must be an organization unit id']);
  });

  it('only looks at org_unit fields (反向控制)', (): void => {
    expect(
      readSubmittedOrgUnitValueErrors([MEMBER], { reviewer: ['not', 'a unit'] }),
    ).toEqual([]);
  });

  it('does not read a key off the prototype chain', (): void => {
    const field: FormFieldDefinition = { ...UNIT, fieldKey: 'constructor' };

    expect(readSubmittedOrgUnitValueErrors([field], {})).toEqual([]);
  });
});
