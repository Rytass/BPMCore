import {
  readNodeFieldPermissions,
  readTopLevelFieldKey,
} from '@rytass/bpm-core-shared';
import type {
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from '@rytass/bpm-core-shared/workflow';
import {
  WORKFLOW_LINT_MESSAGES,
  WORKFLOW_NODE_TYPE_LABELS,
} from '@rytass/bpm-core-shared/workflow-graph';

/** Languages `readWorkflowLintMessage` can rewrite the publish lint into. */
export type WorkflowLintLanguage = 'en' | 'zh-TW';

export const DEFAULT_WORKFLOW_LINT_LANGUAGE: WorkflowLintLanguage = 'zh-TW';

export const WORKFLOW_LINT_LANGUAGES: readonly WorkflowLintLanguage[] = [
  'zh-TW',
  'en',
];

interface WorkflowLintCopy {
  readonly blankNodeLabel: (typeLabel: string) => string;
  readonly cycle: (name: string) => string;
  readonly endEventMissing: string;
  readonly exclusiveSplitDefaultEdge: (name: string) => string;
  readonly exclusiveSplitOutgoingEdges: (name: string) => string;
  readonly fieldPermissionAutoApprove: (name: string) => string;
  readonly fieldPermissionDuplicate: (
    name: string,
    fieldPath: string,
  ) => string;
  readonly fieldPermissionEditableInvisible: (
    name: string,
    fieldPath: string,
  ) => string;
  readonly fieldPermissionGroupPolicy: (name: string) => string;
  readonly fieldPermissionNestedPath: (
    name: string,
    fieldPath: string,
  ) => string;
  readonly fieldPermissionRequiredNotEditable: (
    name: string,
    fieldPath: string,
  ) => string;
  readonly fieldPermissionSkipNode: (name: string) => string;
  readonly fieldPermissionsInvalid: (name: string) => string;
  readonly noPathToEnd: (name: string) => string;
  readonly nodeTypeLabels: ReadonlyMap<string, string>;
  readonly notifyOutgoingEdge: (name: string) => string;
  readonly parallelJoinIncomingEdges: (name: string) => string;
  readonly setFormFieldApproverFilled: (
    name: string,
    fieldKey: string,
  ) => string;
  readonly startEventCount: string;
  readonly unknownNodeType: string;
  readonly unreachableNode: (name: string) => string;
}

// Node types are looked up in a Map, not an object literal: the lint only
// checks that a node type is a non-empty string, so a draft can carry
// `constructor` or `toString`, which an object lookup would answer with a
// prototype function.
//
// The designer's own labels are Chinese whatever the language, so the English
// copy names each field and node type with its on-screen label beside it.
const WORKFLOW_LINT_COPY: Readonly<
  Record<WorkflowLintLanguage, WorkflowLintCopy>
> = {
  en: {
    blankNodeLabel: (typeLabel): string =>
      `A "${typeLabel}" node has no display name. Select it, fill in "Display name" (顯示名稱), then publish again.`,
    cycle: (name): string =>
      `The connections around "${name}" form a loop, so the flow would keep coming back. Remove the connection that closes the loop.`,
    endEventMissing: 'The flow needs at least one "End" (結束) node.',
    exclusiveSplitDefaultEdge: (name): string =>
      `One outgoing connection of the condition split "${name}" must have "Otherwise take this path" (其他情況走這條) turned on, so the flow has somewhere to go when no condition matches.`,
    exclusiveSplitOutgoingEdges: (name): string =>
      `The condition split "${name}" needs at least two outgoing connections, one of them with "Otherwise take this path" (其他情況走這條) turned on.`,
    fieldPermissionAutoApprove: (name): string =>
      `The approval node "${name}" has fillable fields, so its timeout action cannot be "Auto approve" (自動核准); auto approval would not fill them in.`,
    fieldPermissionDuplicate: (name, fieldPath): string =>
      `The approval node "${name}" lists the field "${fieldPath}" more than once in its field permissions. Keep one entry per field.`,
    fieldPermissionEditableInvisible: (name, fieldPath): string =>
      `The approval node "${name}" makes the field "${fieldPath}" fillable but hidden. Make it fillable and visible, or turn fillable off.`,
    fieldPermissionGroupPolicy: (name): string =>
      `The approval node "${name}" is a joint approval (everyone / a quorum must approve), so it cannot have fillable fields; several people filling in at once would overwrite each other.`,
    fieldPermissionNestedPath: (name, fieldPath): string =>
      `The field permissions of the approval node "${name}" can only name a top-level form field (a table is set as a whole); "${fieldPath}" is not one.`,
    fieldPermissionRequiredNotEditable: (name, fieldPath): string =>
      `The approval node "${name}" marks the field "${fieldPath}" as required, but it is not a fillable field.`,
    fieldPermissionSkipNode: (name): string =>
      `The approval node "${name}" has fillable fields, so what "Initiator cannot self-approve" (申請人不能自簽) does when nobody is left to sign cannot be "Skip this step" (跳過此關); otherwise the case would be approved with nobody filling them in.`,
    fieldPermissionsInvalid: (name): string =>
      `The field permissions of the approval node "${name}" are malformed. Open the node in the designer and set them again.`,
    noPathToEnd: (name): string =>
      `"${name}" has no path to "End" (結束), so the flow would get stuck there. Connect it to the next node or to "End".`,
    nodeTypeLabels: new Map([
      ['endEvent', 'End (結束)'],
      ['exclusiveGateway', 'Condition split (條件分流)'],
      ['parallelGateway', 'Parallel (並行處理)'],
      ['serviceTask', 'System (系統)'],
      ['startEvent', 'Start (開始)'],
      ['userTask', 'Approval (簽核)'],
    ]),
    notifyOutgoingEdge: (name): string =>
      `The notify node "${name}" cannot have outgoing connections (it only sends a notice; the flow does not continue from it). Delete the connection leaving it.`,
    parallelJoinIncomingEdges: (name): string =>
      `The parallel join "${name}" needs at least two incoming connections.`,
    setFormFieldApproverFilled: (name, fieldKey): string =>
      `The system node "${name}" cannot write the field "${fieldKey}", which an approver fills in.`,
    startEventCount: 'The flow needs exactly one "Start" (開始) node.',
    unknownNodeType: 'Unknown type',
    unreachableNode: (name): string =>
      `"${name}" cannot be reached from "Start" (開始), so the flow never gets there. Make sure a chain of connections leads to it from "Start".`,
  },
  'zh-TW': {
    blankNodeLabel: (typeLabel): string =>
      `有一個「${typeLabel}」節點沒有顯示名稱。請點選該節點，在「顯示名稱」填入名稱後再發布。`,
    cycle: (name): string =>
      `節點「${name}」所在的連線繞成了迴圈，流程會一直繞回來。請移除造成迴圈的那條連線。`,
    endEventMissing: '流程至少要有一個「結束」節點。',
    exclusiveSplitDefaultEdge: (name): string =>
      `條件分流「${name}」的輸出連線中，要有一條開啟「其他情況走這條」，其他條件都不符合時流程才有路可走。`,
    exclusiveSplitOutgoingEdges: (name): string =>
      `條件分流「${name}」往下至少要有兩條連線，且其中一條要開啟「其他情況走這條」。`,
    fieldPermissionAutoApprove: (name): string =>
      `簽核節點「${name}」有可填欄位，逾時處理不能選「自動核准」，自動核准不會補填。`,
    fieldPermissionDuplicate: (name, fieldPath): string =>
      `簽核節點「${name}」的欄位權限重複設定了欄位「${fieldPath}」。`,
    fieldPermissionEditableInvisible: (name, fieldPath): string =>
      `簽核節點「${name}」把欄位「${fieldPath}」設成可填卻又隱藏，請改成可填並顯示。`,
    fieldPermissionGroupPolicy: (name): string =>
      `簽核節點「${name}」是會簽（全部同意／過半數），不能設定可填欄位，否則多人同時填寫會互相覆蓋。`,
    fieldPermissionNestedPath: (name, fieldPath): string =>
      `簽核節點「${name}」的欄位權限只能設定表單第一層欄位（表格整張一起設定），「${fieldPath}」不是。`,
    fieldPermissionRequiredNotEditable: (name, fieldPath): string =>
      `簽核節點「${name}」把欄位「${fieldPath}」設成必填，但它不是可填欄位。`,
    fieldPermissionSkipNode: (name): string =>
      `簽核節點「${name}」有可填欄位，「申請人不能自簽」的無人可簽處理不能選「跳過此關」，否則這張單沒有人補填就核准了。`,
    fieldPermissionsInvalid: (name): string =>
      `簽核節點「${name}」的欄位權限設定格式不正確，請在設計器重新設定。`,
    noPathToEnd: (name): string =>
      `節點「${name}」往下接不到「結束」，流程走到這裡會卡住。請從它拉一條連線到下一個節點或「結束」。`,
    // The canvas's own labels, so the copy names a node type the way the
    // designer and the AI toolset do.
    nodeTypeLabels: new Map(Object.entries(WORKFLOW_NODE_TYPE_LABELS)),
    notifyOutgoingEdge: (name): string =>
      `知會節點「${name}」不能往下接連線（知會只負責通知，流程不會從它繼續）。請刪除從它拉出的連線。`,
    parallelJoinIncomingEdges: (name): string =>
      `並行處理「${name}」至少要有兩條連線匯入。`,
    setFormFieldApproverFilled: (name, fieldKey): string =>
      `系統節點「${name}」不能寫入由簽核人補填的欄位「${fieldKey}」。`,
    startEventCount: '流程必須有一個「開始」節點，而且只能有一個。',
    unknownNodeType: '未知類型',
    unreachableNode: (name): string =>
      `從「開始」走不到節點「${name}」，流程永遠不會到這一關。請確認從「開始」一路都有連線接到它。`,
  },
};

/**
 * Rewrites the structural lines of a publish-lint failure into designer copy
 * in `language` (Traditional Chinese by default).
 *
 * The backend lint (`lintWorkflowDefinition`) speaks in node ids —
 * `workflow.nodes.exclusiveGateway_1 exclusive split requires at least two
 * outgoing edges` — and joins every failing line with `'; '`. The designer
 * already holds the definition it just submitted, so it can name the node the
 * way the canvas does and say how to fix it.
 *
 * The backend message itself stays untouched: hosts may match it, and only the
 * screen needs the translation. Every line is rebuilt from the definition with
 * the same `WORKFLOW_LINT_MESSAGES` the backend writes with, and replaced only
 * on an exact, segment-bounded match, so a line this module does not know — a
 * CEL error, a webhook code, a form path — or a node id that does not belong
 * to this definition is returned exactly as the backend wrote it.
 */
export function readWorkflowLintMessage(
  message: string,
  definition: WorkflowDefinition | null | undefined,
  language: WorkflowLintLanguage = DEFAULT_WORKFLOW_LINT_LANGUAGE,
): string {
  // A plain JavaScript host can pass any string; fall back rather than throw
  // inside the caller's error handler.
  const copy = WORKFLOW_LINT_LANGUAGES.includes(language)
    ? WORKFLOW_LINT_COPY[language]
    : WORKFLOW_LINT_COPY[DEFAULT_WORKFLOW_LINT_LANGUAGE];

  // Unreadable entries are skipped one by one below; this is the last resort
  // for a draft that throws on read (a getter or a Proxy), which shows the
  // backend message rather than nothing.
  try {
    const translations = readFirstWins(
      readWorkflowLintTranslations(definition, copy),
    );

    // Split on the backend's own separator and swap whole lines only, so a
    // line that merely contains a known one — a CEL error quoting it, say — is
    // left as written.
    return message
      .split('; ')
      .map((segment): string => translations.get(segment) ?? segment)
      .join('; ');
  } catch {
    return message;
  }
}

/**
 * A Map keyed by the first entry for each key. Duplicate node ids are a lint
 * error of their own, and the line then names the first node with that id.
 */
function readFirstWins<K, V>(
  entries: readonly (readonly [K, V])[],
): ReadonlyMap<K, V> {
  return new Map([...entries].reverse());
}

type Translation = readonly [string, string];

/**
 * This runs inside the callers' error handlers, after they have cleared the
 * previous error, so it should not throw (`readWorkflowLintMessage` still
 * catches anything that does): a draft saved by the AI toolset or the API is
 * not linted on save and may be malformed. A node or edge it cannot
 * read is skipped on its own, which leaves that line as the backend wrote it
 * while every readable one is still translated.
 */
function readWorkflowLintTranslations(
  definition: WorkflowDefinition | null | undefined,
  copy: WorkflowLintCopy,
): readonly Translation[] {
  const entries: readonly unknown[] = Array.isArray(definition?.nodes)
    ? definition.nodes
    : [];
  const edges: readonly unknown[] = Array.isArray(definition?.edges)
    ? definition.edges
    : [];
  // The shape lint names a node by its index in the submitted array, so the
  // index is taken before unreadable entries are dropped.
  const indexedNodes = entries.flatMap(
    (node, index): readonly (readonly [WorkflowNode, number])[] =>
      isReadableNode(node) ? [[node, index]] : [],
  );
  const nodesById = readFirstWins(
    indexedNodes.map(([node]): readonly [string, WorkflowNode] => [
      node.id,
      node,
    ]),
  );
  const nodeTranslations = indexedNodes.flatMap(
    ([node, index]): readonly Translation[] =>
      readNodeTranslations(node, index, copy),
  );
  const edgeTranslations = edges
    .filter(isReadableEdge)
    .flatMap((edge): readonly Translation[] => {
      const source = nodesById.get(edge.source);

      return source
        ? [
            [
              WORKFLOW_LINT_MESSAGES.notifyOutgoingEdge(edge.id),
              copy.notifyOutgoingEdge(readNodeName(source, copy)),
            ],
          ]
        : [];
    });

  return [
    [WORKFLOW_LINT_MESSAGES.startEventCount(), copy.startEventCount],
    [WORKFLOW_LINT_MESSAGES.endEventMissing(), copy.endEventMissing],
    ...nodeTranslations,
    ...edgeTranslations,
  ];
}

function readNodeTranslations(
  node: WorkflowNode,
  index: number,
  copy: WorkflowLintCopy,
): readonly Translation[] {
  const name = readNodeName(node, copy);

  return [
    [
      // The shape lint names the node by array index, the one thing the
      // canvas never shows, and the label it would use is the blank one.
      WORKFLOW_LINT_MESSAGES.blankNodeLabel(index),
      copy.blankNodeLabel(readNodeTypeLabel(node, copy)),
    ],
    [
      WORKFLOW_LINT_MESSAGES.exclusiveSplitOutgoingEdges(node.id),
      copy.exclusiveSplitOutgoingEdges(name),
    ],
    [
      WORKFLOW_LINT_MESSAGES.exclusiveSplitDefaultEdge(node.id),
      copy.exclusiveSplitDefaultEdge(name),
    ],
    [
      WORKFLOW_LINT_MESSAGES.parallelJoinIncomingEdges(node.id),
      copy.parallelJoinIncomingEdges(name),
    ],
    [
      WORKFLOW_LINT_MESSAGES.unreachableNode(node.id),
      copy.unreachableNode(name),
    ],
    [WORKFLOW_LINT_MESSAGES.noPathToEnd(node.id), copy.noPathToEnd(name)],
    [WORKFLOW_LINT_MESSAGES.cycle(node.id), copy.cycle(name)],
    ...readFieldPermissionTranslations(node, name, copy),
  ];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The field permission lines name a field by its path, and the path is only
 * known from the draft itself, so each readable entry yields its own lines.
 * An entry the lint calls malformed has no line of its own — `fieldPermissions
 * is invalid` names the node — and a draft whose permissions or action cannot
 * be read yields nothing, which leaves its line as the backend wrote it.
 */
function readFieldPermissionTranslations(
  node: WorkflowNode,
  name: string,
  copy: WorkflowLintCopy,
): readonly Translation[] {
  const data: unknown = node.data;

  if (!isRecord(data)) {
    return [];
  }

  if (node.type === 'userTask') {
    return [
      [
        WORKFLOW_LINT_MESSAGES.fieldPermissionsInvalid(node.id),
        copy.fieldPermissionsInvalid(name),
      ],
      [
        WORKFLOW_LINT_MESSAGES.fieldPermissionGroupPolicy(node.id),
        copy.fieldPermissionGroupPolicy(name),
      ],
      [
        WORKFLOW_LINT_MESSAGES.fieldPermissionAutoApprove(node.id),
        copy.fieldPermissionAutoApprove(name),
      ],
      [
        WORKFLOW_LINT_MESSAGES.fieldPermissionSkipNode(node.id),
        copy.fieldPermissionSkipNode(name),
      ],
      ...readNodeFieldPermissions(node).flatMap(
        ({ fieldPath }): readonly Translation[] => [
          [
            WORKFLOW_LINT_MESSAGES.fieldPermissionDuplicate(node.id, fieldPath),
            copy.fieldPermissionDuplicate(name, fieldPath),
          ],
          [
            WORKFLOW_LINT_MESSAGES.fieldPermissionNestedPath(node.id, fieldPath),
            copy.fieldPermissionNestedPath(name, fieldPath),
          ],
          [
            WORKFLOW_LINT_MESSAGES.fieldPermissionEditableInvisible(
              node.id,
              fieldPath,
            ),
            copy.fieldPermissionEditableInvisible(name, fieldPath),
          ],
          [
            WORKFLOW_LINT_MESSAGES.fieldPermissionRequiredNotEditable(
              node.id,
              fieldPath,
            ),
            copy.fieldPermissionRequiredNotEditable(name, fieldPath),
          ],
        ],
      ),
    ];
  }

  const action = data['action'];

  if (
    node.type === 'serviceTask' &&
    isRecord(action) &&
    action['type'] === 'SET_FORM_FIELD' &&
    typeof action['fieldPath'] === 'string'
  ) {
    const fieldKey = readTopLevelFieldKey(action['fieldPath']);

    return [
      [
        WORKFLOW_LINT_MESSAGES.setFormFieldApproverFilled(node.id, fieldKey),
        copy.setFormFieldApproverFilled(name, fieldKey),
      ],
    ];
  }

  return [];
}

function isReadableNode(node: unknown): node is WorkflowNode {
  return (
    typeof node === 'object' &&
    node !== null &&
    typeof (node as { readonly id?: unknown }).id === 'string'
  );
}

function isReadableEdge(edge: unknown): edge is WorkflowEdge {
  return (
    typeof edge === 'object' &&
    edge !== null &&
    typeof (edge as { readonly id?: unknown }).id === 'string' &&
    typeof (edge as { readonly source?: unknown }).source === 'string'
  );
}

/**
 * The name the canvas shows for a node. A blank label falls back to the node
 * type, never the id: the id is what the designer cannot see.
 */
function readNodeName(node: WorkflowNode, copy: WorkflowLintCopy): string {
  const label: unknown = (node.data as { readonly label?: unknown } | undefined)
    ?.label;

  return typeof label === 'string' && label.trim()
    ? label.trim()
    : readNodeTypeLabel(node, copy);
}

function readNodeTypeLabel(node: WorkflowNode, copy: WorkflowLintCopy): string {
  return copy.nodeTypeLabels.get(node.type) ?? copy.unknownNodeType;
}
