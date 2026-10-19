import type { WorkflowDefinition } from '@rytass/bpm-core-shared/workflow';
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
