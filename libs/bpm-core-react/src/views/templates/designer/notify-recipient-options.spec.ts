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
  readNotifySubjectChoice,
  readNotifySubjectPick,
  withNotifyFormPath,
  withNotifyIncludeDescendants,
  withNotifyNodeIds,
  withNotifyOrgSource,
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
  'NODE_ACTOR',
  'ORG_UNIT_MANAGER',
  'ORG_UNIT_MEMBER',
  'ORG_UNIT_POSITION',
  'POSITION',
] as const;

const DEFAULT_BY_TYPE: Readonly<Record<string, ApproverResolver>> = {
  DIRECT: { memberIds: [], type: 'DIRECT' },
  DYNAMIC_FORM: { formPath: '', type: 'DYNAMIC_FORM' },
  NODE_ACTOR: { nodeIds: [], type: 'NODE_ACTOR' },
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

// The second stored type of the three screen options that hold two: the
// person's manager, the form-field organization, the earlier signer's manager.
const SHARED_OPTION_SOURCES: readonly (readonly [ApproverResolver, string])[] =
  [
    [
      { formPath: 'owner', levelsUp: 1, type: 'FORM_MEMBER_MANAGER' },
      'DYNAMIC_FORM',
    ],
    [{ formPath: 'dept', type: 'FORM_ORG_UNIT_MANAGER' }, 'ORG_UNIT_MANAGER'],
    [{ levelsUp: 1, nodeIds: ['a'], type: 'NODE_ACTOR_MANAGER' }, 'NODE_ACTOR'],
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
  it('offers exactly the seven open sources, worded as the approver panel words them', () => {
    expect(NOTIFY_RECIPIENT_MODE_OPTIONS.map((option) => option.id)).toEqual([
      'DIRECT',
      'DYNAMIC_FORM',
      'NODE_ACTOR',
      'ORG_UNIT_MANAGER',
      'ORG_UNIT_MEMBER',
      'ORG_UNIT_POSITION',
      'POSITION',
    ]);
    expect(NOTIFY_RECIPIENT_MODE_OPTIONS.map((option) => option.name)).toEqual([
      '指定會員',
      '依表單欄位指定',
      '依前面關卡的簽核者',
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

  it.each(
    SHARED_OPTION_SOURCES.map(([recipients, optionId]) => [
      recipients.type,
      recipients,
      optionId,
    ]),
  )(
    '%s is shown under the option it shares, and is editable',
    (_type, recipients, optionId) => {
      const choice = readNotifyRecipientSourceChoice(
        recipients as ApproverResolver,
      );

      expect(choice.readOnly).toBe(false);
      expect(choice.selected.id).toBe(optionId);
      expect(choice.hint).toBeNull();
      expect(choice.options).toEqual(NOTIFY_RECIPIENT_MODE_OPTIONS);
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

  it.each(SHARED_OPTION_SOURCES)(
    're-picking the option %#, stored as its second type, writes nothing',
    (recipients, optionId) => {
      expect(
        readNotifyRecipientSourcePick(recipients, optionId, []),
      ).toBeNull();
    },
  );

  it.each(SHARED_OPTION_SOURCES)(
    'picking another source over the second type %# replaces it',
    (recipients) => {
      expect(readNotifyRecipientSourcePick(recipients, 'POSITION', [])).toEqual(
        { positionId: '', type: 'POSITION' },
      );
    },
  );

  it('switching 依表單欄位指定 to 依前面關卡的簽核者 writes a clean 前面關卡 default', () => {
    expect(
      readNotifyRecipientSourcePick(
        { formPath: 'owner', levelsUp: 1, type: 'FORM_MEMBER_MANAGER' },
        'NODE_ACTOR',
        [],
      ),
    ).toEqual({ nodeIds: [], type: 'NODE_ACTOR' });
  });

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
    'FORM_ORG_UNIT_MANAGER',
    'NODE_ACTOR_MANAGER',
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

  it.each(CLOSED_BUT_VALID)(
    'leaves $type untouched whatever target is edited, so opening the panel never rewrites it',
    (recipients) => {
      expect(withNotifyOrgUnit(recipients, 'o2')).toBe(recipients);
      expect(withNotifyIncludeDescendants(recipients, true)).toBe(recipients);
      expect(withNotifyPosition(recipients, 'p2')).toBe(recipients);
      expect(withNotifyFormPath(recipients, 'owner')).toBe(recipients);
      expect(withNotifyOrgSource(recipients, 'FORM_FIELD')).toBe(recipients);
      expect(withNotifyNodeIds(recipients, ['a'])).toBe(recipients);
      expect(readNotifySubjectChoice(recipients)).toBeNull();
      expect(readNotifySubjectPick(recipients, '1')).toBeNull();
    },
  );

  it('does not turn a 表單欄位 org manager into a fixed one by picking an organization', () => {
    const recipients: ApproverResolver = {
      formPath: 'dept',
      type: 'FORM_ORG_UNIT_MANAGER',
    };

    expect(withNotifyOrgUnit(recipients, 'o2')).toBe(recipients);
  });

  it.each([
    { nodeIds: ['a'], type: 'NODE_ACTOR' },
    { levelsUp: 1, nodeIds: ['a'], type: 'NODE_ACTOR_MANAGER' },
    { formPath: 'owner', levelsUp: 1, type: 'FORM_MEMBER_MANAGER' },
  ] as const)(
    'a $type source ignores the organization, position and 包含下層 edits',
    (recipients) => {
      expect(withNotifyOrgUnit(recipients, 'o2')).toBe(recipients);
      expect(withNotifyIncludeDescendants(recipients, true)).toBe(recipients);
      expect(withNotifyPosition(recipients, 'p2')).toBe(recipients);
    },
  );
});

describe('notify recipient 依表單欄位指定 with a manager level', () => {
  const MANAGER: ApproverResolver = {
    fallback: { memberId: 'm9', type: 'DIRECT' },
    formPath: 'owner',
    levelsUp: 2,
    preferClosestOrgUnit: false,
    type: 'FORM_MEMBER_MANAGER',
  };

  it('offers 欄位裡的人 and the three manager levels, worded as the approver panel words them', () => {
    const choice = readNotifySubjectChoice(DEFAULT_BY_TYPE['DYNAMIC_FORM']);

    expect(choice?.options.map((option) => option.name)).toEqual([
      '欄位裡的人',
      '直屬主管',
      '第二層主管',
      '第三層主管',
    ]);
    expect(choice?.selected.name).toBe('欄位裡的人');
    expect(readNotifySubjectChoice(MANAGER)?.selected.name).toBe('第二層主管');
  });

  it('picking a manager level stores FORM_MEMBER_MANAGER and keeps the field', () => {
    expect(
      readNotifySubjectPick({ formPath: 'owner', type: 'DYNAMIC_FORM' }, '1'),
    ).toEqual({ formPath: 'owner', levelsUp: 1, type: 'FORM_MEMBER_MANAGER' });
  });

  it('picking 欄位裡的人 again stores DYNAMIC_FORM and drops the manager rule', () => {
    expect(readNotifySubjectPick(MANAGER, '0')).toEqual({
      formPath: 'owner',
      type: 'DYNAMIC_FORM',
    });
  });

  it('writes nothing when the shown choice is picked again or the id is no option', () => {
    expect(readNotifySubjectPick(MANAGER, '2')).toBeNull();
    expect(
      readNotifySubjectPick(DEFAULT_BY_TYPE['DYNAMIC_FORM'], '0'),
    ).toBeNull();
    expect(readNotifySubjectPick(MANAGER, '9')).toBeNull();
    expect(readNotifySubjectPick(MANAGER, null)).toBeNull();
  });

  it('shows a stored level below 1 as invalid and does not offer it again', () => {
    const broken: ApproverResolver = { ...MANAGER, levelsUp: 0 };
    const choice = readNotifySubjectChoice(broken);

    expect(choice?.invalid).toBe(true);
    expect(choice?.selected.name).toBe('第 0 層主管（無效）');
    expect(readNotifySubjectPick(broken, 'invalid:0')).toBeNull();
  });

  it('changes the field of a manager source without touching its level or manager rule', () => {
    expect(withNotifyFormPath(MANAGER, 'boss')).toEqual({
      ...MANAGER,
      formPath: 'boss',
    });
  });

  it('survives a round trip through the screen: same field, same level, same rule', () => {
    expect(withNotifyFormPath(MANAGER, 'owner')).toEqual(MANAGER);

    const toThree = readNotifySubjectPick(MANAGER, '3') as ApproverResolver;

    expect(toThree).toEqual({ ...MANAGER, levelsUp: 3 });
    expect(readNotifySubjectPick(toThree, '2')).toEqual(MANAGER);
  });
});

describe('notify recipient 指定組織主管 with a form-field organization', () => {
  const FORM_ORG: ApproverResolver = {
    fallback: { memberId: 'm9', type: 'DIRECT' },
    formPath: 'dept',
    preferClosestOrgUnit: false,
    type: 'FORM_ORG_UNIT_MANAGER',
  };

  it('switching 固定組織 to 表單欄位 stores FORM_ORG_UNIT_MANAGER with 只取最近一層主管 on, and drops the fixed organization', () => {
    expect(
      withNotifyOrgSource(
        { orgUnitId: 'o1', type: 'ORG_UNIT_MANAGER' },
        'FORM_FIELD',
      ),
    ).toEqual({
      formPath: '',
      preferClosestOrgUnit: true,
      type: 'FORM_ORG_UNIT_MANAGER',
    });
  });

  it('keeps a manager rule the author already chose when the organization source switches', () => {
    expect(
      withNotifyOrgSource(
        {
          fallback: { memberId: 'm9', type: 'DIRECT' },
          orgUnitId: 'o1',
          preferClosestOrgUnit: false,
          type: 'ORG_UNIT_MANAGER',
        },
        'FORM_FIELD',
      ),
    ).toEqual({
      fallback: { memberId: 'm9', type: 'DIRECT' },
      formPath: '',
      preferClosestOrgUnit: false,
      type: 'FORM_ORG_UNIT_MANAGER',
    });
  });

  it('switching 表單欄位 back to 固定組織 stores ORG_UNIT_MANAGER, keeps the rule and drops the field', () => {
    expect(withNotifyOrgSource(FORM_ORG, 'FIXED')).toEqual({
      fallback: { memberId: 'm9', type: 'DIRECT' },
      orgUnitId: '',
      preferClosestOrgUnit: false,
      type: 'ORG_UNIT_MANAGER',
    });
  });

  it('writes nothing when the organization source is already the one picked', () => {
    expect(withNotifyOrgSource(FORM_ORG, 'FORM_FIELD')).toBe(FORM_ORG);
    expect(
      withNotifyOrgSource(DEFAULT_BY_TYPE['ORG_UNIT_MANAGER'], 'FIXED'),
    ).toBe(DEFAULT_BY_TYPE['ORG_UNIT_MANAGER']);
    expect(withNotifyOrgSource(DEFAULT_BY_TYPE['POSITION'], 'FORM_FIELD')).toBe(
      DEFAULT_BY_TYPE['POSITION'],
    );
  });

  it('picks the 組織選擇 field and keeps the manager rule', () => {
    expect(withNotifyFormPath(FORM_ORG, 'region')).toEqual({
      ...FORM_ORG,
      formPath: 'region',
    });
    expect(withNotifyFormPath(FORM_ORG, 'dept')).toEqual(FORM_ORG);
  });

  it('does not write a form field into a fixed organization', () => {
    const fixed: ApproverResolver = {
      orgUnitId: 'o1',
      type: 'ORG_UNIT_MANAGER',
    };

    expect(withNotifyFormPath(fixed, 'dept')).toBe(fixed);
  });

  it('a fixed organization still takes the organization pick and keeps its rule', () => {
    expect(
      withNotifyOrgUnit(
        {
          fallback: { memberId: 'm9', type: 'DIRECT' },
          orgUnitId: 'o1',
          type: 'ORG_UNIT_MANAGER',
        },
        'o2',
      ),
    ).toEqual({
      fallback: { memberId: 'm9', type: 'DIRECT' },
      orgUnitId: 'o2',
      type: 'ORG_UNIT_MANAGER',
    });
  });
});

describe('notify recipient 依前面關卡的簽核者', () => {
  const MANAGER: ApproverResolver = {
    fallback: { positionId: 'p1', type: 'POSITION' },
    levelsUp: 1,
    nodeIds: ['a', 'b'],
    preferClosestOrgUnit: true,
    type: 'NODE_ACTOR_MANAGER',
  };

  it('offers 關卡的簽核者 and the three manager levels', () => {
    const choice = readNotifySubjectChoice(DEFAULT_BY_TYPE['NODE_ACTOR']);

    expect(choice?.options.map((option) => option.name)).toEqual([
      '關卡的簽核者',
      '直屬主管',
      '第二層主管',
      '第三層主管',
    ]);
    expect(choice?.selected.name).toBe('關卡的簽核者');
    expect(readNotifySubjectChoice(MANAGER)?.selected.name).toBe('直屬主管');
  });

  it('picking a manager level stores NODE_ACTOR_MANAGER and keeps the stages', () => {
    expect(
      readNotifySubjectPick({ nodeIds: ['a'], type: 'NODE_ACTOR' }, '2'),
    ).toEqual({ levelsUp: 2, nodeIds: ['a'], type: 'NODE_ACTOR_MANAGER' });
  });

  it('picking 關卡的簽核者 again stores NODE_ACTOR and drops the manager rule', () => {
    expect(readNotifySubjectPick(MANAGER, '0')).toEqual({
      nodeIds: ['a', 'b'],
      type: 'NODE_ACTOR',
    });
  });

  it('picks the stages and keeps the level and manager rule of a manager source', () => {
    expect(withNotifyNodeIds(MANAGER, ['c'])).toEqual({
      ...MANAGER,
      nodeIds: ['c'],
    });
    expect(
      withNotifyNodeIds(DEFAULT_BY_TYPE['NODE_ACTOR'], ['a', 'b']),
    ).toEqual({ nodeIds: ['a', 'b'], type: 'NODE_ACTOR' });
    expect(withNotifyNodeIds(MANAGER, ['a', 'b'])).toEqual(MANAGER);
  });

  it('does not write stages into a source that has none', () => {
    expect(withNotifyNodeIds(DEFAULT_BY_TYPE['DYNAMIC_FORM'], ['a'])).toBe(
      DEFAULT_BY_TYPE['DYNAMIC_FORM'],
    );
  });

  it('has no 知會對象 choice for sources without a person to start from', () => {
    expect(readNotifySubjectChoice(DEFAULT_BY_TYPE['POSITION'])).toBeNull();
    expect(
      readNotifySubjectChoice(DEFAULT_BY_TYPE['ORG_UNIT_MANAGER']),
    ).toBeNull();
    expect(readNotifySubjectPick(DEFAULT_BY_TYPE['POSITION'], '1')).toBeNull();
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

    expect(readNotifyServiceTaskIssue(notifyNode(picked))).toBe(
      '知會節點需要指定組織。',
    );
  });

  it('reports a 指定組織主管 saved without any orgUnitId instead of throwing', () => {
    const node = notifyNode({
      type: 'ORG_UNIT_MANAGER',
    } as unknown as ApproverResolver);

    expect(readNotifyServiceTaskIssue(node)).toBe('知會節點需要指定組織。');
  });

  it.each([
    ['NODE_ACTOR', '知會節點需要指定前面的簽核關卡。'],
    ['DYNAMIC_FORM', '知會節點需要指定知會對象的表單欄位。'],
  ])(
    'a freshly picked %s that then takes a manager level still blocks the draft: %s',
    (type, message) => {
      const picked = readNotifyRecipientSourcePick(
        DEFAULT_BY_TYPE['DIRECT'],
        type,
        [],
      ) as ApproverResolver;
      const withManager = readNotifySubjectPick(
        picked,
        '1',
      ) as ApproverResolver;

      expect(readNotifyServiceTaskIssue(notifyNode(withManager))).toBe(message);
    },
  );

  it('a freshly switched 表單欄位 organization with no field blocks the draft', () => {
    const switched = withNotifyOrgSource(
      DEFAULT_BY_TYPE['ORG_UNIT_MANAGER'],
      'FORM_FIELD',
    );

    expect(switched.type).toBe('FORM_ORG_UNIT_MANAGER');
    expect(readNotifyServiceTaskIssue(notifyNode(switched))).toBe(
      '知會節點需要指定知會對象的表單欄位。',
    );
  });

  it('lets each source the screen writes through once its target is chosen', () => {
    const owner = withNotifyFormPath(
      readNotifySubjectPick(
        DEFAULT_BY_TYPE['DYNAMIC_FORM'],
        '1',
      ) as ApproverResolver,
      'owner',
    );
    const dept = withNotifyFormPath(
      withNotifyOrgSource(DEFAULT_BY_TYPE['ORG_UNIT_MANAGER'], 'FORM_FIELD'),
      'dept',
    );
    const signer = withNotifyNodeIds(
      readNotifySubjectPick(
        DEFAULT_BY_TYPE['NODE_ACTOR'],
        '1',
      ) as ApproverResolver,
      ['a'],
    );

    expect(owner.type).toBe('FORM_MEMBER_MANAGER');
    expect(dept.type).toBe('FORM_ORG_UNIT_MANAGER');
    expect(signer.type).toBe('NODE_ACTOR_MANAGER');
    [
      owner,
      dept,
      signer,
      withNotifyNodeIds(DEFAULT_BY_TYPE['NODE_ACTOR'], ['a']),
    ].forEach((recipients) => {
      expect(readNotifyServiceTaskIssue(notifyNode(recipients))).toBeNull();
    });
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
      expect(readNotifyServiceTaskIssue(notifyNode(recipients))).toBeNull();
    });
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
