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

  it('samples a member field with a placeholder, never the initiator (an array when multiple)', () => {
    expect(readDryRunSampleFormData(schema)).toEqual({
      amount: 1000,
      owner: 'formMember:owner',
      reason: '事由',
      reviewers: ['formMember:reviewers'],
    });
  });

  it('samples a money field as a number so amount conditions can compare it', () => {
    const moneySchema: FormDefinitionSchema = {
      fields: [
        { fieldKey: 'total', label: '申請金額', required: true, type: 'money' },
      ],
      schemaVersion: 1,
    };

    expect(readDryRunSampleFormData(moneySchema)).toEqual({ total: 1000 });
  });

  it('samples every option field in the shape a real submission stores', () => {
    const options = [
      { label: '甲', value: 'A' },
      { label: '乙', value: 'B' },
    ];
    const optionSchema: FormDefinitionSchema = {
      fields: [
        {
          fieldKey: 'single',
          label: '單選',
          options,
          required: true,
          type: 'select',
        },
        {
          fieldKey: 'multi',
          label: '多選',
          mode: 'multiple',
          options,
          required: true,
          type: 'select',
        },
        {
          fieldKey: 'multiAuto',
          label: '多選自動完成',
          mode: 'multiple',
          options,
          required: true,
          type: 'autocomplete',
        },
        {
          fieldKey: 'checks',
          label: '核取',
          options,
          required: true,
          type: 'checkbox',
        },
        {
          fieldKey: 'radio',
          label: '單選鈕',
          options,
          required: true,
          type: 'radio',
        },
        {
          dataSource: { bindings: [], key: 'employees', version: 1 },
          fieldKey: 'remoteMulti',
          label: '外部多選',
          mode: 'multiple',
          required: true,
          type: 'select',
        },
      ],
      schemaVersion: 1,
    };

    expect(readDryRunSampleFormData(optionSchema)).toEqual({
      checks: ['A'],
      multi: ['A'],
      multiAuto: ['A'],
      radio: 'A',
      remoteMulti: [],
      single: 'A',
    });
  });

  it('is empty without a bound form', () => {
    expect(readDryRunSampleFormData(null)).toEqual({});
  });
});
