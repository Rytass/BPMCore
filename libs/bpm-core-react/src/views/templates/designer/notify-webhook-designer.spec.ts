import { FormFieldDefinition } from '@rytass/bpm-core-shared/form';
import {
  NotifyWebhookTarget,
  WorkflowDefinition,
} from '@rytass/bpm-core-shared/workflow';
import {
  NotifyWebhookDesignerEndpoint,
  createNotifyWebhookBindingSource,
  isNotifyWebhookListEditable,
  readCompatibleFormFields,
  readNotifyWebhookBindingKinds,
  readNotifyWebhookConstantValue,
  readNotifyWebhookDesignerIssues,
  setNotifyWebhookBinding,
  switchNotifyWebhookEndpoint,
} from './notify-webhook-designer';

function field(
  fieldKey: string,
  type: FormFieldDefinition['type'],
): FormFieldDefinition {
  return {
    fieldKey,
    label: fieldKey,
    required: false,
    type,
  } as FormFieldDefinition;
}

const FORM_FIELDS: readonly FormFieldDefinition[] = [
  field('amount', 'money'),
  field('subject', 'text'),
  field('count', 'number'),
];

function endpoint(
  key: string,
  parameters: NotifyWebhookDesignerEndpoint['parameters'],
  extra: Partial<NotifyWebhookDesignerEndpoint> = {},
): NotifyWebhookDesignerEndpoint {
  return {
    deprecated: false,
    description: null,
    key,
    label: `端點 ${key}`,
    parameters,
    version: 1,
    ...extra,
  };
}

const ERP = endpoint('erp.po', [
  {
    description: null,
    key: 'amount',
    label: '金額',
    required: true,
    type: 'number',
  },
  {
    description: null,
    key: 'title',
    label: '主旨',
    required: false,
    type: 'string',
  },
]);

const TARGET: NotifyWebhookTarget = {
  bindings: [
    { from: { fieldKey: 'amount', kind: 'FIELD' }, parameter: 'amount' },
    { from: { kind: 'CONTEXT', path: 'instance.title' }, parameter: 'title' },
  ],
  endpoint: { key: 'erp.po', version: 1 },
  id: 'webhook_1',
};

