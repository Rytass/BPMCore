import {
  NOTIFY_WEBHOOK_CONTEXT_PATHS,
  NOTIFY_WEBHOOK_ENDPOINT_VERSION_MAX,
  NOTIFY_WEBHOOK_TARGET_LIMIT,
  createNotifyWebhookTarget,
  isDecisionPolicyUnsatisfiable,
  isFormFieldCompatibleWithWebhookParameter,
  isNotifyRecipientsEmpty,
  isNotifyWebhookValueCompatibleWithParameter,
  readConditionExpression,
  readConditionOperatorIds,
  readDesignTimeApproverCount,
  readFallbackWorkflowDefinition,
  readNotifyServiceTaskIssue,
  readNotifyWebhookCatalogIssueMessage,
  readNotifyWebhookStructureIssues,
  readNotifyWebhookTargetCatalogIssues,
  readWorkflowDefinitionIssue,
} from './workflow-graph';
import { FormFieldDefinition } from './form';
import {
  ApproverResolver,
  DecisionPolicy,
  NotifyWebhookTarget,
  ServiceAction,
  WorkflowDefinition,
} from './workflow';

const THREE_MEMBERS: ApproverResolver = {
  memberIds: ['m1', 'm2', 'm3'],
  type: 'DIRECT',
};
const ONE_MANAGER: ApproverResolver = {
  baseFromInitiator: true,
  levelsUp: 1,
  type: 'ORG_MANAGER',
};

function quorum(threshold: number, thresholdType: 'COUNT' | 'PERCENTAGE' = 'COUNT'): DecisionPolicy {
  return { threshold, thresholdType, type: 'QUORUM' };
}

function definitionWithUserTask(
  approverResolver: ApproverResolver,
  decisionPolicy: DecisionPolicy,
): WorkflowDefinition {
  const fallback = readFallbackWorkflowDefinition();

  return {
    ...fallback,
    edges: [
      {
        data: {},
        id: 'edge_start_task',
        source: 'start',
        target: 'task',
        type: 'smoothstep',
      },
      {
        data: {},
        id: 'edge_task_end',
        source: 'task',
        target: 'end',
        type: 'smoothstep',
      },
    ],
    nodes: [
      ...fallback.nodes,
      {
        data: {
          allowAddSigner: false,
          allowReject: true,
          allowTransfer: true,
          approverResolver,
          decisionPolicy,
          label: '部門會簽',
          returnBehavior: { allowReturn: true, allowedTargets: 'INITIATOR' },
        },
        id: 'task',
        position: { x: 300, y: 160 },
        type: 'userTask',
      },
    ],
  };
}

describe('readDesignTimeApproverCount', () => {
  it('counts the members a DIRECT resolver carries', () => {
    expect(readDesignTimeApproverCount(THREE_MEMBERS)).toBe(3);
  });

  it('reports an unknown count for every runtime-resolved strategy', () => {
    expect(readDesignTimeApproverCount(ONE_MANAGER)).toBeNull();
    expect(
      readDesignTimeApproverCount({ positionId: 'p1', type: 'POSITION' }),
    ).toBeNull();
  });
});

describe('isDecisionPolicyUnsatisfiable', () => {
  it('flags a COUNT quorum above the direct approver count', () => {
    expect(isDecisionPolicyUnsatisfiable(quorum(4), THREE_MEMBERS)).toBe(true);
  });

  it('accepts a COUNT quorum the direct approvers can meet', () => {
    expect(isDecisionPolicyUnsatisfiable(quorum(3), THREE_MEMBERS)).toBe(false);
  });

  it('never flags a runtime-resolved approver set', () => {
    expect(isDecisionPolicyUnsatisfiable(quorum(9), ONE_MANAGER)).toBe(false);
  });

  it('never flags PERCENTAGE, which cannot exceed the total', () => {
    expect(
      isDecisionPolicyUnsatisfiable(quorum(100, 'PERCENTAGE'), THREE_MEMBERS),
    ).toBe(false);
  });

  it('ignores the non-quorum policies and a missing policy', () => {
    expect(
      isDecisionPolicyUnsatisfiable({ type: 'PARALLEL_ALL' }, THREE_MEMBERS),
    ).toBe(false);
    expect(isDecisionPolicyUnsatisfiable(undefined, THREE_MEMBERS)).toBe(false);
  });
});

