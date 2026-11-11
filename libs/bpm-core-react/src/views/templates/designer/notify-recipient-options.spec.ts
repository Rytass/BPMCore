import {
  ApproverResolver,
  NotifyWebhookTarget,
  ServiceAction,
  WorkflowNode,
} from '@rytass/bpm-core-shared/workflow';
import { readNotifyServiceTaskIssue } from '@rytass/bpm-core-shared/workflow-graph';
import {
  NOTIFY_RECIPIENT_MODE_OPTIONS,
  READ_ONLY_NOTIFY_RECIPIENT_OPTION_ID,
  readNotifyRecipients,
  readNotifyRecipientSourceChoice,
  readNotifyRecipientSourcePick,
  readNotifyRecipientsDesignerIssue,
  withNotifyFormPath,
  withNotifyIncludeDescendants,
  withNotifyOrgUnit,
  withNotifyPosition,
  withNotifyRecipients,
} from './notify-recipient-options';

const WEBHOOK: NotifyWebhookTarget = {
  bindings: [],
  endpoint: { key: 'erp.notify', version: 1 },
  id: 'webhook_1',
};

const OPEN_TYPES = [
  'DIRECT',
  'DYNAMIC_FORM',
  'ORG_UNIT_MANAGER',
  'ORG_UNIT_MEMBER',
  'ORG_UNIT_POSITION',
  'POSITION',
] as const;

const DEFAULT_BY_TYPE: Readonly<Record<string, ApproverResolver>> = {
  DIRECT: { memberIds: [], type: 'DIRECT' },
  DYNAMIC_FORM: { formPath: '', type: 'DYNAMIC_FORM' },
  ORG_UNIT_MANAGER: { orgUnitId: '', type: 'ORG_UNIT_MANAGER' },
  ORG_UNIT_MEMBER: {
    includeDescendants: false,
    orgUnitId: '',
    type: 'ORG_UNIT_MEMBER',
  },
  ORG_UNIT_POSITION: {
    includeDescendants: false,
    orgUnitId: '',
    positionId: '',
    type: 'ORG_UNIT_POSITION',
  },
  POSITION: { positionId: '', type: 'POSITION' },
};

// Sources the engine accepts for a notify node but the designer does not edit.
const CLOSED_BUT_VALID: readonly ApproverResolver[] = [
  { baseFromInitiator: true, levelsUp: 1, type: 'ORG_MANAGER' },
  { minPositionLevel: 3, type: 'ORG_MANAGER_CHAIN' },
  { expression: 'form.owner', type: 'EXPRESSION' },
];

// Sources a notify node may not use at all.
const NOT_FOR_NOTIFY: readonly ApproverResolver[] = [
  { formPath: 'owner', levelsUp: 1, type: 'FORM_MEMBER_MANAGER' },
  { formPath: 'dept', type: 'FORM_ORG_UNIT_MANAGER' },
  { nodeIds: ['a'], type: 'NODE_ACTOR' },
  { levelsUp: 1, nodeIds: ['a'], type: 'NODE_ACTOR_MANAGER' },
];

function notifyAction(
  recipients: ApproverResolver,
  extra: Partial<Extract<ServiceAction, { type: 'NOTIFY' }>> = {},
): ServiceAction {
  return {
    channels: ['IN_APP', 'EMAIL'],
    recipients,
    template: '請查看 {{title}}',
    type: 'NOTIFY',
    ...extra,
  };
}

function notifyNode(
  recipients: ApproverResolver,
  extra: Partial<Extract<ServiceAction, { type: 'NOTIFY' }>> = {},
): WorkflowNode {
  return {
    data: { action: notifyAction(recipients, extra), label: '知會主管' },
    id: 'notify',
    position: { x: 0, y: 0 },
    type: 'serviceTask',
  } as WorkflowNode;
}

