import {
  DECISION_POLICY_OPTIONS,
  readDecisionPolicyHint,
  readDecisionPolicyOption,
} from './decision-policy-options';

describe('decision policy options', () => {
  it('offers 依序簽核 right after 全部同意', () => {
    const names = DECISION_POLICY_OPTIONS.map((option) => option.name);

    expect(names[names.indexOf('全部同意') + 1]).toBe('依序簽核');
    expect(DECISION_POLICY_OPTIONS.map((option) => option.id)).toContain(
      'SEQUENTIAL',
    );
  });

  it('labels a stored SEQUENTIAL policy as 依序簽核', () => {
    expect(readDecisionPolicyOption('SEQUENTIAL')).toEqual({
      id: 'SEQUENTIAL',
      name: '依序簽核',
    });
  });

  it('explains that SEQUENTIAL opens one approver at a time', () => {
    expect(readDecisionPolicyHint({ type: 'SEQUENTIAL' })).toBe(
      '依簽核人順序一次開放一位，前一位核准後才輪到下一位；任一位拒絕或退回即結束此關。',
    );
    expect(readDecisionPolicyHint({ type: 'PARALLEL_ALL' })).toContain(
      '所有人都會收到待辦',
    );
  });

  it('still echoes an unknown stored policy verbatim', () => {
    expect(readDecisionPolicyOption('SOMETHING_ELSE' as 'SINGLE').name).toBe(
      '未知決策方式（SOMETHING_ELSE）',
    );
  });
});
