import type { WorkflowDefinition } from '@rytass/bpm-core-shared/workflow';
import {
  WORKFLOW_EXPRESSION_LABELS,
  WORKFLOW_LINT_MESSAGES,
} from '@rytass/bpm-core-shared/workflow-graph';
import {
  readWorkflowLintMessage,
  type WorkflowLintLanguage,
} from './workflow-lint-errors';

// The English lines below are the backend lint output verbatim
// (`libs/bpm-core/src/lib/template/workflow-definition.validator.ts`), joined
// with `'; '` the way `validatePublishableVersion` throws them.
const definition = {
  edges: [
    {
      data: {},
      id: 'edge-start',
      source: 'start',
      target: 'exclusiveGateway_1',
    },
    {
      data: { isDefault: true },
      id: 'edge-default',
      source: 'exclusiveGateway_1',
      target: 'end',
    },
    {
      data: {},
      id: 'edge-notify',
      source: 'serviceTask_1',
      target: 'end',
    },
  ],
  meta: { schemaVersion: 1 },
  nodes: [
    {
      data: { label: '開始' },
      id: 'start',
      position: { x: 0, y: 0 },
      type: 'startEvent',
    },
    {
      data: { direction: 'split', label: '金額判斷' },
      id: 'exclusiveGateway_1',
      position: { x: 0, y: 0 },
      type: 'exclusiveGateway',
    },
    {
      data: { direction: 'split', label: '  ' },
      id: 'exclusiveGateway_2',
      position: { x: 0, y: 0 },
      type: 'exclusiveGateway',
    },
    {
      data: { direction: 'join', label: '會簽匯合' },
      id: 'parallelGateway_1',
      position: { x: 0, y: 0 },
      type: 'parallelGateway',
    },
    {
      data: { label: '主管簽核' },
      id: 'userTask_1',
      position: { x: 0, y: 0 },
      type: 'userTask',
    },
    {
      data: {
        action: {
          recipients: { memberIds: ['m1'], type: 'DIRECT' },
          type: 'NOTIFY',
        },
        label: '通知財務',
      },
      id: 'serviceTask_1',
      position: { x: 0, y: 0 },
      type: 'serviceTask',
    },
    {
      data: { endState: 'APPROVED', label: '完成' },
      id: 'end',
      position: { x: 0, y: 0 },
      type: 'endEvent',
    },
  ],
} as unknown as WorkflowDefinition;