describe('notify recipient source choice', () => {
  it('offers exactly the six open sources, worded as the approver panel words them', () => {
    expect(NOTIFY_RECIPIENT_MODE_OPTIONS.map((option) => option.id)).toEqual([
      'DIRECT',
      'DYNAMIC_FORM',
      'ORG_UNIT_MANAGER',
      'ORG_UNIT_MEMBER',
      'ORG_UNIT_POSITION',
      'POSITION',
    ]);
    expect(NOTIFY_RECIPIENT_MODE_OPTIONS.map((option) => option.name)).toEqual([
      '指定會員',
      '依表單欄位指定',
      '指定組織主管',
      '組織任一人',
      '組織特定職位',
      '指定職位',
    ]);
  });

  it.each(OPEN_TYPES)('%s is shown as itself and is editable', (type) => {
    const choice = readNotifyRecipientSourceChoice(DEFAULT_BY_TYPE[type]);

    expect(choice.readOnly).toBe(false);
    expect(choice.selected.id).toBe(type);
    expect(choice.hint).toBeNull();
    expect(choice.options).toEqual(NOTIFY_RECIPIENT_MODE_OPTIONS);
  });

  it.each([
    ['ORG_MANAGER', '發起人主管'],
    ['ORG_MANAGER_CHAIN', '主管鏈（簽到指定職等）'],
    ['EXPRESSION', '運算式'],
  ])('%s is shown as a read-only current value (%s)', (type, name) => {
    const recipients = CLOSED_BUT_VALID.find(
      (candidate) => candidate.type === type,
    ) as ApproverResolver;
    const choice = readNotifyRecipientSourceChoice(recipients);

    expect(choice.readOnly).toBe(true);
    expect(choice.selected).toEqual({
      id: READ_ONLY_NOTIFY_RECIPIENT_OPTION_ID,
      name,
    });
    expect(choice.hint).toContain('範本 JSON');
    expect(choice.options).toEqual([
      ...NOTIFY_RECIPIENT_MODE_OPTIONS,
      choice.selected,
    ]);
  });

  it.each(NOT_FOR_NOTIFY.map((recipients) => [recipients.type, recipients]))(
    '%s (a source a notify node may not use) is read-only and named as unsupported',
    (type, recipients) => {
      const choice = readNotifyRecipientSourceChoice(
        recipients as ApproverResolver,
      );

      expect(choice.readOnly).toBe(true);
      expect(choice.selected.name).toBe(`不支援的知會來源（${type}）`);
      expect(choice.hint).toContain('不支援');
    },
  );

  it('shows a type saved by a newer BPMCore as unsupported instead of as a member list', () => {
    const choice = readNotifyRecipientSourceChoice({
      type: 'FUTURE_TYPE',
    } as unknown as ApproverResolver);

    expect(choice.readOnly).toBe(true);
    expect(choice.selected.name).toBe('不支援的知會來源（FUTURE_TYPE）');
  });
});

describe('notify recipient source pick', () => {
  it.each(OPEN_TYPES.filter((type) => type !== 'DIRECT'))(
    'switching from 指定會員 to %s writes a clean default of that source',
    (type) => {
      expect(
        readNotifyRecipientSourcePick(DEFAULT_BY_TYPE['DIRECT'], type, []),
      ).toEqual(DEFAULT_BY_TYPE[type]);
    },
  );

  it('switching back to 指定會員 writes an empty member list', () => {
    expect(
      readNotifyRecipientSourcePick(
        { positionId: 'p1', type: 'POSITION' },
        'DIRECT',
        [],
      ),
    ).toEqual({ memberIds: [], type: 'DIRECT' });
  });

  it.each(OPEN_TYPES)(
    're-picking the stored source %s writes nothing, so filled-in targets survive',
    (type) => {
      expect(
        readNotifyRecipientSourcePick(DEFAULT_BY_TYPE[type], type, []),
      ).toBeNull();
    },
  );

  it.each(CLOSED_BUT_VALID)(
    'the read-only entry of $type and its own type id write nothing',
    (recipients) => {
      expect(
        readNotifyRecipientSourcePick(
          recipients,
          READ_ONLY_NOTIFY_RECIPIENT_OPTION_ID,
          [],
        ),
      ).toBeNull();
      expect(
        readNotifyRecipientSourcePick(recipients, recipients.type, []),
      ).toBeNull();
    },
  );

  it('picking a source on a closed one replaces it, which is the only way to overwrite it', () => {
    expect(
      readNotifyRecipientSourcePick(CLOSED_BUT_VALID[1], 'POSITION', []),
    ).toEqual({ positionId: '', type: 'POSITION' });
  });

  it.each([
    'ORG_MANAGER',
    'ORG_MANAGER_CHAIN',
    'EXPRESSION',
    'FORM_MEMBER_MANAGER',
    'NODE_ACTOR',
    'NOT_A_SOURCE',
  ])('%s is not an option that can be picked', (optionId) => {
    expect(
      readNotifyRecipientSourcePick(DEFAULT_BY_TYPE['DIRECT'], optionId, []),
    ).toBeNull();
  });

  it('writes nothing when no option is given', () => {
    expect(
      readNotifyRecipientSourcePick(DEFAULT_BY_TYPE['DIRECT'], null, []),
    ).toBeNull();
  });
});