describe('readWorkflowDefinitionIssue', () => {
  it('reports the deadlocked node with both numbers', () => {
    const issue = readWorkflowDefinitionIssue(
      definitionWithUserTask(THREE_MEMBERS, quorum(5)),
    );

    expect(issue).toContain('部門會簽');
    expect(issue).toContain('5');
    expect(issue).toContain('3');
  });

  it('stays silent when the quorum is reachable', () => {
    expect(
      readWorkflowDefinitionIssue(
        definitionWithUserTask(THREE_MEMBERS, quorum(2)),
      ),
    ).toBeNull();
  });
});

describe('table field conditions', () => {
  const TABLE_FIELD: FormFieldDefinition = {
    columns: [
      { fieldKey: 'qty', label: 'Quantity', required: true, type: 'number' },
    ],
    fieldKey: 'items',
    label: 'Items',
    required: true,
    type: 'table',
  };
  const TEXT_FIELD: FormFieldDefinition = {
    fieldKey: 'note',
    label: 'Note',
    required: false,
    type: 'text',
  };

  it('offers only emptiness operators for a table', () => {
    expect(readConditionOperatorIds(TABLE_FIELD)).toEqual([
      'IS_FILLED',
      'IS_EMPTY',
    ]);
    expect(readConditionOperatorIds(TEXT_FIELD)).toEqual([
      'EQUALS',
      'NOT_EQUALS',
      'IS_FILLED',
      'IS_EMPTY',
    ]);
  });

  it('compiles table emptiness to a row count, not a string comparison', () => {
    expect(readConditionExpression(TABLE_FIELD, 'IS_FILLED', undefined)).toBe(
      'form.items != null && size(form.items) > 0',
    );
    expect(readConditionExpression(TABLE_FIELD, 'IS_EMPTY', undefined)).toBe(
      'form.items == null || size(form.items) == 0',
    );
    expect(readConditionExpression(TEXT_FIELD, 'IS_FILLED', undefined)).toBe(
      'form.note != null && form.note != ""',
    );
  });

  it('refuses to compile value operators against a table', () => {
    expect(readConditionExpression(TABLE_FIELD, 'EQUALS', '1')).toBeUndefined();
  });
});

const NOBODY: ApproverResolver = { memberIds: [], type: 'DIRECT' };

const ERP_WEBHOOK: NotifyWebhookTarget = {
  bindings: [
    { from: { fieldKey: 'amount', kind: 'FIELD' }, parameter: 'amount' },
    { from: { kind: 'CONSTANT', value: 'PO' }, parameter: 'documentType' },
    { from: { kind: 'CONTEXT', path: 'instance.id' }, parameter: 'caseId' },
  ],
  endpoint: { key: 'erp.purchase-approved', version: 1 },
  id: 'webhook_erp',
};

function notifyAction(
  recipients: ApproverResolver,
  webhooks?: readonly NotifyWebhookTarget[],
): ServiceAction {
  return {
    channels: ['IN_APP'],
    recipients,
    type: 'NOTIFY',
    ...(webhooks ? { webhooks } : {}),
  };
}

function definitionWithNotify(action: ServiceAction): WorkflowDefinition {
  const fallback = readFallbackWorkflowDefinition();

  return {
    ...fallback,
    nodes: [
      ...fallback.nodes,
      {
        data: { action, label: '通知 ERP', triggerMode: 'AND' },
        id: 'notify',
        position: { x: 300, y: 320 },
        type: 'serviceTask',
      },
    ],
  };
}

function field(
  type: FormFieldDefinition['type'],
  extra: Readonly<Record<string, unknown>> = {},
): FormFieldDefinition {
  return {
    fieldKey: 'f',
    label: 'F',
    required: false,
    type,
    ...extra,
  } as FormFieldDefinition;
}