describe('readWorkflowLintMessage', (): void => {
  it('names the gateway that has fewer than two outgoing edges', (): void => {
    const message = readWorkflowLintMessage(
      'workflow.nodes.exclusiveGateway_1 exclusive split requires at least two outgoing edges',
      definition,
    );

    expect(message).toBe(
      '條件分流「金額判斷」往下至少要有兩條連線，且其中一條要開啟「其他情況走這條」。',
    );
    expect(message).not.toContain('exclusiveGateway_1');
  });

  it('names the gateway that has no default outgoing edge', (): void => {
    const message = readWorkflowLintMessage(
      'workflow.nodes.exclusiveGateway_1 must include a default outgoing edge',
      definition,
    );

    expect(message).toBe(
      '條件分流「金額判斷」的輸出連線中，要有一條開啟「其他情況走這條」，其他條件都不符合時流程才有路可走。',
    );
    expect(message).not.toContain('exclusiveGateway_1');
  });

  it('translates every line of a joined publish failure', (): void => {
    expect(
      readWorkflowLintMessage(
        [
          'workflow.nodes.exclusiveGateway_1 exclusive split requires at least two outgoing edges',
          'workflow.nodes.exclusiveGateway_1 must include a default outgoing edge',
          'workflow.nodes.parallelGateway_1 parallel join requires at least two incoming edges',
          'workflow.edges.edge-notify.source cannot be a NOTIFY serviceTask',
        ].join('; '),
        definition,
      ),
    ).toBe(
      [
        '條件分流「金額判斷」往下至少要有兩條連線，且其中一條要開啟「其他情況走這條」。',
        '條件分流「金額判斷」的輸出連線中，要有一條開啟「其他情況走這條」，其他條件都不符合時流程才有路可走。',
        '並行處理「會簽匯合」至少要有兩條連線匯入。',
        '知會節點「通知財務」不能往下接連線（知會只負責通知，流程不會從它繼續）。請刪除從它拉出的連線。',
      ].join('; '),
    );
  });

  it('translates the reachability, cycle and start/end lines', (): void => {
    expect(
      readWorkflowLintMessage(
        [
          'workflow.nodes.userTask_1 is not reachable from start',
          'workflow.nodes.userTask_1 does not have a path to an endEvent',
          'workflow contains a cycle involving node userTask_1',
          'workflow must include exactly one startEvent node',
          'workflow must include at least one endEvent node',
        ].join('; '),
        definition,
      ),
    ).toBe(
      [
        '從「開始」走不到節點「主管簽核」，流程永遠不會到這一關。請確認從「開始」一路都有連線接到它。',
        '節點「主管簽核」往下接不到「結束」，流程走到這裡會卡住。請從它拉一條連線到下一個節點或「結束」。',
        '節點「主管簽核」所在的連線繞成了迴圈，流程會一直繞回來。請移除造成迴圈的那條連線。',
        '流程必須有一個「開始」節點，而且只能有一個。',
        '流程至少要有一個「結束」節點。',
      ].join('; '),
    );
  });

  it('names a node with a blank label by its type, not its array index', (): void => {
    // The designer lets the 顯示名稱 field be cleared and only the publish lint
    // rejects it, by index — `nodes[2]` is the blank exclusive split above.
    const message = readWorkflowLintMessage(
      'workflow.nodes[2].data.label must be a non-empty string',
      definition,
    );

    expect(message).toBe(
      '有一個「條件分流」節點沒有顯示名稱。請點選該節點，在「顯示名稱」填入名稱後再發布。',
    );
    expect(message).not.toContain('nodes[2]');
  });

  it('names a node without data by its type instead of throwing', (): void => {
    const withoutData = {
      ...definition,
      nodes: [
        ...definition.nodes,
        { id: 'userTask_2', position: { x: 0, y: 0 }, type: 'userTask' },
        { data: {}, id: 'odd_1', position: { x: 0, y: 0 }, type: 'oddType' },
      ],
    } as unknown as WorkflowDefinition;

    expect(
      readWorkflowLintMessage(
        [
          'workflow.nodes.userTask_2 is not reachable from start',
          'workflow.nodes.odd_1 is not reachable from start',
        ].join('; '),
        withoutData,
      ),
    ).toBe(
      [
        '從「開始」走不到節點「簽核」，流程永遠不會到這一關。請確認從「開始」一路都有連線接到它。',
        '從「開始」走不到節點「未知類型」，流程永遠不會到這一關。請確認從「開始」一路都有連線接到它。',
      ].join('; '),
    );
  });

  it('keeps the backend message when the definition cannot be read', (): void => {
    // Drafts are not linted on save, so a malformed one can reach publish;
    // the translation must fall back rather than throw inside the caller's
    // error handler and leave no error on screen.
    const malformed = {
      edges: [],
      meta: { schemaVersion: 1 },
      nodes: [null],
    } as unknown as WorkflowDefinition;
    const backend =
      'workflow.nodes[0].id must be a non-empty string; workflow.nodes[0].data.label must be a non-empty string';

    expect(readWorkflowLintMessage(backend, malformed)).toBe(backend);
  });

  it('leaves lines it does not know exactly as the backend wrote them', (): void => {
    const untouched = [
      'workflow.nodes.userTask_1.approverResolver is required',
      'edge edge-default condition: Syntax error: mismatched input',
      'WORKFLOW_WEBHOOK_ENDPOINT_DISABLED',
    ].join('; ');

    expect(readWorkflowLintMessage(untouched, definition)).toBe(untouched);
  });

  it('does not translate a node id that is not in the submitted definition', (): void => {
    const foreign =
      'workflow.nodes.exclusiveGateway_9 must include a default outgoing edge';

    expect(readWorkflowLintMessage(foreign, definition)).toBe(foreign);
    expect(readWorkflowLintMessage(foreign, null)).toBe(foreign);
  });

  it('writes the same lines in English when asked', (): void => {
    expect(
      readWorkflowLintMessage(
        [
          'workflow.nodes.exclusiveGateway_1 must include a default outgoing edge',
          'workflow.nodes[2].data.label must be a non-empty string',
          'workflow must include at least one endEvent node',
          'workflow.edges.edge-notify.source cannot be a NOTIFY serviceTask',
        ].join('; '),
        definition,
        'en',
      ),
    ).toBe(
      [
        'One outgoing connection of the condition split "金額判斷" must have "Otherwise take this path" (其他情況走這條) turned on, so the flow has somewhere to go when no condition matches.',
        'A "Condition split (條件分流)" node has no display name. Select it, fill in "Display name" (顯示名稱), then publish again.',
        'The flow needs at least one "End" (結束) node.',
        'The notify node "通知財務" cannot have outgoing connections (it only sends a notice; the flow does not continue from it). Delete the connection leaving it.',
      ].join('; '),
    );
  });

  it('falls back to Chinese for a language it does not have', (): void => {
    expect(
      readWorkflowLintMessage(
        'workflow must include at least one endEvent node',
        definition,
        'ja' as WorkflowLintLanguage,
      ),
    ).toBe('流程至少要有一個「結束」節點。');
  });

  it('still translates the readable nodes when one entry is malformed', (): void => {
    // Only the broken entry loses its translation; its index still counts, so
    // the shape lint's `nodes[2]` keeps pointing at the node it named.
    const partlyBroken = {
      ...definition,
      edges: [...definition.edges, null, { id: 7, source: 'start' }],
      nodes: [null, { id: 42 }, ...definition.nodes.slice(2)],
    } as unknown as WorkflowDefinition;

    expect(
      readWorkflowLintMessage(
        [
          'workflow.nodes[0].id must be a non-empty string',
          'workflow.nodes[2].data.label must be a non-empty string',
          'workflow.nodes.userTask_1 is not reachable from start',
        ].join('; '),
        partlyBroken,
      ),
    ).toBe(
      [
        'workflow.nodes[0].id must be a non-empty string',
        '有一個「條件分流」節點沒有顯示名稱。請點選該節點，在「顯示名稱」填入名稱後再發布。',
        '從「開始」走不到節點「主管簽核」，流程永遠不會到這一關。請確認從「開始」一路都有連線接到它。',
      ].join('; '),
    );
  });

  it('names a node whose type is an Object prototype key as unknown', (): void => {
    const prototypeType = {
      ...definition,
      nodes: [
        ...definition.nodes,
        {
          data: {},
          id: 'odd_2',
          position: { x: 0, y: 0 },
          type: 'constructor',
        },
      ],
    } as unknown as WorkflowDefinition;

    expect(
      readWorkflowLintMessage(
        'workflow.nodes.odd_2 is not reachable from start',
        prototypeType,
      ),
    ).toBe(
      '從「開始」走不到節點「未知類型」，流程永遠不會到這一關。請確認從「開始」一路都有連線接到它。',
    );
  });

  it('names the first node when two share an id', (): void => {
    const duplicated = {
      ...definition,
      nodes: [
        ...definition.nodes,
        {
          data: { label: '重複的知會' },
          id: 'serviceTask_1',
          position: { x: 0, y: 0 },
          type: 'serviceTask',
        },
      ],
    } as unknown as WorkflowDefinition;

    expect(
      readWorkflowLintMessage(
        [
          'workflow.edges.edge-notify.source cannot be a NOTIFY serviceTask',
          'workflow.nodes.serviceTask_1 is not reachable from start',
        ].join('; '),
        duplicated,
      ),
    ).toBe(
      [
        '知會節點「通知財務」不能往下接連線（知會只負責通知，流程不會從它繼續）。請刪除從它拉出的連線。',
        '從「開始」走不到節點「通知財務」，流程永遠不會到這一關。請確認從「開始」一路都有連線接到它。',
      ].join('; '),
    );
  });

  it('keeps the backend message when reading the definition throws', (): void => {
    const throwing = {
      ...definition,
      nodes: [
        {
          get id(): string {
            throw new Error('unreadable draft');
          },
        },
      ],
    } as unknown as WorkflowDefinition;
    const backend = 'workflow must include at least one endEvent node';

    expect(readWorkflowLintMessage(backend, throwing)).toBe(backend);
  });
});

