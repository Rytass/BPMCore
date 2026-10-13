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