describe('readWorkflowDefinitionIssue — NOTIFY nodes', () => {
  it('requires a recipient or a webhook', () => {
    expect(
      readWorkflowDefinitionIssue(definitionWithNotify(notifyAction(NOBODY))),
    ).toBe('知會節點需要至少一位知會對象或一個 Webhook。');
    expect(
      readWorkflowDefinitionIssue(
        definitionWithNotify(notifyAction(NOBODY, [])),
      ),
    ).toBe('知會節點需要至少一位知會對象或一個 Webhook。');
  });

  it('accepts a webhook-only node', () => {
    expect(
      readWorkflowDefinitionIssue(
        definitionWithNotify(notifyAction(NOBODY, [ERP_WEBHOOK])),
      ),
    ).toBeNull();
  });

  it('accepts a member-only node, as before', () => {
    expect(
      readWorkflowDefinitionIssue(
        definitionWithNotify(notifyAction(THREE_MEMBERS)),
      ),
    ).toBeNull();
  });

  it('no longer reports a configured runtime resolver as missing recipients', () => {
    expect(
      readWorkflowDefinitionIssue(
        definitionWithNotify(
          notifyAction({ positionId: 'p1', type: 'POSITION' }),
        ),
      ),
    ).toBeNull();
    expect(
      readWorkflowDefinitionIssue(
        definitionWithNotify(
          notifyAction({ orgUnitId: 'ou1', type: 'ORG_UNIT_MEMBER' }),
        ),
      ),
    ).toBeNull();
  });

  it('still reports a half-configured runtime resolver, webhooks or not', () => {
    expect(
      readWorkflowDefinitionIssue(
        definitionWithNotify(
          notifyAction({ positionId: ' ', type: 'POSITION' }, [ERP_WEBHOOK]),
        ),
      ),
    ).toBe('知會節點需要指定職位。');
  });

  it('names the node and the webhook position for a webhook problem', () => {
    const issue = readWorkflowDefinitionIssue(
      definitionWithNotify(
        notifyAction(THREE_MEMBERS, [
          ERP_WEBHOOK,
          {
            ...ERP_WEBHOOK,
            endpoint: { key: '', version: 1 },
            id: 'webhook_2',
          },
        ]),
      ),
    );

    expect(issue).toBe('知會節點「通知 ERP」的第 2 個 Webhook需要選擇端點。');
  });
});

