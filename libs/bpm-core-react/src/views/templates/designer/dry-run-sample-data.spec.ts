import { FormDefinitionSchema } from '@rytass/bpm-core-shared/form';
import { readDryRunSampleFormData } from './dry-run-sample-data';

describe('readDryRunSampleFormData', () => {
  const schema: FormDefinitionSchema = {
    fields: [
      { fieldKey: 'reason', label: '事由', required: true, type: 'text' },
      { fieldKey: 'amount', label: '金額', required: true, type: 'number' },
      { fieldKey: 'owner', label: '負責人', required: false, type: 'member' },
      {
        fieldKey: 'reviewers',
        label: '審閱者',
        multiple: true,
        required: false,
        type: 'member',
      },
    ],
    schemaVersion: 1,
  };

  it('samples a member field with the dry-run initiator (an array when multiple)', () => {
    expect(readDryRunSampleFormData(schema, 'member-001')).toEqual({
      amount: 1000,
      owner: 'member-001',
      reason: '事由',
      reviewers: ['member-001'],
    });
  });

  it('is empty without a bound form', () => {
    expect(readDryRunSampleFormData(null, 'member-001')).toEqual({});
  });
});
