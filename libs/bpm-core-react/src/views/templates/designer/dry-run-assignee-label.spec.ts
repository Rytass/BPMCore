import {
  DryRunAssigneeDirectory,
  readDryRunAssigneeLabel,
} from './dry-run-assignee-label';

const directory: DryRunAssigneeDirectory = {
  formFields: [
    { fieldKey: 'reviewer', label: '複核人' },
    { fieldKey: 'unlabelled', label: '' },
  ],
  memberName: (memberId) => (memberId === 'member-001' ? '王小明' : null),
  nodes: [
    { id: 'node-a', name: '主管審核' },
    { id: 'node-b', name: '財務審核' },
  ],
  orgUnits: [
    { id: 'org-1', name: '財務部' },
    { id: 'org-2', name: '資訊部' },
  ],
  positions: [{ id: 'pos-1', name: '經理' }],
};

describe('readDryRunAssigneeLabel', () => {
  it('describes a position placeholder', () => {
    expect(readDryRunAssigneeLabel('position:pos-1', directory)).toBe(
      '職位：經理（送出時依當下人員決定）',
    );
  });

  it('describes an org unit member placeholder', () => {
    expect(readDryRunAssigneeLabel('orgUnitMember:org-1', directory)).toBe(
      '組織任一人：財務部',
    );
  });

  it('describes an org unit position placeholder with both names', () => {
    expect(
      readDryRunAssigneeLabel('orgUnitPosition:org-2:pos-1', directory),
    ).toBe('組織職位：資訊部／經理');
  });

  it('describes an org unit manager placeholder', () => {
    expect(readDryRunAssigneeLabel('orgUnitManager:org-1', directory)).toBe(
      '組織主管：財務部',
    );
  });

  it('describes a manager chain placeholder with its level', () => {
    expect(readDryRunAssigneeLabel('orgManagerChain:3', directory)).toBe(
      '主管鏈：簽到職等 3（送出時依組織決定實際主管）',
    );
  });

  it('describes a member-field sample placeholder by its field label', () => {
    expect(readDryRunAssigneeLabel('formMember:reviewer', directory)).toBe(
      '表單欄位「複核人」選的人（送出時依填寫內容決定）',
    );
  });

  it('falls back to the field key when the field has no label or is gone', () => {
    expect(readDryRunAssigneeLabel('formMember:unlabelled', directory)).toBe(
      '表單欄位「unlabelled」選的人（送出時依填寫內容決定）',
    );
    expect(readDryRunAssigneeLabel('formMember:removed', directory)).toBe(
      '表單欄位「removed」選的人（送出時依填寫內容決定）',
    );
  });

  it('shows the id when the org unit or position is no longer in the directory', () => {
    expect(
      readDryRunAssigneeLabel('orgUnitPosition:org-gone:pos-gone', directory),
    ).toBe('組織職位：org-gone／pos-gone');
  });

  it('shows a real member by name, falling back to the raw id', () => {
    expect(readDryRunAssigneeLabel('member-001', directory)).toBe('王小明');
    expect(readDryRunAssigneeLabel('member-404', directory)).toBe('member-404');
  });

  it('leaves an unknown prefix or a malformed placeholder as it came', () => {
    expect(readDryRunAssigneeLabel('somethingNew:abc', directory)).toBe(
      'somethingNew:abc',
    );
    expect(readDryRunAssigneeLabel('orgUnitPosition:org-1', directory)).toBe(
      'orgUnitPosition:org-1',
    );
    expect(readDryRunAssigneeLabel('position:', directory)).toBe('position:');
  });
});

describe('readDryRunAssigneeLabel (form-field and prior-node sources)', () => {
  it('describes a person-field manager placeholder with the field label and level', () => {
    expect(
      readDryRunAssigneeLabel('formMemberManager:reviewer:1', directory),
    ).toBe('表單欄位「複核人」選的人的直屬主管（送出時依填寫內容與組織決定）');
    expect(
      readDryRunAssigneeLabel('formMemberManager:reviewer:3', directory),
    ).toBe(
      '表單欄位「複核人」選的人的第三層主管（送出時依填寫內容與組織決定）',
    );
  });

  it('falls back to the field key, and keeps a field key that holds a colon', () => {
    expect(
      readDryRunAssigneeLabel('formMemberManager:removed:2', directory),
    ).toBe(
      '表單欄位「removed」選的人的第二層主管（送出時依填寫內容與組織決定）',
    );
    expect(readDryRunAssigneeLabel('formMemberManager:a:b:2', directory)).toBe(
      '表單欄位「a:b」選的人的第二層主管（送出時依填寫內容與組織決定）',
    );
  });

  it('describes an org-field manager placeholder', () => {
    expect(
      readDryRunAssigneeLabel('formOrgUnitManager:reviewer', directory),
    ).toBe('表單欄位「複核人」所選組織的主管（送出時依填寫內容決定）');
  });

  it('describes a prior-stage placeholder by stage name', () => {
    expect(readDryRunAssigneeLabel('nodeActor:node-a', directory)).toBe(
      '前面關卡「主管審核」的簽核者（送出時依實際簽核者決定）',
    );
    expect(readDryRunAssigneeLabel('nodeActor:node-a,node-b', directory)).toBe(
      '前面關卡「主管審核、財務審核」的簽核者（送出時依實際簽核者決定）',
    );
  });

  it('describes a prior-stage manager placeholder by stage name and level', () => {
    expect(
      readDryRunAssigneeLabel('nodeActorManager:node-a,node-b:2', directory),
    ).toBe(
      '前面關卡「主管審核、財務審核」簽核者的第二層主管（送出時依實際簽核者決定）',
    );
  });

  it('shows the stage id when the stage is no longer in the workflow', () => {
    expect(readDryRunAssigneeLabel('nodeActor:gone', directory)).toBe(
      '前面關卡「gone」的簽核者（送出時依實際簽核者決定）',
    );
  });

  it('leaves a malformed new placeholder as it came', () => {
    expect(readDryRunAssigneeLabel('nodeActor:', directory)).toBe('nodeActor:');
    expect(readDryRunAssigneeLabel('nodeActorManager:node-a', directory)).toBe(
      'nodeActorManager:node-a',
    );
    expect(
      readDryRunAssigneeLabel('nodeActorManager:node-a:x', directory),
    ).toBe('nodeActorManager:node-a:x');
    expect(
      readDryRunAssigneeLabel('formMemberManager:reviewer', directory),
    ).toBe('formMemberManager:reviewer');
    expect(readDryRunAssigneeLabel('formOrgUnitManager:', directory)).toBe(
      'formOrgUnitManager:',
    );
  });
});
