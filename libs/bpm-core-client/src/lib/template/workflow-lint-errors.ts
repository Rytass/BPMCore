import type {
  WorkflowDefinition,
  WorkflowNode,
} from '@rytass/bpm-core-shared/workflow';
import { WORKFLOW_NODE_TYPE_LABELS } from '@rytass/bpm-core-shared/workflow-graph';

/**
 * Rewrites the structural lines of a publish-lint failure into designer copy.
 *
 * The backend lint (`lintWorkflowDefinition`) speaks in node ids —
 * `workflow.nodes.exclusiveGateway_1 exclusive split requires at least two
 * outgoing edges` — and joins every failing line with `'; '`. The designer
 * already holds the definition it just submitted, so it can name the node the
 * way the canvas does and say how to fix it.
 *
 * The backend message itself stays untouched: hosts may match it, and only the
 * screen needs the translation. Every line is rebuilt from the definition and
 * replaced only on an exact, segment-bounded match, so a line this module does
 * not know — a CEL error, a webhook code, a form path — or a node id that does
 * not belong to this definition is returned exactly as the backend wrote it.
 */
export function readWorkflowLintMessage(
  message: string,
  definition: WorkflowDefinition | null | undefined,
): string {
  const translations = new Map(readWorkflowLintTranslations(definition));

  // Split on the backend's own separator and swap whole lines only, so a line
  // that merely contains a known one — a CEL error quoting it, say — is left
  // as written.
  return message
    .split('; ')
    .map((segment): string => translations.get(segment) ?? segment)
    .join('; ');
}

function readWorkflowLintTranslations(
  definition: WorkflowDefinition | null | undefined,
): readonly (readonly [string, string])[] {
  const nodes = Array.isArray(definition?.nodes) ? definition.nodes : [];
  const edges = Array.isArray(definition?.edges) ? definition.edges : [];
  const nodeTranslations = nodes.flatMap(
    (node): readonly (readonly [string, string])[] => {
      const name = readNodeName(node);

      return [
        [
          `workflow.nodes.${node.id} exclusive split requires at least two outgoing edges`,
          `條件分流「${name}」往下至少要有兩條連線，且其中一條要開啟「其他情況走這條」。`,
        ],
        [
          `workflow.nodes.${node.id} must include a default outgoing edge`,
          `條件分流「${name}」的輸出連線中，要有一條開啟「其他情況走這條」，其他條件都不符合時流程才有路可走。`,
        ],
        [
          `workflow.nodes.${node.id} parallel join requires at least two incoming edges`,
          `並行處理「${name}」至少要有兩條連線匯入。`,
        ],
        [
          `workflow.nodes.${node.id} is not reachable from start`,
          `節點「${name}」沒有從「開始」接過來的連線，流程走不到這一關。請從前一個節點拉一條連線到它。`,
        ],
        [
          `workflow.nodes.${node.id} does not have a path to an endEvent`,
          `節點「${name}」往下接不到「結束」，流程走到這裡會卡住。請從它拉一條連線到下一個節點或「結束」。`,
        ],
        [
          `workflow contains a cycle involving node ${node.id}`,
          `節點「${name}」所在的連線繞成了迴圈，流程會一直繞回來。請移除造成迴圈的那條連線。`,
        ],
      ];
    },
  );
  const edgeTranslations = edges.flatMap(
    (edge): readonly (readonly [string, string])[] => {
      const source = nodes.find((node) => node.id === edge.source);

      return source
        ? [
            [
              `workflow.edges.${edge.id}.source cannot be a NOTIFY serviceTask`,
              `知會節點「${readNodeName(source)}」不能往下接連線（知會只負責通知，流程不會從它繼續）。請刪除從它拉出的連線。`,
            ],
          ]
        : [];
    },
  );

  return [
    [
      'workflow must include exactly one startEvent node',
      '流程必須有一個「開始」節點，而且只能有一個。',
    ],
    [
      'workflow must include at least one endEvent node',
      '流程至少要有一個「結束」節點。',
    ],
    ...nodeTranslations,
    ...edgeTranslations,
  ];
}

/**
 * The name the canvas shows for a node. A blank label falls back to the node
 * type, never the id: the id is what the designer cannot see.
 */
function readNodeName(node: WorkflowNode): string {
  const label = node.data.label?.trim();

  return label ? label : WORKFLOW_NODE_TYPE_LABELS[node.type];
}