describe('notify recipients in the action', () => {
  const channelsAndMore = {
    channels: ['IN_APP', 'EMAIL'],
    template: '請查看 {{title}}',
    webhooks: [WEBHOOK],
  };

  it.each(OPEN_TYPES)(
    'changing the source to %s keeps channels, template and webhooks',
    (type) => {
      const action = withNotifyRecipients(
        notifyAction(
          { memberIds: ['m1'], type: 'DIRECT' },
          { webhooks: [WEBHOOK] },
        ),
        DEFAULT_BY_TYPE[type],
      );

      expect(action).toEqual({
        ...channelsAndMore,
        recipients: DEFAULT_BY_TYPE[type],
        type: 'NOTIFY',
      });
    },
  );

  it('keeps the webhooks when a read-only source is overwritten by a pick', () => {
    const action = notifyAction(CLOSED_BUT_VALID[2], { webhooks: [WEBHOOK] });
    const next = readNotifyRecipientSourcePick(
      readNotifyRecipients(action),
      'ORG_UNIT_MEMBER',
      [],
    ) as ApproverResolver;

    expect(withNotifyRecipients(action, next)).toEqual({
      ...channelsAndMore,
      recipients: DEFAULT_BY_TYPE['ORG_UNIT_MEMBER'],
      type: 'NOTIFY',
    });
  });

  it('turns an action that is not a notify yet into a notify with the default channel', () => {
    expect(
      withNotifyRecipients(
        { payload: '', type: 'WEBHOOK', url: 'https://example.com' },
        DEFAULT_BY_TYPE['POSITION'],
      ),
    ).toEqual({
      channels: ['IN_APP'],
      recipients: DEFAULT_BY_TYPE['POSITION'],
      type: 'NOTIFY',
    });
  });

  it('reads the stored recipients as they are, an empty 指定會員 when there are none', () => {
    const stored = CLOSED_BUT_VALID[1];

    expect(readNotifyRecipients(notifyAction(stored))).toBe(stored);
    expect(
      readNotifyRecipients({
        payload: '',
        type: 'WEBHOOK',
        url: 'https://example.com',
      }),
    ).toEqual({ memberIds: [], type: 'DIRECT' });
    expect(
      readNotifyRecipients({
        channels: ['IN_APP'],
        type: 'NOTIFY',
      } as unknown as ServiceAction),
    ).toEqual({ memberIds: [], type: 'DIRECT' });
  });

  it('keeps a template that only has 指定會員 behaving as before', () => {
    const recipients: ApproverResolver = {
      memberIds: ['m1', 'm2'],
      type: 'DIRECT',
    };
    const choice = readNotifyRecipientSourceChoice(
      readNotifyRecipients(notifyAction(recipients)),
    );

    expect(choice.selected.id).toBe('DIRECT');
    expect(choice.readOnly).toBe(false);
    expect(
      withNotifyRecipients(notifyAction(recipients), {
        memberIds: ['m1'],
        type: 'DIRECT',
      }),
    ).toEqual(notifyAction({ memberIds: ['m1'], type: 'DIRECT' }));
  });
});