describe('readWorkflowLintMessage: field access', (): void => {
  const fieldDefinition = {
    edges: [],
    meta: { schemaVersion: 1 },
    nodes: [
      {
        data: {
          fieldAccess: [
            { display: 'SHOW', fieldKey: 'amount', fill: 'OPTIONAL' },
            { display: 'HIDE', fieldKey: 'note', fill: 'REQUIRED' },
          ],
          label: '財務補填',
        },
        id: 'userTask_fill',
        position: { x: 0, y: 0 },
        type: 'userTask',
      },
      {
        data: {
          action: {
            fieldPath: 'items[0].price',
            type: 'SET_FORM_FIELD',
            value: '"1"',
          },
          label: '回寫金額',
        },
        id: 'serviceTask_set',
        position: { x: 0, y: 0 },
        type: 'serviceTask',
      },
    ],
  } as unknown as WorkflowDefinition;

  // [backend line, zh-TW, en]
  const cases: readonly (readonly [string, string, string])[] = [
    [
      'workflow.nodes.userTask_fill.fieldPermissions is no longer supported: remove it and use fieldAccess instead',
      '簽核節點「財務補填」還帶著從未生效的舊設定「fieldPermissions」。請先移除（設計器支援前請透過 API 移除），再重新設定欄位。',
      'The approval node "財務補填" still carries the old "fieldPermissions" setting, which never took effect. Remove it from the node (through the API until the designer can) and set the fields again.',
    ],
    [
      'workflow.nodes.userTask_fill.fieldAccess is invalid',
      '簽核節點「財務補填」的欄位設定格式不正確，請在設計器重新設定。',
      'The field settings of the approval node "財務補填" are malformed. Open the node in the designer and set them again.',
    ],
    [
      'workflow.nodes.userTask_fill.fieldAccess lists a field more than once: amount',
      '簽核節點「財務補填」重複設定了欄位「amount」。',
      'The approval node "財務補填" sets the field "amount" more than once. Keep one setting per field.',
    ],
    [
      'workflow.nodes.userTask_fill.fieldAccess cannot let a field be filled in while it is hidden: note',
      '簽核節點「財務補填」把欄位「note」設成補填卻又隱藏，請改成顯示，或取消這一關的補填。',
      'The approval node "財務補填" has the field "note" filled in but hidden. Show it, or stop filling it in at this node.',
    ],
    [
      'workflow.nodes.userTask_fill.fieldAccess cannot make fields fillable on a PARALLEL_ALL or QUORUM node',
      '簽核節點「財務補填」是會簽（全部同意／過半數），不能設定補填欄位，否則多人同時填寫會互相覆蓋。',
      'The approval node "財務補填" is a joint approval (everyone / a quorum must approve), so it cannot have fields to fill in; several people filling in at once would overwrite each other.',
    ],
    [
      'workflow.nodes.userTask_fill.sla.onTimeout cannot be AUTO_APPROVE on a node with fillable fields',
      '簽核節點「財務補填」有補填欄位，逾時處理不能選「自動核准」，自動核准不會補填。',
      'The approval node "財務補填" has fields to fill in, so its timeout action cannot be "Auto approve" (自動核准); auto approval would not fill them in.',
    ],
    [
      'workflow.nodes.userTask_fill.excludeInitiator.whenEmpty cannot be SKIP_NODE on a node with fillable fields',
      '簽核節點「財務補填」有補填欄位，「申請人不能自簽」的無人可簽處理不能選「跳過此關」，否則這張單沒有人補填就核准了。',
      'The approval node "財務補填" has fields to fill in, so what "Initiator cannot self-approve" (申請人不能自簽) does when nobody is left to sign cannot be "Skip this step" (跳過此關); otherwise the case would be approved with nobody filling them in.',
    ],
    [
      'workflow.nodes.serviceTask_set.action.fieldPath cannot write a field an approver fills in: items',
      '系統節點「回寫金額」不能寫入由簽核人補填的欄位「items」。',
      'The system node "回寫金額" cannot write the field "items", which an approver fills in.',
    ],
  ];

  it.each(cases)(
    'writes %s in Chinese',
    (backend, zhTw): void => {
      expect(readWorkflowLintMessage(backend, fieldDefinition)).toBe(zhTw);
    },
  );

  it.each(cases)('writes %s in English', (backend, _zhTw, en): void => {
    expect(readWorkflowLintMessage(backend, fieldDefinition, 'en')).toBe(en);
  });

  it('keeps a field access line whose node is not in the definition', (): void => {
    const foreign =
      'workflow.nodes.userTask_9.fieldAccess lists a field more than once: amount';

    expect(readWorkflowLintMessage(foreign, fieldDefinition)).toBe(foreign);
  });

  it('keeps a hidden-fill line for a field the node does not list', (): void => {
    const foreign =
      'workflow.nodes.userTask_fill.fieldAccess cannot let a field be filled in while it is hidden: other';

    expect(readWorkflowLintMessage(foreign, fieldDefinition)).toBe(foreign);
  });

  it('does not throw on drafts with malformed field access or actions', (): void => {
    const lines = [
      'workflow.nodes.userTask_a.fieldAccess is invalid',
      'workflow.nodes.userTask_b.fieldAccess is invalid',
      'workflow.nodes.userTask_d.fieldAccess lists a field more than once: amount',
      'workflow.nodes.serviceTask_a.action.fieldPath cannot write a field an approver fills in: amount',
    ].join('; ');
    const badDraft = {
      edges: [],
      meta: { schemaVersion: 1 },
      nodes: [
        {
          data: { fieldAccess: 'amount', label: '非陣列' },
          id: 'userTask_a',
          position: { x: 0, y: 0 },
          type: 'userTask',
        },
        {
          data: { fieldAccess: [null, 7, { fieldKey: 3 }], label: '壞項目' },
          id: 'userTask_b',
          position: { x: 0, y: 0 },
          type: 'userTask',
        },
        { id: 'userTask_c', position: { x: 0, y: 0 }, type: 'userTask' },
        {
          data: {
            fieldAccess: [
              { display: 'SHOW', fieldKey: 'amount', fill: 'OPTIONAL' },
              { display: 'SHOW', fieldKey: 'amount', fill: 'OPTIONAL' },
            ],
            label: '重複',
          },
          id: 'userTask_d',
          position: { x: 0, y: 0 },
          type: 'userTask',
        },
        {
          data: { action: null, label: '沒有動作' },
          id: 'serviceTask_a',
          position: { x: 0, y: 0 },
          type: 'serviceTask',
        },
        {
          data: { action: { fieldPath: 5, type: 'SET_FORM_FIELD' }, label: '壞路徑' },
          id: 'serviceTask_b',
          position: { x: 0, y: 0 },
          type: 'serviceTask',
        },
        { id: 'serviceTask_c', position: { x: 0, y: 0 }, type: 'serviceTask' },
      ],
    } as unknown as WorkflowDefinition;

    expect(readWorkflowLintMessage(lines, badDraft)).toBe(
      [
        '簽核節點「非陣列」的欄位設定格式不正確，請在設計器重新設定。',
        '簽核節點「壞項目」的欄位設定格式不正確，請在設計器重新設定。',
        '簽核節點「重複」重複設定了欄位「amount」。',
        // A node without a readable SET_FORM_FIELD action has nothing to name.
        'workflow.nodes.serviceTask_a.action.fieldPath cannot write a field an approver fills in: amount',
      ].join('; '),
    );
  });
});

