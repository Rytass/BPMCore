import { FormDefinitionSchema } from '@rytass/bpm-core-shared/form';
import {
  NO_MEMBER_FIELD_HINT,
  NO_ORG_UNIT_FIELD_HINT,
  NO_SINGLE_MEMBER_FIELD_HINT,
  readDynamicFormFieldChoice,
  readDynamicFormSummary,
  readFormMemberManagerFieldChoice,
  readFormMemberManagerSummary,
  readFormOrgUnitFieldChoice,
  readFormOrgUnitManagerSummary,
  readMemberFieldOptions,
  readOrgUnitFieldOptions,
  readSingleMemberFieldOptions,
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
        warning:
          '此欄位非必填，空白時此關會找不到人員，發佈時會被拒絕；請在表單設計將它設為必填且不隱藏',
      },
      {
        id: 'hidden',
        name: '代理人 (hidden)（可能被條件隱藏）',
        warning:
          '此欄位可能被條件隱藏，空白時此關會找不到人員，發佈時會被拒絕；請在表單設計將它設為必填且不隱藏',
      },
      {
        id: 'both',
        name: '共同簽核 (both)（非必填）（可能被條件隱藏）',
        warning:
          '此欄位非必填、此欄位可能被條件隱藏，空白時此關會找不到人員，發佈時會被拒絕；請在表單設計將它設為必填且不隱藏',
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
    expect(choice.problem).toBe(
      '此欄位非必填，空白時此關會找不到人員，發佈時會被拒絕；請在表單設計將它設為必填且不隱藏',
    );
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

const schemaWithOrgUnits: FormDefinitionSchema = {
  fields: [
    { fieldKey: 'owner', label: '負責人', required: true, type: 'member' },
    {
      fieldKey: 'reviewers',
      label: '審閱者',
      multiple: true,
      required: true,
      type: 'member',
    },
    { fieldKey: 'dept', label: '申請部門', required: true, type: 'org_unit' },
    {
      fieldKey: 'optDept',
      label: '備用部門',
      required: false,
      type: 'org_unit',
    },
    {
      fieldKey: 'hidDept',
      hidden: true,
      label: '隱藏部門',
      required: true,
      type: 'org_unit',
      visibleWhen: 'form.owner != null',
    },
    { fieldKey: 'reason', label: '事由', required: true, type: 'text' },
  ],
  schemaVersion: 1,
};

describe('readSingleMemberFieldOptions', () => {
  it('lists only single-select member fields (a manager needs one person)', () => {
    expect(readSingleMemberFieldOptions(schemaWithOrgUnits)).toEqual([
      { id: 'owner', name: '負責人 (owner)' },
    ]);
  });

  it('keeps the same warnings as the 本人 list for a risky field', () => {
    expect(readSingleMemberFieldOptions(schemaWithRiskyMemberFields)).toEqual(
      readMemberFieldOptions(schemaWithRiskyMemberFields),
    );
  });

  it('is empty without a schema', () => {
    expect(readSingleMemberFieldOptions(null)).toEqual([]);
  });

  it('leaves the 本人 list as it was, multi-select fields included (反向控制)', () => {
    expect(
      readMemberFieldOptions(schemaWithOrgUnits).map((option) => option.id),
    ).toEqual(['owner', 'reviewers']);
  });
});

describe('readFormMemberManagerFieldChoice', () => {
  it('selects the stored single member field', () => {
    expect(
      readFormMemberManagerFieldChoice(schemaWithOrgUnits, 'owner'),
    ).toEqual({
      options: [{ id: 'owner', name: '負責人 (owner)' }],
      problem: null,
      selected: { id: 'owner', name: '負責人 (owner)' },
    });
  });

  it('keeps a stored multi-select member field visible and says why it cannot be used', () => {
    const choice = readFormMemberManagerFieldChoice(
      schemaWithOrgUnits,
      'reviewers',
    );

    expect(choice.selected).toEqual({
      id: 'reviewers',
      name: 'reviewers（無效欄位）',
    });
    expect(choice.problem).toContain('單選');
  });

  it('asks for a single-select member field when the form has none', () => {
    expect(
      readFormMemberManagerFieldChoice(
        { fields: [schema.fields[2]], schemaVersion: 1 },
        '',
      ),
    ).toEqual({
      options: [],
      problem: NO_SINGLE_MEMBER_FIELD_HINT,
      selected: null,
    });
  });

  it('shows the warning of a risky field as the hint', () => {
    expect(
      readFormMemberManagerFieldChoice(schemaWithRiskyMemberFields, 'optional')
        .problem,
    ).toContain('空白時此關會找不到人員');
  });

  it('keeps a stored key the form no longer has', () => {
    expect(
      readFormMemberManagerFieldChoice(schemaWithOrgUnits, 'gone').selected,
    ).toEqual({ id: 'gone', name: 'gone（無效欄位）' });
  });
});

describe('readOrgUnitFieldOptions', () => {
  it('lists every org_unit field, risky ones included, with the same warnings as member fields', () => {
    expect(readOrgUnitFieldOptions(schemaWithOrgUnits)).toEqual([
      { id: 'dept', name: '申請部門 (dept)' },
      {
        id: 'optDept',
        name: '備用部門 (optDept)（非必填）',
        warning:
          '此欄位非必填，空白時此關會找不到組織主管，發佈時會被拒絕；請在表單設計將它設為必填且不隱藏',
      },
      {
        id: 'hidDept',
        name: '隱藏部門 (hidDept)（可能被條件隱藏）（隱藏欄位）',
        warning:
          '此欄位可能被條件隱藏、此欄位為隱藏欄位，申請人無法填寫，空白時此關會找不到組織主管，發佈時會被拒絕；請在表單設計將它設為必填且不隱藏',
      },
    ]);
  });

  it('is empty without a schema', () => {
    expect(readOrgUnitFieldOptions(null)).toEqual([]);
  });
});

describe('readFormOrgUnitFieldChoice', () => {
  it('selects the stored org field', () => {
    expect(
      readFormOrgUnitFieldChoice(schemaWithOrgUnits, 'dept'),
    ).toMatchObject({
      problem: null,
      selected: { id: 'dept', name: '申請部門 (dept)' },
    });
  });

  it('shows the reason a risky org field cannot be published as the hint', () => {
    expect(
      readFormOrgUnitFieldChoice(schemaWithOrgUnits, 'optDept').problem,
    ).toContain('空白時此關會找不到組織主管');
  });

  it('asks the author to add an org field when the form has none', () => {
    expect(readFormOrgUnitFieldChoice(schema, '')).toEqual({
      options: [],
      problem: NO_ORG_UNIT_FIELD_HINT,
      selected: null,
    });
  });

  it('keeps a stored key that is not an org field visible with a warning', () => {
    const choice = readFormOrgUnitFieldChoice(schemaWithOrgUnits, 'owner');

    expect(choice.selected).toEqual({ id: 'owner', name: 'owner（無效欄位）' });
    expect(choice.problem).toContain('組織選擇');
  });
});

describe('readFormMemberManagerSummary / readFormOrgUnitManagerSummary', () => {
  it('names the field and the manager level', () => {
    expect(
      readFormMemberManagerSummary(schemaWithOrgUnits, 'owner', '直屬主管'),
    ).toBe('依表單欄位：負責人的直屬主管');
    expect(readFormOrgUnitManagerSummary(schemaWithOrgUnits, 'dept')).toBe(
      '依表單欄位：申請部門所選組織的主管',
    );
  });

  it('marks a wrong field type, a multi-select member field and an unset field', () => {
    expect(
      readFormMemberManagerSummary(schemaWithOrgUnits, 'dept', '直屬主管'),
    ).toBe('依表單欄位：申請部門（非人員選擇欄位）');
    expect(
      readFormMemberManagerSummary(schemaWithOrgUnits, 'reviewers', '直屬主管'),
    ).toBe('依表單欄位：審閱者（需為單選人員欄位）');
    expect(
      readFormMemberManagerSummary(schemaWithOrgUnits, '', '直屬主管'),
    ).toBe('依表單欄位：未設定');
    expect(readFormOrgUnitManagerSummary(schemaWithOrgUnits, 'owner')).toBe(
      '依表單欄位：負責人（非組織選擇欄位）',
    );
    expect(readFormOrgUnitManagerSummary(schemaWithOrgUnits, '')).toBe(
      '依表單欄位：未設定',
    );
  });

  it('falls back to the key when the form does not have the field', () => {
    expect(readFormMemberManagerSummary(null, 'owner', '第二層主管')).toBe(
      '依表單欄位：owner的第二層主管',
    );
    expect(readFormOrgUnitManagerSummary(null, 'dept')).toBe(
      '依表單欄位：dept所選組織的主管',
    );
  });
});