describe('notify recipient target edits', () => {
  it('picks the organization of 組織任一人 and keeps 包含下層', () => {
    expect(
      withNotifyOrgUnit(
        {
          includeDescendants: true,
          orgUnitId: 'o1',
          type: 'ORG_UNIT_MEMBER',
        },
        'o2',
      ),
    ).toEqual({
      includeDescendants: true,
      orgUnitId: 'o2',
      type: 'ORG_UNIT_MEMBER',
    });
  });

  it('does not invent 包含下層 for a definition that never had it', () => {
    const next = withNotifyOrgUnit(
      { orgUnitId: '', type: 'ORG_UNIT_MEMBER' },
      'o2',
    );

    expect(next).toEqual({ orgUnitId: 'o2', type: 'ORG_UNIT_MEMBER' });
    expect('includeDescendants' in next).toBe(false);
  });

  it('clears the position of 組織特定職位 when its organization changes', () => {
    expect(
      withNotifyOrgUnit(
        {
          includeDescendants: false,
          orgUnitId: 'o1',
          positionId: 'p1',
          type: 'ORG_UNIT_POSITION',
        },
        'o2',
      ),
    ).toEqual({
      includeDescendants: false,
      orgUnitId: 'o2',
      positionId: '',
      type: 'ORG_UNIT_POSITION',
    });
  });

  it('picks the organization of 指定組織主管 and keeps its fallback and 只取最近一層主管', () => {
    expect(
      withNotifyOrgUnit(
        {
          fallback: { memberId: 'm9', type: 'DIRECT' },
          orgUnitId: 'o1',
          preferClosestOrgUnit: true,
          type: 'ORG_UNIT_MANAGER',
        },
        'o2',
      ),
    ).toEqual({
      fallback: { memberId: 'm9', type: 'DIRECT' },
      orgUnitId: 'o2',
      preferClosestOrgUnit: true,
      type: 'ORG_UNIT_MANAGER',
    });
  });

  it('writes a plain 指定組織主管 when the definition had no manager rule', () => {
    const next = withNotifyOrgUnit(DEFAULT_BY_TYPE['ORG_UNIT_MANAGER'], 'o2');

    expect(next).toEqual({ orgUnitId: 'o2', type: 'ORG_UNIT_MANAGER' });
    expect('fallback' in next).toBe(false);
    expect('preferClosestOrgUnit' in next).toBe(false);
  });

  it('switches 包含下層 and clears the position only for 組織特定職位', () => {
    expect(
      withNotifyIncludeDescendants(
        { orgUnitId: 'o1', type: 'ORG_UNIT_MEMBER' },
        true,
      ),
    ).toEqual({
      includeDescendants: true,
      orgUnitId: 'o1',
      type: 'ORG_UNIT_MEMBER',
    });
    expect(
      withNotifyIncludeDescendants(
        {
          includeDescendants: false,
          orgUnitId: 'o1',
          positionId: 'p1',
          type: 'ORG_UNIT_POSITION',
        },
        true,
      ),
    ).toEqual({
      includeDescendants: true,
      orgUnitId: 'o1',
      positionId: '',
      type: 'ORG_UNIT_POSITION',
    });
  });

  it('picks the position of 指定職位 and of 組織特定職位', () => {
    expect(
      withNotifyPosition({ positionId: '', type: 'POSITION' }, 'p1'),
    ).toEqual({ positionId: 'p1', type: 'POSITION' });
    expect(
      withNotifyPosition(
        {
          includeDescendants: true,
          orgUnitId: 'o1',
          positionId: '',
          type: 'ORG_UNIT_POSITION',
        },
        'p1',
      ),
    ).toEqual({
      includeDescendants: true,
      orgUnitId: 'o1',
      positionId: 'p1',
      type: 'ORG_UNIT_POSITION',
    });
  });

  it('picks the member field of 依表單欄位指定 as the person in the field', () => {
    expect(
      withNotifyFormPath({ formPath: '', type: 'DYNAMIC_FORM' }, 'owner'),
    ).toEqual({ formPath: 'owner', type: 'DYNAMIC_FORM' });
  });

  it.each([...CLOSED_BUT_VALID, ...NOT_FOR_NOTIFY])(
    'leaves $type untouched whatever target is edited, so opening the panel never rewrites it',
    (recipients) => {
      expect(withNotifyOrgUnit(recipients, 'o2')).toBe(recipients);
      expect(withNotifyIncludeDescendants(recipients, true)).toBe(recipients);
      expect(withNotifyPosition(recipients, 'p2')).toBe(recipients);
      expect(withNotifyFormPath(recipients, 'owner')).toBe(recipients);
    },
  );

  it('does not turn a 表單欄位 org manager into a fixed one', () => {
    const recipients: ApproverResolver = {
      formPath: 'dept',
      type: 'FORM_ORG_UNIT_MANAGER',
    };

    expect(withNotifyOrgUnit(recipients, 'o2')).toBe(recipients);
  });
});

