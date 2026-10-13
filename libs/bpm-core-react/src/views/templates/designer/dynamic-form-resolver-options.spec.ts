import { FormDefinitionSchema } from '@rytass/bpm-core-shared/form';
import {
  NO_MEMBER_FIELD_HINT,
  readDynamicFormFieldChoice,
  readDynamicFormSummary,
  readMemberFieldOptions,
} from './dynamic-form-resolver-options';

const schema: FormDefinitionSchema = {
  fields: [
    { fieldKey: 'reason', label: '事由', required: true, type: 'text' },
    { fieldKey: 'owner', label: '負責人', required: true, type: 'member' },
    {
      fieldKey: 'reviewers',
      label: '審閱者',
      multiple: true,
      required: true,
      type: 'member',
    },
  ],
  schemaVersion: 1,
};
const schemaWithoutMember: FormDefinitionSchema = {
  fields: [schema.fields[0]],
  schemaVersion: 1,
};

const schemaWithRiskyMemberFields: FormDefinitionSchema = {
  fields: [
    { fieldKey: 'optional', label: '備援', required: false, type: 'member' },
    {
      fieldKey: 'hidden',
      label: '代理人',
      required: true,
      type: 'member',
      visibleWhen: 'form.owner != null',
    },
    {
      fieldKey: 'both',
      label: '共同簽核',
      required: false,
      type: 'member',
      visibleWhen: 'form.owner != null',
    },
    ...schema.fields.slice(1, 2),
  ],
  schemaVersion: 1,
};

describe('readMemberFieldOptions', () => {
  it('lists only the member fields', () => {
    expect(readMemberFieldOptions(schema)).toEqual([
      { id: 'owner', name: '負責人 (owner)' },
      { id: 'reviewers', name: '審閱者 (reviewers)' },
    ]);
  });

  it('is empty without a schema', () => {
    expect(readMemberFieldOptions(null)).toEqual([]);
  });

  it('marks optional and conditionally hidden member fields with a warning', () => {
    expect(readMemberFieldOptions(schemaWithRiskyMemberFields)).toEqual([
      {
        id: 'optional',
        name: '備援 (optional)（非必填）',
        warning: '此欄位非必填，未填寫時此關會找不到簽核人',
      },
      {
        id: 'hidden',
        name: '代理人 (hidden)（可能被條件隱藏）',
        warning: '此欄位可能被條件隱藏，隱藏時此關會找不到簽核人',
      },
      {
        id: 'both',
        name: '共同簽核 (both)（非必填）（可能被條件隱藏）',
        warning:
          '此欄位非必填，未填寫時此關會找不到簽核人；此欄位可能被條件隱藏，隱藏時此關會找不到簽核人',
      },
      { id: 'owner', name: '負責人 (owner)' },
    ]);
  });
});

describe('readDynamicFormFieldChoice', () => {
  it('selects the stored member field without a problem', () => {
    expect(readDynamicFormFieldChoice(schema, 'owner')).toEqual({
      options: readMemberFieldOptions(schema),
      problem: null,
      selected: { id: 'owner', name: '負責人 (owner)' },
    });
  });

  it('shows the warning as the hint while a risky field stays selected', () => {
    const choice = readDynamicFormFieldChoice(
      schemaWithRiskyMemberFields,
      'optional',
    );

    expect(choice.selected?.id).toBe('optional');
    expect(choice.problem).toBe('此欄位非必填，未填寫時此關會找不到簽核人');
  });

  it('asks the author to add a member field when the form has none', () => {
    expect(readDynamicFormFieldChoice(schemaWithoutMember, '')).toEqual({
      options: [],
      problem: NO_MEMBER_FIELD_HINT,
      selected: null,
    });
  });

  it('has no problem for an unpicked resolver when member fields exist', () => {
    expect(readDynamicFormFieldChoice(schema, '').problem).toBeNull();
    expect(readDynamicFormFieldChoice(schema, '').selected).toBeNull();
  });

  it('keeps a stored key that is not a member field visible with a warning', () => {
    const choice = readDynamicFormFieldChoice(schema, 'reason');

    expect(choice.selected).toEqual({
      id: 'reason',
      name: 'reason（無效欄位）',
    });
    expect(choice.options.map((option) => option.id)).toEqual([
      'owner',
      'reviewers',
      'reason',
    ]);
    expect(choice.problem).toContain('請重新選擇');
  });

  it('keeps a stored key that the form no longer has', () => {
    expect(
      readDynamicFormFieldChoice(schemaWithoutMember, 'applicant'),
    ).toMatchObject({
      selected: { id: 'applicant' },
    });
  });
});

describe('readDynamicFormSummary', () => {
  it('shows the field label', () => {
    expect(readDynamicFormSummary(schema, 'owner')).toBe('依表單欄位：負責人');
  });

  it('marks a key that names a field which is not a member field', () => {
    expect(readDynamicFormSummary(schema, 'reason')).toBe(
      '依表單欄位：事由（非人員選擇欄位）',
    );
  });

  it('falls back to the key, then to 未設定', () => {
    expect(readDynamicFormSummary(schema, 'gone')).toBe('依表單欄位：gone');
    expect(readDynamicFormSummary(null, 'owner')).toBe('依表單欄位：owner');
    expect(readDynamicFormSummary(schema, '')).toBe('依表單欄位：未設定');
  });
});
