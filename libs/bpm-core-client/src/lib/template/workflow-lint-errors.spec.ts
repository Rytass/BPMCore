import type { WorkflowDefinition } from '@rytass/bpm-core-shared/workflow';
import { readWorkflowLintMessage } from './workflow-lint-errors';

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
        '節點「主管簽核」沒有從「開始」接過來的連線，流程走不到這一關。請從前一個節點拉一條連線到它。',
        '節點「主管簽核」往下接不到「結束」，流程走到這裡會卡住。請從它拉一條連線到下一個節點或「結束」。',
        '節點「主管簽核」所在的連線繞成了迴圈，流程會一直繞回來。請移除造成迴圈的那條連線。',
        '流程必須有一個「開始」節點，而且只能有一個。',
        '流程至少要有一個「結束」節點。',
      ].join('; '),
    );
  });

  it('falls back to the node type, never the id, when the label is blank', (): void => {
    expect(
      readWorkflowLintMessage(
        'workflow.nodes.exclusiveGateway_2 must include a default outgoing edge',
        definition,
      ),
    ).toBe(
      '條件分流「條件分流」的輸出連線中，要有一條開啟「其他情況走這條」，其他條件都不符合時流程才有路可走。',
    );
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
});