describe('readNotifyWebhookStructureIssues', () => {
  function codes(webhooks: unknown): readonly string[] {
    return readNotifyWebhookStructureIssues(webhooks).map(
      (issue) => issue.code,
    );
  }

  it('accepts a missing list, an empty list and a well-formed target', () => {
    expect(codes(undefined)).toEqual([]);
    expect(codes([])).toEqual([]);
    expect(codes([ERP_WEBHOOK])).toEqual([]);
  });

  it('rejects a non-array list and non-object targets', () => {
    expect(codes({})).toEqual(['WEBHOOKS_NOT_ARRAY']);
    expect(codes(null)).toEqual(['WEBHOOKS_NOT_ARRAY']);
    expect(codes(['x'])).toEqual(['TARGET_INVALID']);
  });

  it('caps the number of targets per node', () => {
    const targets = Array.from(
      { length: NOTIFY_WEBHOOK_TARGET_LIMIT + 1 },
      (_, index) => ({ ...ERP_WEBHOOK, id: `webhook_${index}` }),
    );

    expect(codes(targets)).toEqual(['TARGET_LIMIT_EXCEEDED']);
    expect(codes(targets.slice(1))).toEqual([]);
  });

  it('requires a unique, non-blank target id', () => {
    expect(codes([{ ...ERP_WEBHOOK, id: ' ' }])).toEqual([
      'TARGET_ID_REQUIRED',
    ]);
    expect(codes([ERP_WEBHOOK, ERP_WEBHOOK])).toEqual(['TARGET_ID_DUPLICATE']);
    expect(
      readNotifyWebhookStructureIssues([ERP_WEBHOOK, ERP_WEBHOOK])[0]
        ?.targetIndex,
    ).toBe(1);
  });

  it('requires an endpoint key and a positive integer version', () => {
    expect(
      codes([{ ...ERP_WEBHOOK, endpoint: { key: '', version: 1 } }]),
    ).toEqual(['ENDPOINT_KEY_REQUIRED']);
    [0, -1, 1.5, '1', undefined].forEach((version) => {
      expect(
        codes([{ ...ERP_WEBHOOK, endpoint: { key: 'erp', version } }]),
      ).toEqual(['ENDPOINT_VERSION_INVALID']);
    });
    expect(codes([{ ...ERP_WEBHOOK, endpoint: null }])).toEqual([
      'ENDPOINT_KEY_REQUIRED',
      'ENDPOINT_VERSION_INVALID',
    ]);
  });

  it('requires bindings to be a list of objects with a unique parameter', () => {
    expect(codes([{ ...ERP_WEBHOOK, bindings: {} }])).toEqual([
      'BINDINGS_NOT_ARRAY',
    ]);
    expect(codes([{ ...ERP_WEBHOOK, bindings: [1] }])).toEqual([
      'BINDING_INVALID',
    ]);
    expect(
      codes([
        {
          ...ERP_WEBHOOK,
          bindings: [{ from: { kind: 'CONSTANT', value: 1 }, parameter: '' }],
        },
      ]),
    ).toEqual(['BINDING_PARAMETER_REQUIRED']);

    const duplicate = readNotifyWebhookStructureIssues([
      {
        ...ERP_WEBHOOK,
        bindings: [ERP_WEBHOOK.bindings[0], ERP_WEBHOOK.bindings[0]],
      },
    ]);

    expect(duplicate).toEqual([
      {
        bindingIndex: 1,
        code: 'BINDING_PARAMETER_DUPLICATE',
        parameter: 'amount',
        property: null,
        targetIndex: 0,
      },
    ]);
  });

  it('validates each binding source kind', () => {
    function sourceCodes(from: unknown): readonly string[] {
      return codes([{ ...ERP_WEBHOOK, bindings: [{ from, parameter: 'p' }] }]);
    }

    expect(sourceCodes({ fieldKey: ' ', kind: 'FIELD' })).toEqual([
      'BINDING_FIELD_KEY_REQUIRED',
    ]);
    expect(sourceCodes({ kind: 'CONTEXT', path: 'instance.formData' })).toEqual(
      ['BINDING_CONTEXT_PATH_INVALID'],
    );
    expect(sourceCodes({ kind: 'CONSTANT', value: { nested: true } })).toEqual([
      'BINDING_CONSTANT_INVALID',
    ]);
    expect(sourceCodes({ kind: 'CONSTANT', value: Number.NaN })).toEqual([
      'BINDING_CONSTANT_INVALID',
    ]);
    expect(sourceCodes({ kind: 'CONSTANT' })).toEqual([
      'BINDING_CONSTANT_INVALID',
    ]);
    expect(sourceCodes({ kind: 'CEL', expression: 'form.amount' })).toEqual([
      'BINDING_SOURCE_INVALID',
    ]);
    expect(sourceCodes(null)).toEqual(['BINDING_SOURCE_INVALID']);
    expect(sourceCodes({ kind: 'CONSTANT', value: null })).toEqual([]);
    expect(sourceCodes({ kind: 'CONSTANT', value: false })).toEqual([]);
  });
});

describe('isFormFieldCompatibleWithWebhookParameter', () => {
  it('matches each parameter type to the fields whose value fits it', () => {
    expect(
      isFormFieldCompatibleWithWebhookParameter(field('text'), 'string'),
    ).toBe(true);
    expect(
      isFormFieldCompatibleWithWebhookParameter(field('datetime'), 'string'),
    ).toBe(true);
    expect(
      isFormFieldCompatibleWithWebhookParameter(
        field('radio', { options: [] }),
        'string',
      ),
    ).toBe(true);
    expect(
      isFormFieldCompatibleWithWebhookParameter(
        field('select', { options: [] }),
        'string',
      ),
    ).toBe(true);
    expect(
      isFormFieldCompatibleWithWebhookParameter(field('number'), 'string'),
    ).toBe(false);

    expect(
      isFormFieldCompatibleWithWebhookParameter(field('money'), 'number'),
    ).toBe(true);
    expect(
      isFormFieldCompatibleWithWebhookParameter(field('text'), 'number'),
    ).toBe(false);

    expect(
      isFormFieldCompatibleWithWebhookParameter(field('boolean'), 'boolean'),
    ).toBe(true);
    expect(
      isFormFieldCompatibleWithWebhookParameter(
        field('checkbox', { options: [] }),
        'boolean',
      ),
    ).toBe(false);
  });

  it('follows the selection mode of option fields', () => {
    const multiSelect = field('select', { mode: 'multiple', options: [] });
    const checkbox = field('checkbox', { options: [] });

    expect(
      isFormFieldCompatibleWithWebhookParameter(multiSelect, 'stringArray'),
    ).toBe(true);
    expect(
      isFormFieldCompatibleWithWebhookParameter(checkbox, 'stringArray'),
    ).toBe(true);
    expect(
      isFormFieldCompatibleWithWebhookParameter(multiSelect, 'string'),
    ).toBe(false);
    expect(
      isFormFieldCompatibleWithWebhookParameter(
        field('autocomplete', { options: [] }),
        'stringArray',
      ),
    ).toBe(false);
  });

  it('lets json take any field, including tables and uploads', () => {
    expect(
      isFormFieldCompatibleWithWebhookParameter(
        field('table', { columns: [] }),
        'json',
      ),
    ).toBe(true);
    expect(
      isFormFieldCompatibleWithWebhookParameter(field('file_upload'), 'json'),
    ).toBe(true);
    expect(
      isFormFieldCompatibleWithWebhookParameter(
        field('table', { columns: [] }),
        'string',
      ),
    ).toBe(false);
  });
});

