import { FormFieldDefinition } from '@rytass/bpm-core-shared/form';
import { readSubmittedMemberValueErrors } from './form-member-value.validator';

const SINGLE: FormFieldDefinition = {
  fieldKey: 'reviewer',
  label: '審核人',
  required: false,
  type: 'member',
};
const MULTIPLE: FormFieldDefinition = {
  fieldKey: 'watchers',
  label: '關注者',
  multiple: true,
  required: false,
  type: 'member',
};
const TEXT: FormFieldDefinition = {
  fieldKey: 'note',
  label: '備註',
  required: false,
  type: 'text',
};

describe('readSubmittedMemberValueErrors', () => {
  it('accepts a member id and an array of member ids', (): void => {
    expect(
      readSubmittedMemberValueErrors([SINGLE, MULTIPLE], {
        reviewer: 'member-1',
        watchers: ['member-1', 'member-2'],
      }),
    ).toEqual([]);
  });

  it('treats absent, null and an empty multiple list as no value', (): void => {
    expect(readSubmittedMemberValueErrors([SINGLE, MULTIPLE], {})).toEqual([]);
    expect(
      readSubmittedMemberValueErrors([SINGLE, MULTIPLE], {
        reviewer: null,
        watchers: [],
      }),
    ).toEqual([]);
  });

  it('rejects a single field holding anything but a non-empty string', (): void => {
    for (const bad of ['', '   ', ['member-1'], 7, true, { id: 'member-1' }]) {
      expect(
        readSubmittedMemberValueErrors([SINGLE], { reviewer: bad }),
      ).toEqual(['formData.reviewer must be a member id']);
    }
  });

  it('rejects a multiple field holding anything but an array of non-empty strings', (): void => {
    for (const bad of [
      'member-1',
      [''],
      ['member-1', 3],
      [{ id: 'member-1', name: 'A' }],
      { 0: 'member-1' },
    ]) {
      expect(
        readSubmittedMemberValueErrors([MULTIPLE], { watchers: bad }),
      ).toEqual(['formData.watchers must be an array of member ids']);
    }
  });

  it('reads own properties only and ignores other field types', (): void => {
    expect(
      readSubmittedMemberValueErrors([TEXT, SINGLE], { note: 12 }),
    ).toEqual([]);
    expect(
      readSubmittedMemberValueErrors(
        [{ ...SINGLE, fieldKey: 'constructor' }],
        {},
      ),
    ).toEqual([]);
  });
});