describe('readWorkflowLintMessage: approver-filled fields', (): void => {
  const fillDefinition = {
    edges: [],
    meta: { schemaVersion: 1 },
    nodes: [
      {
        data: {
          fieldAccess: [
            { display: 'SHOW', fieldKey: 'invoiceKind', fill: 'OPTIONAL' },
            { display: 'SHOW', fieldKey: 'items', fill: 'OPTIONAL' },
            { display: 'SHOW', fieldKey: 'ghost', fill: 'OPTIONAL' },
            { display: 'SHOW', fieldKey: 'taxFree', fill: 'REQUIRED' },
          ],
          label: '財務補填',
        },
        id: 'userTask_fill',
        position: { x: 0, y: 0 },
        type: 'userTask',
      },
      {
        data: {
          fieldAccess: [
            { display: 'SHOW', fieldKey: 'invoiceKind', fill: 'OPTIONAL' },
          ],
          label: '會計補填',
        },
        id: 'userTask_again',
        position: { x: 0, y: 0 },
        type: 'userTask',
      },
    ],
  } as unknown as WorkflowDefinition;

  // [backend line, zh-TW, en]
  const cases: readonly (readonly [string, string, string])[] = [
    [
      'workflow.nodes.userTask_fill.fieldAccess must name a field of the bound form: ghost',
      '簽核節點「財務補填」的欄位設定指定了表單第一層沒有的欄位「ghost」（表格整張一起設定）。',
      'The field settings of the approval node "財務補填" name the field "ghost", which is not a top-level field of the bound form (a table is set as a whole).',
    ],
    [
      'workflow.nodes.userTask_fill.fieldAccess cannot require the boolean field: taxFree',
      '簽核節點「財務補填」把開關欄位「taxFree」設成補填（必填）；開關關著也是答案，不能要求必填。',
      'The approval node "財務補填" marks the switch field (開關) "taxFree" as required to fill in. A switch left off is still an answer, so it cannot be required.',
    ],
    [
      'formData.invoiceKind is filled in by both workflow.nodes.userTask_fill and workflow.nodes.userTask_again, which lie on the same path',
      '欄位「invoiceKind」在「財務補填」與「會計補填」都設為補填，兩關在同一張單都會執行，後填的會覆寫先填的。同一條路徑只能保留一個補填關卡。',
      'The field "invoiceKind" is filled in at both "財務補填" and "會計補填", which can both run in one case, so the later approver would overwrite the earlier one. Keep one fill-in node per path.',
    ],
    [
      'formData.purpose.visibleWhen reads formData.invoiceKind, which an approver fills in after the applicant submits',
      '欄位「purpose」的「條件顯示」讀取了「invoiceKind」，但它由簽核人在送出後才補填，申請時永遠是空的。請改用申請人填寫的欄位。',
      'The "Visible when" (條件顯示) rule of the field "purpose" reads "invoiceKind", which an approver fills in after the applicant submits, so the rule would always see it empty.',
    ],
    [
      'formData.amount.requiredWhen reads formData.taxFree, which an approver fills in after the applicant submits',
      '欄位「amount」的「條件必填」讀取了「taxFree」，但它由簽核人在送出後才補填，申請時永遠是空的。請改用申請人填寫的欄位。',
      'The "Required when" (條件必填) rule of the field "amount" reads "taxFree", which an approver fills in after the applicant submits, so the rule would always see it empty.',
    ],
    [
      'formData.amount.readonlyWhen reads formData.items, which an approver fills in after the applicant submits',
      '欄位「amount」的「條件唯讀」讀取了「items」，但它由簽核人在送出後才補填，申請時永遠是空的。請改用申請人填寫的欄位。',
      'The "Read-only when" (條件唯讀) rule of the field "amount" reads "items", which an approver fills in after the applicant submits, so the rule would always see it empty.',
    ],
    [
      'formData.invoiceKind is filled in by an approver, so the form cannot set required on it',
      '欄位「invoiceKind」由簽核人補填，表單不能設定「必填」。',
      'The field "invoiceKind" is filled in by an approver, so the form cannot set "Required" (必填) on it.',
    ],
    [
      'formData.invoiceKind is filled in by an approver, so the form cannot set requiredWhen on it',
      '欄位「invoiceKind」由簽核人補填，表單不能設定「條件必填」。',
      'The field "invoiceKind" is filled in by an approver, so the form cannot set "Required when" (條件必填) on it.',
    ],
    [
      'formData.invoiceKind is filled in by an approver, so the form cannot set visibleWhen on it',
      '欄位「invoiceKind」由簽核人補填，表單不能設定「條件顯示」。',
      'The field "invoiceKind" is filled in by an approver, so the form cannot set "Visible when" (條件顯示) on it.',
    ],
    [
      'formData.invoiceKind is filled in by an approver, so the form cannot set readonlyWhen on it',
      '欄位「invoiceKind」由簽核人補填，表單不能設定「條件唯讀」。',
      'The field "invoiceKind" is filled in by an approver, so the form cannot set "Read-only when" (條件唯讀) on it.',
    ],
    [
      'formData.invoiceKind is filled in by an approver, so the form cannot set hidden on it',
      '欄位「invoiceKind」由簽核人補填，表單不能設定「只存不顯示」。',
      'The field "invoiceKind" is filled in by an approver, so the form cannot set "Store only, not shown" (只存不顯示) on it.',
    ],
    [
      'formData.invoiceKind is filled in by an approver, so the form cannot set defaultValue on it',
      '欄位「invoiceKind」由簽核人補填，表單不能設定「預設值」。',
      'The field "invoiceKind" is filled in by an approver, so the form cannot set "Default value" (預設值) on it.',
    ],
    [
      'formData.invoiceKind is filled in by an approver, so it cannot be a data-source field',
      '欄位「invoiceKind」由簽核人補填，不能使用「選項來源」。',
      'The field "invoiceKind" is filled in by an approver, so it cannot use an option source (選項來源).',
    ],
    [
      'formData.invoiceKind is filled in by an approver, so it cannot be a file upload field',
      '欄位「invoiceKind」由簽核人補填，不能是「附件」欄位。',
      'The field "invoiceKind" is filled in by an approver, so it cannot be an attachment (附件) field.',
    ],
    [
      'formData.items is filled in by an approver, so its table cannot have a data-source column',
      '表格「items」由簽核人補填，表格裡不能有使用「選項來源」的欄位。',
      'The table "items" is filled in by an approver, so it cannot have a column that uses an option source (選項來源).',
    ],
  ];

  it.each(cases)('writes %s in Chinese', (backend, zhTw): void => {
    expect(readWorkflowLintMessage(backend, fillDefinition)).toBe(zhTw);
  });

  it.each(cases)('writes %s in English', (backend, _zhTw, en): void => {
    expect(readWorkflowLintMessage(backend, fillDefinition, 'en')).toBe(en);
  });

  it('keeps a field line whose field no approver fills in', (): void => {
    const foreign =
      'formData.other is filled in by an approver, so the form cannot set hidden on it';

    expect(readWorkflowLintMessage(foreign, fillDefinition)).toBe(foreign);
  });

  it('keeps a line that names a node outside the definition', (): void => {
    const foreign =
      'workflow.nodes.userTask_9.fieldAccess cannot require the boolean field: taxFree';

    expect(readWorkflowLintMessage(foreign, fillDefinition)).toBe(foreign);
  });

  it('keeps a same-path line whose nodes are named out of node order', (): void => {
    const foreign =
      'formData.invoiceKind is filled in by both workflow.nodes.userTask_again and workflow.nodes.userTask_fill, which lie on the same path';

    expect(readWorkflowLintMessage(foreign, fillDefinition)).toBe(foreign);
  });

  it.each([
    // The read field is not filled in by any approver.
    'formData.purpose.visibleWhen reads formData.amount, which an approver fills in after the applicant submits',
    // Not a form rule the applicant check reports.
    'formData.purpose.defaultValue reads formData.invoiceKind, which an approver fills in after the applicant submits',
    // The applicant's field is not a field key.
    'formData.bad key.visibleWhen reads formData.invoiceKind, which an approver fills in after the applicant submits',
    // Same wording with something appended: whole lines only.
    'formData.purpose.visibleWhen reads formData.invoiceKind, which an approver fills in after the applicant submits (again)',
  ])('keeps the applicant-rule look-alike %s', (foreign): void => {
    expect(readWorkflowLintMessage(foreign, fillDefinition)).toBe(foreign);
  });

  it('translates the lines it can read and leaves the rest raw when other nodes are malformed', (): void => {
    const rawLines = [
      'workflow.nodes.userTask_a.fieldAccess must name a field of the bound form: amount',
      'workflow.nodes.userTask_c.fieldAccess is invalid',
    ];
    const translatable =
      'formData.amount is filled in by an approver, so the form cannot set hidden on it';
    const badDraft = {
      edges: [],
      meta: { schemaVersion: 1 },
      nodes: [
        { id: 'userTask_c', position: { x: 0, y: 0 }, type: 'userTask' },
        {
          data: { fieldAccess: 'amount', label: '非陣列' },
          id: 'userTask_a',
          position: { x: 0, y: 0 },
          type: 'userTask',
        },
        {
          data: { fieldAccess: [null, 7], label: '壞項目' },
          id: 'userTask_b',
          position: { x: 0, y: 0 },
          type: 'userTask',
        },
        {
          data: {
            fieldAccess: [
              { display: 'SHOW', fieldKey: 'amount', fill: 'OPTIONAL' },
            ],
            label: '可讀節點',
          },
          id: 'userTask_ok',
          position: { x: 0, y: 0 },
          type: 'userTask',
        },
      ],
    } as unknown as WorkflowDefinition;

    // A guard that is missing makes the whole translation throw, and the
    // catch-all in `readWorkflowLintMessage` then returns every line raw, so
    // only a line that does get translated proves nothing threw.
    expect(
      readWorkflowLintMessage(
        [translatable, ...rawLines].join('; '),
        badDraft,
      ),
    ).toBe(
      ['欄位「amount」由簽核人補填，表單不能設定「只存不顯示」。', ...rawLines].join(
        '; ',
      ),
    );
  });
});