describe('notify recipient readiness', () => {
  it.each([
    ['POSITION', '知會節點需要指定職位。'],
    ['ORG_UNIT_MEMBER', '知會節點需要指定組織。'],
    ['ORG_UNIT_POSITION', '知會節點需要指定組織與職位。'],
    ['DYNAMIC_FORM', '知會節點需要指定知會對象的表單欄位。'],
  ])(
    'a freshly picked %s with no target blocks the draft: %s',
    (type, message) => {
      const picked = readNotifyRecipientSourcePick(
        DEFAULT_BY_TYPE['DIRECT'],
        type,
        [],
      ) as ApproverResolver;
      const node = notifyNode(picked);

      expect(readNotifyServiceTaskIssue(node)).toBe(message);
    },
  );

  it('a freshly picked 指定組織主管 with no organization blocks the draft', () => {
    const picked = readNotifyRecipientSourcePick(
      DEFAULT_BY_TYPE['DIRECT'],
      'ORG_UNIT_MANAGER',
      [],
    ) as ApproverResolver;
    const node = notifyNode(picked);

    expect(readNotifyRecipientsDesignerIssue(node)).toBe(
      '知會節點需要指定組織。',
    );
  });

  it('reports a 指定組織主管 saved without any orgUnitId instead of throwing', () => {
    const node = notifyNode({
      type: 'ORG_UNIT_MANAGER',
    } as unknown as ApproverResolver);

    expect(readNotifyRecipientsDesignerIssue(node)).toBe(
      '知會節點需要指定組織。',
    );
  });

  it('lets each source through once its target is chosen', () => {
    const complete: readonly ApproverResolver[] = [
      { positionId: 'p1', type: 'POSITION' },
      { orgUnitId: 'o1', type: 'ORG_UNIT_MEMBER' },
      { orgUnitId: 'o1', positionId: 'p1', type: 'ORG_UNIT_POSITION' },
      { formPath: 'owner', type: 'DYNAMIC_FORM' },
      { orgUnitId: 'o1', type: 'ORG_UNIT_MANAGER' },
    ];

    complete.forEach((recipients) => {
      const node = notifyNode(recipients);

      expect(readNotifyServiceTaskIssue(node)).toBeNull();
      expect(readNotifyRecipientsDesignerIssue(node)).toBeNull();
    });
  });

  it('has no designer-only issue for any other node or source', () => {
    expect(
      readNotifyRecipientsDesignerIssue(
        notifyNode({ memberIds: [], type: 'DIRECT' }),
      ),
    ).toBeNull();
    expect(
      readNotifyRecipientsDesignerIssue({
        data: { label: '開始' },
        id: 'start',
        position: { x: 0, y: 0 },
        type: 'start',
      } as unknown as WorkflowNode),
    ).toBeNull();
    expect(
      readNotifyRecipientsDesignerIssue({
        data: {
          action: { fieldPath: 'a', type: 'SET_FORM_FIELD', value: '1' },
          label: '寫欄位',
        },
        id: 'set',
        position: { x: 0, y: 0 },
        type: 'serviceTask',
      } as unknown as WorkflowNode),
    ).toBeNull();
  });

  it('keeps the 指定會員 rules: empty needs a webhook, a webhook-only node is fine', () => {
    const empty: ApproverResolver = { memberIds: [], type: 'DIRECT' };

    expect(readNotifyServiceTaskIssue(notifyNode(empty))).toBe(
      '知會節點需要至少一位知會對象或一個 Webhook。',
    );
    expect(
      readNotifyServiceTaskIssue(notifyNode(empty, { webhooks: [WEBHOOK] })),
    ).toBeNull();
  });
});