describe('notify webhook designer helpers', () => {
  it('only lists form fields whose value fits the parameter type', () => {
    expect(
      readCompatibleFormFields(FORM_FIELDS, 'number').map((f) => f.fieldKey),
    ).toEqual(['amount', 'count']);
    expect(
      readCompatibleFormFields(FORM_FIELDS, 'string').map((f) => f.fieldKey),
    ).toEqual(['subject']);
  });

  it('offers the case-context source only for string and json parameters', () => {
    expect(readNotifyWebhookBindingKinds('string')).toEqual([
      'FIELD',
      'CONSTANT',
      'CONTEXT',
    ]);
    expect(readNotifyWebhookBindingKinds('number')).toEqual([
      'FIELD',
      'CONSTANT',
    ]);
    expect(readNotifyWebhookBindingKinds('stringArray')).toEqual(['FIELD']);
  });

  it('starts a field binding at the first compatible field', () => {
    expect(
      createNotifyWebhookBindingSource(
        'FIELD',
        ERP.parameters[0] as never,
        FORM_FIELDS,
      ),
    ).toEqual({ fieldKey: 'amount', kind: 'FIELD' });
  });

  it('starts a number constant empty instead of at zero', () => {
    expect(
      createNotifyWebhookBindingSource(
        'CONSTANT',
        ERP.parameters[0] as never,
        FORM_FIELDS,
      ),
    ).toEqual({ kind: 'CONSTANT', value: null });
  });

  it('reads a number constant but keeps unparsable text for the check to flag', () => {
    expect(readNotifyWebhookConstantValue('number', ' 12.5 ')).toBe(12.5);
    expect(readNotifyWebhookConstantValue('number', '')).toBeNull();
    expect(readNotifyWebhookConstantValue('number', '12a')).toBe('12a');
    // Mid-typing and non-decimal notations stay text rather than being
    // rewritten under the author's cursor.
    expect(readNotifyWebhookConstantValue('number', '1.')).toBe('1.');
    expect(readNotifyWebhookConstantValue('number', '-0') === 0).toBe(true);
    expect(readNotifyWebhookConstantValue('number', '-0.5')).toBe(-0.5);
    expect(readNotifyWebhookConstantValue('number', '0x1f')).toBe('0x1f');
    expect(readNotifyWebhookConstantValue('number', '1e3')).toBe('1e3');
    expect(readNotifyWebhookConstantValue('string', ' a ')).toBe(' a ');
  });

  it('refuses to render a hand-edited list the editor would throw on', () => {
    expect(isNotifyWebhookListEditable(undefined)).toBe(true);
    expect(isNotifyWebhookListEditable([TARGET])).toBe(true);
    expect(
      isNotifyWebhookListEditable([
        {
          ...TARGET,
          bindings: [
            { from: { fieldKey: '', kind: 'FIELD' }, parameter: 'amount' },
          ],
        },
      ]),
    ).toBe(true);
    expect(isNotifyWebhookListEditable([null])).toBe(false);
    expect(isNotifyWebhookListEditable([{ bindings: [], id: 'x' }])).toBe(
      false,
    );
    expect(isNotifyWebhookListEditable('nope')).toBe(false);
  });

  it('sets, replaces in place and removes one parameter binding', () => {
    const replaced = setNotifyWebhookBinding(TARGET, 'amount', {
      kind: 'CONSTANT',
      value: 3,
    });

    expect(replaced.bindings.map((binding) => binding.parameter)).toEqual([
      'amount',
      'title',
    ]);
    expect(replaced.bindings[0]?.from).toEqual({ kind: 'CONSTANT', value: 3 });
    expect(
      setNotifyWebhookBinding(TARGET, 'title', null).bindings,
    ).toHaveLength(1);
  });

  it('keeps the target id and only the bindings that still fit when switching endpoint', () => {
    const next = switchNotifyWebhookEndpoint(
      TARGET,
      endpoint('crm.lead', [
        {
          description: null,
          key: 'amount',
          label: '金額',
          required: true,
          type: 'string',
        },
        {
          description: null,
          key: 'title',
          label: '主旨',
          required: false,
          type: 'json',
        },
      ]),
      FORM_FIELDS,
    );

    expect(next).toEqual({
      bindings: [
        {
          from: { kind: 'CONTEXT', path: 'instance.title' },
          parameter: 'title',
        },
      ],
      endpoint: { key: 'crm.lead', version: 1 },
      id: 'webhook_1',
    });
  });

  it('reports catalog problems as the backend would refuse to publish them', () => {
    const definition = {
      edges: [],
      nodes: [
        {
          data: {
            action: {
              channels: ['IN_APP'],
              recipients: { memberIds: [], type: 'DIRECT' },
              type: 'NOTIFY',
              webhooks: [{ ...TARGET, bindings: [] }],
            },
            label: '通知 ERP',
          },
          id: 'notify',
          position: { x: 0, y: 0 },
          type: 'serviceTask',
        },
      ],
    } as unknown as WorkflowDefinition;

    expect(
      readNotifyWebhookDesignerIssues({
        definition,
        endpoints: [ERP],
        formFields: FORM_FIELDS,
      }),
    ).toEqual([
      '知會節點「通知 ERP」的第 1 個 Webhook（端點 erp.po）的必填參數「amount」尚未設定。',
    ]);
    expect(
      readNotifyWebhookDesignerIssues({
        definition,
        endpoints: [{ ...ERP, deprecated: true }],
        formFields: FORM_FIELDS,
      }),
    ).toEqual([
      '知會節點「通知 ERP」的第 1 個 Webhook（端點 erp.po）的端點不建議再使用，請改選其他端點。',
    ]);
  });
});