describe('readWorkflowLintMessage: reads before an approver fills a field in', (): void => {
  const readDefinition = {
    edges: [
      {
        data: { condition: 'form.invoiceKind == "B2B"' },
        id: 'edge_manager_fill',
        source: 'userTask_manager',
        target: 'userTask_fill',
      },
      {
        data: {
          conditionFieldKey: 'invoiceKind',
          conditionOperator: 'EQUALS',
          conditionValue: 'B2B',
        },
        id: 'edge_hook_fill',
        source: 'serviceTask_hook',
        target: 'userTask_fill',
      },
      {
        data: { condition: 'form.invoiceKind == "B2B"' },
        id: 'edge_ghost_source',
        source: 'serviceTask_ghost',
        target: 'userTask_fill',
      },
    ],
    meta: { schemaVersion: 1 },
    nodes: [
      {
        data: { label: '開始' },
        id: 'start',
        position: { x: 0, y: 0 },
        type: 'startEvent',
      },
      {
        data: { label: '主管簽核' },
        id: 'userTask_manager',
        position: { x: 0, y: 0 },
        type: 'userTask',
      },
      {
        data: {
          approverResolver: { expression: 'form.invoiceKind', type: 'EXPRESSION' },
          entryCondition: 'form.invoiceKind == "B2B"',
          fieldAccess: [
            { display: 'SHOW', fieldKey: 'invoiceKind', fill: 'OPTIONAL' },
          ],
          label: '財務補填',
        },
        id: 'userTask_fill',
        position: { x: 0, y: 0 },
        type: 'userTask',
      },
      {
        data: {
          action: { payload: 'form.invoiceKind', type: 'WEBHOOK', url: 'u' },
          entryCondition: 'form.invoiceKind == "B2B"',
          label: '呼叫外部系統',
        },
        id: 'serviceTask_hook',
        position: { x: 0, y: 0 },
        type: 'serviceTask',
      },
      {
        data: {
          action: {
            fieldPath: 'amount',
            type: 'SET_FORM_FIELD',
            value: 'form.invoiceKind',
          },
          label: '寫入欄位',
        },
        id: 'serviceTask_set',
        position: { x: 0, y: 0 },
        type: 'serviceTask',
      },
      {
        data: {
          action: {
            channels: ['IN_APP'],
            recipients: { expression: 'form.invoiceKind', type: 'EXPRESSION' },
            type: 'NOTIFY',
          },
          label: '通知會計',
        },
        id: 'serviceTask_notify',
        position: { x: 0, y: 0 },
        type: 'serviceTask',
      },
    ],
  } as unknown as WorkflowDefinition;

  const early = (label: string): string =>
    `${label} reads formData.invoiceKind before an approver fills it in`;

  // [backend line, zh-TW, en]
  const cases: readonly (readonly [string, string, string])[] = [
    [
      early('workflow.edges.edge_manager_fill.data.condition'),
      '從「主管簽核」出發的連線條件在簽核人補填「invoiceKind」之前就讀取它，這時欄位還是空的，流程會卡住。請把這個條件改到補填那關之後。',
      'The condition on the connection leaving "主管簽核" reads the field "invoiceKind" before an approver fills it in, when it is still empty, so the flow would get stuck. Move this condition to after the approval node that fills it in.',
    ],
    [
      early('workflow.edges.edge_hook_fill.data.conditionFieldKey'),
      '從「呼叫外部系統」出發的連線條件在簽核人補填「invoiceKind」之前就讀取它，這時欄位還是空的，流程會卡住。請把這個條件改到補填那關之後。',
      'The condition on the connection leaving "呼叫外部系統" reads the field "invoiceKind" before an approver fills it in, when it is still empty, so the flow would get stuck. Move this condition to after the approval node that fills it in.',
    ],
    [
      early('workflow.nodes.userTask_fill.data.entryCondition'),
      '節點「財務補填」的進入條件在簽核人補填「invoiceKind」之前就讀取它，這時欄位還是空的，流程會卡住。請把這個條件改到補填那關之後。',
      'The entry condition (進入條件) of the node "財務補填" reads the field "invoiceKind" before an approver fills it in, when it is still empty, so the flow would get stuck. Move this condition to after the approval node that fills it in.',
    ],
    [
      early('workflow.nodes.serviceTask_hook.data.entryCondition'),
      '節點「呼叫外部系統」的進入條件在簽核人補填「invoiceKind」之前就讀取它，這時欄位還是空的，流程會卡住。請把這個條件改到補填那關之後。',
      'The entry condition (進入條件) of the node "呼叫外部系統" reads the field "invoiceKind" before an approver fills it in, when it is still empty, so the flow would get stuck. Move this condition to after the approval node that fills it in.',
    ],
    [
      early('workflow.nodes.userTask_fill.data.approverResolver.expression'),
      '節點「財務補填」的簽核人運算式在簽核人補填「invoiceKind」之前就讀取它，這時欄位還是空的，流程會卡住。請把這個條件改到補填那關之後。',
      'The approver expression (簽核人運算式) of the approval node "財務補填" reads the field "invoiceKind" before an approver fills it in, when it is still empty, so the flow would get stuck. Move this condition to after the approval node that fills it in.',
    ],
    [
      early('workflow.nodes.serviceTask_hook.data.action.payload'),
      '系統節點「呼叫外部系統」的運算式在簽核人補填「invoiceKind」之前就讀取它，這時欄位還是空的，流程會卡住。請把這個條件改到補填那關之後。',
      'The expression of the system node "呼叫外部系統" reads the field "invoiceKind" before an approver fills it in, when it is still empty, so the flow would get stuck. Move this condition to after the approval node that fills it in.',
    ],
    [
      early('workflow.nodes.serviceTask_set.data.action.value'),
      '系統節點「寫入欄位」的運算式在簽核人補填「invoiceKind」之前就讀取它，這時欄位還是空的，流程會卡住。請把這個條件改到補填那關之後。',
      'The expression of the system node "寫入欄位" reads the field "invoiceKind" before an approver fills it in, when it is still empty, so the flow would get stuck. Move this condition to after the approval node that fills it in.',
    ],
    [
      early('workflow.nodes.serviceTask_notify.data.entryCondition'),
      '節點「通知會計」的進入條件在簽核人補填「invoiceKind」之前就讀取它，這時欄位還是空的，流程會卡住。請把這個條件改到補填那關之後。',
      'The entry condition (進入條件) of the node "通知會計" reads the field "invoiceKind" before an approver fills it in, when it is still empty, so the flow would get stuck. Move this condition to after the approval node that fills it in.',
    ],
    [
      early('workflow.nodes.serviceTask_notify.data.action.recipients.expression'),
      '知會節點「通知會計」的通知對象運算式在簽核人補填「invoiceKind」之前就讀取它，這時欄位還是空的，流程會卡住。請把這個條件改到補填那關之後。',
      'The recipients expression of the notify node "通知會計" reads the field "invoiceKind" before an approver fills it in, when it is still empty, so the flow would get stuck. Move this condition to after the approval node that fills it in.',
    ],
  ];

  it.each(cases)('writes %s in Chinese', (backend, zhTw): void => {
    expect(readWorkflowLintMessage(backend, readDefinition)).toBe(zhTw);
  });

  it.each(cases)('writes %s in English', (backend, _zhTw, en): void => {
    expect(readWorkflowLintMessage(backend, readDefinition, 'en')).toBe(en);
  });

  it('matches the labels the backend builds from WORKFLOW_EXPRESSION_LABELS', (): void => {
    const lines = [
      WORKFLOW_EXPRESSION_LABELS.edgeCondition('edge_manager_fill'),
      WORKFLOW_EXPRESSION_LABELS.edgeConditionFieldKey('edge_hook_fill'),
      WORKFLOW_EXPRESSION_LABELS.nodeEntryCondition('userTask_fill'),
      WORKFLOW_EXPRESSION_LABELS.nodeApproverResolverExpression('userTask_fill'),
      WORKFLOW_EXPRESSION_LABELS.nodeActionPayload('serviceTask_hook'),
      WORKFLOW_EXPRESSION_LABELS.nodeActionValue('serviceTask_set'),
      WORKFLOW_EXPRESSION_LABELS.nodeActionRecipientsExpression(
        'serviceTask_notify',
      ),
    ].map((label) =>
      WORKFLOW_LINT_MESSAGES.approverFilledFieldReadEarly(label, 'invoiceKind'),
    );

    // Every one is rewritten: none is left as the backend wrote it.
    expect(
      readWorkflowLintMessage(lines.join('; '), readDefinition).split('; '),
    ).toEqual(lines.map((line) => readWorkflowLintMessage(line, readDefinition)));
    lines.forEach((line): void => {
      expect(readWorkflowLintMessage(line, readDefinition)).not.toBe(line);
    });
  });

  it('keeps a line for a field no approver fills in', (): void => {
    const foreign =
      'workflow.edges.edge_manager_fill.data.condition reads formData.amount before an approver fills it in';

    expect(readWorkflowLintMessage(foreign, readDefinition)).toBe(foreign);
  });

  it('keeps a line whose edge leaves a node outside the definition', (): void => {
    const foreign = early('workflow.edges.edge_ghost_source.data.condition');

    expect(readWorkflowLintMessage(foreign, readDefinition)).toBe(foreign);
  });

  it('keeps a line that names an edge or node outside the definition', (): void => {
    const foreign = [
      early('workflow.edges.edge_9.data.condition'),
      early('workflow.nodes.userTask_9.data.entryCondition'),
    ].join('; ');

    expect(readWorkflowLintMessage(foreign, readDefinition)).toBe(foreign);
  });

  it('does not throw on drafts whose nodes or edges cannot be read', (): void => {
    const line = early('workflow.nodes.serviceTask_a.data.action.payload');
    const badDraft = {
      edges: [null, 7, { id: 'edge_x' }],
      meta: { schemaVersion: 1 },
      nodes: [
        {
          data: {
            fieldAccess: [
              { display: 'SHOW', fieldKey: 'invoiceKind', fill: 'OPTIONAL' },
            ],
          },
          id: 'userTask_a',
          position: { x: 0, y: 0 },
          type: 'userTask',
        },
        { id: 'serviceTask_a', position: { x: 0, y: 0 }, type: 'serviceTask' },
        {
          data: { action: 'NOTIFY' },
          id: 'serviceTask_b',
          position: { x: 0, y: 0 },
          type: 'serviceTask',
        },
      ],
    } as unknown as WorkflowDefinition;

    expect(readWorkflowLintMessage(line, badDraft)).toBe(line);
  });
});