describe('isNotifyWebhookValueCompatibleWithParameter', () => {
  it('checks primitive types strictly and lets null through', () => {
    expect(isNotifyWebhookValueCompatibleWithParameter('a', 'string')).toBe(
      true,
    );
    expect(isNotifyWebhookValueCompatibleWithParameter(1, 'string')).toBe(
      false,
    );
    expect(isNotifyWebhookValueCompatibleWithParameter(1, 'number')).toBe(true);
    expect(
      isNotifyWebhookValueCompatibleWithParameter(Infinity, 'number'),
    ).toBe(false);
    expect(isNotifyWebhookValueCompatibleWithParameter(true, 'boolean')).toBe(
      true,
    );
    expect(
      isNotifyWebhookValueCompatibleWithParameter(['a'], 'stringArray'),
    ).toBe(true);
    expect(
      isNotifyWebhookValueCompatibleWithParameter(['a', 1], 'stringArray'),
    ).toBe(false);
    expect(isNotifyWebhookValueCompatibleWithParameter({ a: 1 }, 'json')).toBe(
      true,
    );
    expect(isNotifyWebhookValueCompatibleWithParameter(null, 'number')).toBe(
      true,
    );
  });
});

describe('notify webhook helpers', () => {
  it('creates an empty target with an injected id', () => {
    expect(
      createNotifyWebhookTarget(
        { key: 'erp', version: 2 },
        () => 'webhook_fixed',
      ),
    ).toEqual({
      bindings: [],
      endpoint: { key: 'erp', version: 2 },
      id: 'webhook_fixed',
    });
  });

  it('generates distinct default ids', () => {
    const first = createNotifyWebhookTarget({ key: 'erp', version: 1 });
    const second = createNotifyWebhookTarget({ key: 'erp', version: 1 });

    expect(first.id).toMatch(/^webhook_/);
    expect(first.id).not.toBe(second.id);
  });

  it('treats only a DIRECT resolver without members as empty', () => {
    expect(isNotifyRecipientsEmpty(NOBODY)).toBe(true);
    expect(isNotifyRecipientsEmpty(THREE_MEMBERS)).toBe(false);
    expect(isNotifyRecipientsEmpty(ONE_MANAGER)).toBe(false);
    expect(isNotifyRecipientsEmpty(undefined)).toBe(false);
  });
});

