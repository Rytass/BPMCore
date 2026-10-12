import { DecisionPolicy } from '@rytass/bpm-core-shared/workflow';

export type DecisionPolicyOption = Readonly<{
  id: DecisionPolicy['type'];
  name: string;
}>;

export const DECISION_POLICY_OPTIONS: readonly DecisionPolicyOption[] = [
  { id: 'SINGLE', name: '單人簽核' },
  { id: 'PARALLEL_ANY', name: '任一人同意' },
  { id: 'PARALLEL_ALL', name: '全部同意' },
  { id: 'SEQUENTIAL', name: '依序簽核' },
  { id: 'QUORUM', name: '達到指定門檻' },
];

export function readDecisionPolicyHint(
  policy: DecisionPolicy | undefined,
): string {
  if (!policy || policy.type === 'SINGLE' || policy.type === 'PARALLEL_ANY') {
    return '可指定多位；多位時所有人都會收到待辦，任一人同意即可通過。';
  }

  if (policy.type === 'PARALLEL_ALL') {
    return '可指定多位；多位時所有人都會收到待辦，全部同意後才會通過。';
  }

  if (policy.type === 'SEQUENTIAL') {
    return '依簽核人順序一次開放一位，前一位核准後才輪到下一位；任一位拒絕或退回即結束此關。';
  }

  const thresholdUnit =
    policy.thresholdType === 'PERCENTAGE' ? '%' : ' 位簽核者';

  return `可指定多位；需達到 ${policy.threshold}${thresholdUnit} 才會通過。`;
}

export function readDecisionPolicyOption(
  type: DecisionPolicy['type'],
): DecisionPolicyOption {
  const option = DECISION_POLICY_OPTIONS.find((item) => item.id === type);

  if (option) {
    return option;
  }

  // Any other stored value falls outside `DecisionPolicy['type']`'s own
  // union — it can only have come from an untyped source (API payload, an
  // older schema) this form was never told about. Echo it verbatim instead
  // of mislabelling it as a specific known policy.
  return { id: type, name: `未知決策方式（${type}）` };
}