describe('notify webhook hardening', () => {
  function codes(webhooks: unknown): readonly string[] {
    return readNotifyWebhookStructureIssues(webhooks).map(
      (issue) => issue.code,
    );
  }

  it('rejects a URL, headers or any other key the template must not carry', () => {
    const issues = readNotifyWebhookStructureIssues([
      {
        ...ERP_WEBHOOK,
        bindings: [
          {
            from: {
              expression: 'form.amount',
              fieldKey: 'amount',
              kind: 'FIELD',
            },
            label: 'Amount',
            parameter: 'amount',
          },
        ],
        endpoint: { key: 'erp', secret: 's3cr3t', version: 1 },
        headers: { Authorization: 'Bearer x' },
        url: 'https://erp.example.com/hook',
      },
    ]);

    expect(
      issues.map((issue) => [issue.code, issue.bindingIndex, issue.property]),
    ).toEqual([
      ['UNKNOWN_PROPERTY', null, 'headers'],
      ['UNKNOWN_PROPERTY', null, 'url'],
      ['UNKNOWN_PROPERTY', null, 'endpoint.secret'],
      ['UNKNOWN_PROPERTY', 0, 'label'],
      ['UNKNOWN_PROPERTY', 0, 'from.expression'],
    ]);
    expect(
      readWorkflowDefinitionIssue(
        definitionWithNotify(
          notifyAction(THREE_MEMBERS, [
            {
              ...ERP_WEBHOOK,
              url: 'https://erp.example.com/hook',
            } as NotifyWebhookTarget,
          ]),
        ),
      ),
    ).toBe(
      '知會節點「通知 ERP」的第 1 個 Webhook包含不支援的設定「url」，請移除後重新新增。',
    );
  });

  it('only checks source keys against the kind actually declared', () => {
    expect(
      codes([
        {
          ...ERP_WEBHOOK,
          bindings: [{ from: { kind: 'CONSTANT', value: 1 }, parameter: 'p' }],
        },
      ]),
    ).toEqual([]);
    expect(
      codes([
        {
          ...ERP_WEBHOOK,
          bindings: [
            {
              from: { fieldKey: 'a', kind: 'CONSTANT', value: 1 },
              parameter: 'p',
            },
          ],
        },
      ]),
    ).toEqual(['UNKNOWN_PROPERTY']);
  });

  it('caps the endpoint version at the outbox column range', () => {
    expect(
      codes([
        {
          ...ERP_WEBHOOK,
          endpoint: {
            key: 'erp',
            version: NOTIFY_WEBHOOK_ENDPOINT_VERSION_MAX,
          },
        },
      ]),
    ).toEqual([]);
    expect(
      codes([
        {
          ...ERP_WEBHOOK,
          endpoint: {
            key: 'erp',
            version: NOTIFY_WEBHOOK_ENDPOINT_VERSION_MAX + 1,
          },
        },
      ]),
    ).toEqual(['ENDPOINT_VERSION_INVALID']);
  });

  it('compares target ids and parameters after trimming', () => {
    expect(
      codes([ERP_WEBHOOK, { ...ERP_WEBHOOK, id: ' webhook_erp ' }]),
    ).toEqual(['TARGET_ID_DUPLICATE']);
    expect(
      codes([
        {
          ...ERP_WEBHOOK,
          bindings: [
            { from: { kind: 'CONSTANT', value: 1 }, parameter: 'amount' },
            { from: { kind: 'CONSTANT', value: 2 }, parameter: 'amount ' },
          ],
        },
      ]),
    ).toEqual(['BINDING_PARAMETER_DUPLICATE']);
  });

  it('ignores keys holding undefined, which JSON drops anyway', () => {
    expect(
      codes([
        {
          ...ERP_WEBHOOK,
          endpoint: { ...ERP_WEBHOOK.endpoint, secret: undefined },
          url: undefined,
        },
      ]),
    ).toEqual([]);
  });

  it('calls out a malformed recipient resolver on a node that has webhooks', () => {
    const action = {
      channels: ['IN_APP'],
      recipients: null,
      type: 'NOTIFY',
      webhooks: [ERP_WEBHOOK],
    } as unknown as ServiceAction;

    expect(readWorkflowDefinitionIssue(definitionWithNotify(action))).toBe(
      '知會節點的知會對象設定格式錯誤。',
    );
  });

  it('reports missing recipients instead of throwing', () => {
    const action = {
      channels: ['IN_APP'],
      recipients: null,
      type: 'NOTIFY',
    } as unknown as ServiceAction;

    expect(readWorkflowDefinitionIssue(definitionWithNotify(action))).toBe(
      '知會節點需要至少一位知會對象或一個 Webhook。',
    );
  });

  it('ignores nodes that are not NOTIFY service tasks', () => {
    const [start] = readFallbackWorkflowDefinition().nodes;

    expect(start && readNotifyServiceTaskIssue(start)).toBeNull();
  });

  it('lists every context path exactly once', () => {
    expect([...NOTIFY_WEBHOOK_CONTEXT_PATHS].sort()).toEqual([
      'initiator.memberId',
      'instance.id',
      'instance.templateId',
      'instance.templateVersionId',
      'instance.title',
      'node.id',
      'node.label',
    ]);
  });
});

describe('readNotifyWebhookTargetCatalogIssues', () => {
  const endpoint = {
    parameters: [
      { key: 'amount', required: true, type: 'number' as const },
      { key: 'title', required: false, type: 'string' as const },
      { key: 'urgent', required: false, type: 'boolean' as const },
    ],
  };
  const formFields = [
    field('money', { fieldKey: 'total' }),
    field('text', { fieldKey: 'note' }),
  ];

  function target(
    bindings: NotifyWebhookTarget['bindings'],
  ): NotifyWebhookTarget {
    return { bindings, endpoint: { key: 'erp.po', version: 1 }, id: 'wh' };
  }

  it('reports only the endpoint when it is missing or deprecated', () => {
    const bindings: NotifyWebhookTarget['bindings'] = [
      { from: { kind: 'CONSTANT', value: 'x' }, parameter: 'nope' },
    ];

    expect(
      readNotifyWebhookTargetCatalogIssues({
        endpoint: null,
        formFields,
        target: target(bindings),
      }).map((issue) => issue.code),
    ).toEqual(['ENDPOINT_MISSING']);
    expect(
      readNotifyWebhookTargetCatalogIssues({
        endpoint: { ...endpoint, deprecated: true },
        formFields,
        target: target(bindings),
      }).map((issue) => issue.code),
    ).toEqual(['ENDPOINT_DEPRECATED']);
    expect(
      readNotifyWebhookTargetCatalogIssues({
        endpoint: { ...endpoint, deprecated: true, disabled: true },
        formFields,
        target: target(bindings),
      }).map((issue) => issue.code),
    ).toEqual(['ENDPOINT_DISABLED']);
  });

  it('passes a target whose bindings fit the endpoint and the form', () => {
    expect(
      readNotifyWebhookTargetCatalogIssues({
        endpoint,
        formFields,
        target: target([
          { from: { fieldKey: 'total', kind: 'FIELD' }, parameter: 'amount' },
          {
            from: { kind: 'CONTEXT', path: 'instance.title' },
            parameter: 'title',
          },
          { from: { kind: 'CONSTANT', value: true }, parameter: 'urgent' },
        ]),
      }),
    ).toEqual([]);
  });

  it('reports each rule the backend publish lint enforces', () => {
    const codes = (
      bindings: NotifyWebhookTarget['bindings'],
    ): readonly string[] =>
      readNotifyWebhookTargetCatalogIssues({
        endpoint,
        formFields,
        target: target(bindings),
      }).map((issue) => issue.code);

    expect(codes([])).toEqual(['PARAMETER_REQUIRED']);
    expect(
      codes([
        { from: { fieldKey: 'total', kind: 'FIELD' }, parameter: 'amount' },
        { from: { kind: 'CONSTANT', value: 1 }, parameter: 'ghost' },
      ]),
    ).toEqual(['PARAMETER_UNKNOWN']);
    expect(
      codes([
        { from: { fieldKey: 'gone', kind: 'FIELD' }, parameter: 'amount' },
      ]),
    ).toEqual(['FIELD_MISSING']);
    expect(
      codes([
        { from: { fieldKey: 'note', kind: 'FIELD' }, parameter: 'amount' },
      ]),
    ).toEqual(['FIELD_INCOMPATIBLE']);
    expect(
      codes([{ from: { kind: 'CONSTANT', value: null }, parameter: 'amount' }]),
    ).toEqual(['CONSTANT_REQUIRED_NULL']);
    expect(
      codes([
        { from: { kind: 'CONSTANT', value: 'many' }, parameter: 'amount' },
      ]),
    ).toEqual(['CONSTANT_INCOMPATIBLE']);
    expect(
      codes([
        { from: { kind: 'CONTEXT', path: 'instance.id' }, parameter: 'amount' },
      ]),
    ).toEqual(['CONTEXT_INCOMPATIBLE']);
  });

  it('words an issue for the designer with the node, position and endpoint', () => {
    const [issue] = readNotifyWebhookTargetCatalogIssues({
      endpoint,
      formFields,
      target: target([]),
    });

    expect(
      readNotifyWebhookCatalogIssueMessage({
        endpointLabel: 'ERP 採購單',
        issue: issue as NonNullable<typeof issue>,
        nodeLabel: '通知 ERP',
        targetIndex: 1,
      }),
    ).toBe(
      '知會節點「通知 ERP」的第 2 個 Webhook（ERP 採購單）的必填參數「amount」尚未設定。',
    );
  });
});
