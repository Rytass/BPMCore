import {
  useMemo,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react';
import {
  Badge,
  InlineMessage,
  Select,
  Table,
  Toggle,
  Typography,
} from '@mezzanine-ui/react';
import Drawer from '@mezzanine-ui/react/Drawer';
import type { TableColumn } from '@mezzanine-ui/core/table';
import {
  FIELD_ACCESS_CHOICES,
  applyWorkflowCommand,
  isFieldAccessEntryValid,
  readFieldAccessEntryForChoice,
  readFieldAccessMatrix,
  readNodeFieldAccess,
  type FieldAccessChoice,
  type FieldAccessMatrix,
  type FieldAccessMatrixCell,
  type FieldAccessMatrixColumn,
  type FieldAccessMatrixEntry,
  type FieldAccessMatrixRow,
} from '@rytass/bpm-core-shared';
import type { FormDefinitionSchema } from '@rytass/bpm-core-shared/form';
import type {
  UserTaskNode,
  WorkflowDefinition,
} from '@rytass/bpm-core-shared/workflow';
import { readWorkflowLintMessage } from '@rytass/bpm-core-client/template';
import type { BPMLanguage } from '../../../../lib/language-provider';
import {
  FIELD_ACCESS_BOOLEAN_REQUIRED_NOTE,
  FIELD_ACCESS_CHOICE_LABELS,
  FIELD_ACCESS_EFFECTIVE_LABELS,
  FIELD_ACCESS_FILL_BLOCKER_LABELS,
  FIELD_ACCESS_HIDE_NOTE,
  readFieldAccessStageLabel,
} from './field-access-copy';

export interface FieldAccessMatrixDrawerProps {
  readonly definition: WorkflowDefinition;
  readonly formSchema: FormDefinitionSchema | null;
  readonly language: BPMLanguage;
  /**
   * Called with the whole matrix, only when it differs from `definition`.
   * Answers why it could not be applied, or `null` once it was.
   */
  readonly onApply: (
    entries: readonly FieldAccessMatrixEntry[],
  ) => string | null;
  readonly onClose: () => void;
  readonly open: boolean;
}

// A type literal, not the row interface: Table wants an index signature.
type MatrixTableRow = {
  readonly key: string;
  readonly row: FieldAccessMatrixRow;
};

const BODY_STYLE: CSSProperties = {
  display: 'grid',
  gap: 12,
  // Keeps the wide table inside the drawer, scrolling in its own area,
  // instead of stretching the column past the drawer's edge.
  gridTemplateColumns: 'minmax(0, 1fr)',
  padding:
    'var(--mzn-spacing-padding-vertical-spacious) var(--mzn-spacing-padding-horizontal-spacious)',
};

const STACK_STYLE: CSSProperties = {
  display: 'grid',
  gap: 4,
};

const FIELD_CELL_STYLE: CSSProperties = {
  display: 'grid',
};

/**
 * Every user task's entries in definition order, unknown field keys included:
 * the matrix only has rows for the form's fields, and applying must not drop
 * an entry nobody was shown. An entry the publish lint rejects (a blank field
 * key) is left out, so applying clears it instead of being refused for it.
 */
function readDefinitionEntries(
  definition: WorkflowDefinition,
): readonly FieldAccessMatrixEntry[] {
  return definition.nodes
    .filter((node): node is UserTaskNode => node.type === 'userTask')
    .flatMap((node) =>
      readNodeFieldAccess(node)
        .filter(isFieldAccessEntryValid)
        .map((entry): FieldAccessMatrixEntry => ({
          ...entry,
          nodeId: node.id,
        })),
    );
}

/**
 * Puts `next` in the place of the node's entry for the field, so untouched
 * nodes keep their order; a new one goes last and `null` removes it.
 */
function setFieldAccessDraftEntry(
  entries: readonly FieldAccessMatrixEntry[],
  nodeId: string,
  fieldKey: string,
  next: FieldAccessMatrixEntry | null,
): readonly FieldAccessMatrixEntry[] {
  const index = entries.findIndex(
    (candidate) =>
      candidate.nodeId === nodeId && candidate.fieldKey === fieldKey,
  );

  if (index === -1) {
    return next === null ? entries : [...entries, next];
  }

  return entries.flatMap((candidate, candidateIndex) =>
    candidateIndex === index ? (next === null ? [] : [next]) : [candidate],
  );
}

/** Sets one cell of the draft; `DEFAULT` removes its entry. */
export function updateFieldAccessDraft(
  entries: readonly FieldAccessMatrixEntry[],
  nodeId: string,
  fieldKey: string,
  choice: FieldAccessChoice,
): readonly FieldAccessMatrixEntry[] {
  const entry = readFieldAccessEntryForChoice(fieldKey, choice);

  return setFieldAccessDraftEntry(
    entries,
    nodeId,
    fieldKey,
    entry === null ? null : { ...entry, nodeId },
  );
}

function readEntryKey(entry: FieldAccessMatrixEntry): string {
  return `${entry.nodeId}\u0000${entry.fieldKey}`;
}

/**
 * The cells edited in the drawer (`draft` against `initial`), laid onto the
 * entries the flow holds now. An undo or an assistant edit made while the
 * drawer was open keeps every cell the drawer did not touch, and a node that
 * stopped being a user task meanwhile is dropped.
 */
export function rebaseFieldAccessDraft(
  current: readonly FieldAccessMatrixEntry[],
  initial: readonly FieldAccessMatrixEntry[],
  draft: readonly FieldAccessMatrixEntry[],
  userTaskIds: ReadonlySet<string>,
): readonly FieldAccessMatrixEntry[] {
  const initialByKey = new Map(
    initial.map((entry) => [readEntryKey(entry), entry] as const),
  );
  const draftByKey = new Map(
    draft.map((entry) => [readEntryKey(entry), entry] as const),
  );
  const edited = [...initial, ...draft].filter(
    (entry, index, all) =>
      all.findIndex(
        (candidate) => readEntryKey(candidate) === readEntryKey(entry),
      ) === index &&
      JSON.stringify(initialByKey.get(readEntryKey(entry))) !==
        JSON.stringify(draftByKey.get(readEntryKey(entry))),
  );

  return edited
    .reduce(
      (entries, entry) =>
        setFieldAccessDraftEntry(
          entries,
          entry.nodeId,
          entry.fieldKey,
          draftByKey.get(readEntryKey(entry)) ?? null,
        ),
      current,
    )
    .filter((entry) => userTaskIds.has(entry.nodeId));
}

function readUserTaskIds(definition: WorkflowDefinition): ReadonlySet<string> {
  return new Set(
    definition.nodes
      .filter((node) => node.type === 'userTask')
      .map((node) => node.id),
  );
}

/** The definition with the draft applied, through the same command `套用` dispatches. */
function readDraftDefinition(
  definition: WorkflowDefinition,
  formSchema: FormDefinitionSchema | null,
  entries: readonly FieldAccessMatrixEntry[],
): WorkflowDefinition {
  return applyWorkflowCommand(
    {
      definition,
      editingEdgeId: null,
      formDefinitionVersionId: null,
      formSchema,
      initiatorPolicyCel: null,
      selectedEdgeIds: [],
      selectedNodeId: null,
    },
    { entries, type: 'setFieldAccessMatrix' },
  ).state.definition;
}

/**
 * Whether every user task stores exactly what the matrix reads. An entry the
 * reader repairs or skips (an unknown `fill`, a blank or repeated field key)
 * reads like a valid one, so only a rewrite clears what blocks publishing.
 */
function isStoredAsRead(definition: WorkflowDefinition): boolean {
  return definition.nodes.every(
    (node) =>
      node.type !== 'userTask' ||
      node.data.fieldAccess === undefined ||
      readStoredEntriesKey(node.data.fieldAccess) ===
        readStoredEntriesKey(
          readDefinitionEntries({ ...definition, nodes: [node] }),
        ),
  );
}

// Key order and extra keys are not a difference worth rewriting.
function readStoredEntriesKey(value: unknown): string {
  return JSON.stringify(
    Array.isArray(value) ? value.map(readStoredEntryKey) : value,
  );
}

function readStoredEntryKey(entry: unknown): unknown {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return entry;
  }

  const { display, fieldKey, fill } = entry as {
    readonly display?: unknown;
    readonly fieldKey?: unknown;
    readonly fill?: unknown;
  };

  return [display, fieldKey, fill];
}

function isSameEntries(
  left: readonly FieldAccessMatrixEntry[],
  right: readonly FieldAccessMatrixEntry[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * One opening of the drawer: the entries it opened with, the draft, and the
 * rows the filter keeps however they read now — the rows that had a setting
 * or an issue on opening, and every row edited since, so a row set back to
 * 預設 does not vanish under the cursor.
 */
interface MatrixSession {
  readonly draft: readonly FieldAccessMatrixEntry[];
  readonly initial: readonly FieldAccessMatrixEntry[];
  readonly pinnedFieldKeys: ReadonlySet<string>;
}

const EMPTY_MATRIX: FieldAccessMatrix = { columns: [], issues: [], rows: [] };

function readMatrixSession(
  definition: WorkflowDefinition,
  formSchema: FormDefinitionSchema | null,
): MatrixSession {
  const entries = readDefinitionEntries(definition);

  return {
    draft: entries,
    initial: entries,
    pinnedFieldKeys: new Set(
      readFieldAccessMatrix(definition, formSchema)
        .rows.filter(isRowRelevant)
        .map((row) => row.fieldKey),
    ),
  };
}

function isRowRelevant(row: FieldAccessMatrixRow): boolean {
  return (
    row.cells.some((cell) => cell.explicit !== null) ||
    row.issues.length > 0 ||
    row.notices.length > 0
  );
}

/**
 * The choices a cell offers. Mezzanine's Select has no per-option disabled
 * state, so a choice the field or node cannot take is left out — except the
 * one already chosen, which an old draft may hold and which has to stay
 * readable (its check column says why it blocks publishing).
 */
function readCellOptions(
  cell: FieldAccessMatrixCell,
): readonly { readonly id: FieldAccessChoice; readonly name: string }[] {
  return FIELD_ACCESS_CHOICES.filter(
    (choice) =>
      choice === cell.choice || !cell.disabledChoices.includes(choice),
  ).map((choice) => ({
    id: choice,
    name:
      choice === 'DEFAULT' && cell.choice === 'DEFAULT'
        ? `預設：${FIELD_ACCESS_EFFECTIVE_LABELS[cell.effective]}`
        : FIELD_ACCESS_CHOICE_LABELS[choice],
  }));
}

function readApplicantText(
  row: FieldAccessMatrixRow,
  columns: readonly FieldAccessMatrixColumn[],
): string {
  if (row.applicant.effective === 'FILL') {
    return FIELD_ACCESS_EFFECTIVE_LABELS.FILL;
  }

  const stages = row.fillNodeIds
    .map((nodeId) => columns.find((column) => column.nodeId === nodeId))
    .filter((column): column is FieldAccessMatrixColumn => Boolean(column))
    .map(readFieldAccessStageLabel)
    .join('、');

  return `${FIELD_ACCESS_EFFECTIVE_LABELS.NOT_SHOWN}（${stages} 補填）`;
}

/**
 * The 欄位與關卡總覽 (ADR 20 §3.3): one row per form field, one column per
 * user task in flow order, edited as a draft and written in one
 * `setFieldAccessMatrix` on 套用. The checks are recomputed from the draft
 * with the publish lint's own rules, so a conflict shows before applying.
 */
export function FieldAccessMatrixDrawer({
  definition,
  formSchema,
  language,
  onApply,
  onClose,
  open,
}: FieldAccessMatrixDrawerProps): ReactElement {
  const [session, setSession] = useState<MatrixSession | null>(null);
  const [onlyRelevant, setOnlyRelevant] = useState(true);
  const [applyError, setApplyError] = useState<string | null>(null);

  // Started while rendering the opening, not in an effect, so the first frame
  // already shows the draft. Rebuilt on every opening: an undo or an
  // assistant edit made while the drawer was closed is what it starts from,
  // and edits behind an open drawer do not reset it.
  if (open && session === null) {
    const opened = readMatrixSession(definition, formSchema);

    setSession(opened);
    // With nothing set yet the filter would hide every field and the matrix
    // would open empty, so it starts collapsed only once something is set.
    setOnlyRelevant(opened.pinnedFieldKeys.size > 0);
    setApplyError(null);
  }

  if (!open && session !== null) {
    setSession(null);
  }

  // What 套用 would write: the drawer's edits over the flow as it is now.
  const entries = useMemo(
    () =>
      session === null
        ? null
        : rebaseFieldAccessDraft(
            readDefinitionEntries(definition),
            session.initial,
            session.draft,
            readUserTaskIds(definition),
          ),
    [definition, session],
  );
  const draftDefinition = useMemo(
    () =>
      entries === null
        ? definition
        : readDraftDefinition(definition, formSchema, entries),
    [definition, entries, formSchema],
  );
  const matrix: FieldAccessMatrix = useMemo(
    () =>
      entries === null
        ? EMPTY_MATRIX
        : readFieldAccessMatrix(draftDefinition, formSchema),
    [draftDefinition, entries, formSchema],
  );
  const pinnedFieldKeys = session?.pinnedFieldKeys ?? new Set<string>();
  // Against the draft: an issue the draft raises names fill nodes the
  // applied flow does not have yet, and only the draft can translate them.
  const translate = (message: string): string =>
    readWorkflowLintMessage(message, draftDefinition, language);
  const visibleRows = matrix.rows.filter(
    (row) =>
      !onlyRelevant || pinnedFieldKeys.has(row.fieldKey) || isRowRelevant(row),
  );
  const collapsedCount = matrix.rows.length - visibleRows.length;
  const rowFieldKeys = new Set(matrix.rows.map((row) => row.fieldKey));
  // Issues no row can show: node-level ones and field keys the form lacks.
  const unplacedIssues = matrix.issues.filter(
    (issue) => !issue.fieldKeys.some((fieldKey) => rowFieldKeys.has(fieldKey)),
  );

  function changeCell(
    nodeId: string,
    fieldKey: string,
    choice: FieldAccessChoice,
  ): void {
    setApplyError(null);
    setSession((current) =>
      current === null
        ? null
        : {
            ...current,
            draft: updateFieldAccessDraft(
              current.draft,
              nodeId,
              fieldKey,
              choice,
            ),
            pinnedFieldKeys: new Set([...current.pinnedFieldKeys, fieldKey]),
          },
    );
  }

  function apply(): void {
    const error =
      entries === null ||
      (isSameEntries(entries, readDefinitionEntries(definition)) &&
        isStoredAsRead(definition))
        ? null
        : onApply(entries);

    if (error !== null) {
      // The drawer stays open on its draft, so nothing edited is lost.
      setApplyError(error);

      return;
    }

    onClose();
  }

  const columns: TableColumn<MatrixTableRow>[] = [
    {
      ellipsis: false,
      fixed: 'start',
      key: 'field',
      render: ({ row }): ReactElement => (
        <div style={FIELD_CELL_STYLE}>
          <Typography variant="label-primary">{row.field.label}</Typography>
          <Typography color="text-neutral" variant="caption">
            {row.fieldKey}
          </Typography>
        </div>
      ),
      title: '欄位',
      width: 180,
    },
    {
      ellipsis: false,
      key: 'applicant',
      render: ({ row }): string => readApplicantText(row, matrix.columns),
      title: '申請人',
      width: 160,
    },
    ...matrix.columns.map(
      (column, columnIndex): TableColumn<MatrixTableRow> => ({
        ellipsis: false,
        key: `node:${column.nodeId}`,
        render: ({ row }): ReactElement => {
          const cell = row.cells[columnIndex];
          const options = readCellOptions(cell);

          return (
            <Select
              clearable={false}
              inputProps={{
                'aria-label': `${row.field.label} 在${readFieldAccessStageLabel(column)}的設定`,
              }}
              onChange={(option): void =>
                changeCell(
                  column.nodeId,
                  row.fieldKey,
                  options.find((candidate) => candidate.id === option?.id)
                    ?.id ?? 'DEFAULT',
                )
              }
              options={[...options]}
              size="sub"
              value={
                options.find((option) => option.id === cell.choice) ?? null
              }
            />
          );
        },
        title: (
          <div style={STACK_STYLE}>
            <Typography color="text-neutral" variant="caption">
              {readFieldAccessStageLabel(column)}
              {column.branchLabel ? ` · 分支：${column.branchLabel}` : ''}
            </Typography>
            <Typography variant="label-primary">{column.label}</Typography>
          </div>
        ),
        width: 224,
      }),
    ),
    {
      ellipsis: false,
      key: 'check',
      render: ({ row }): ReactElement => renderCheck(row),
      title: '檢查',
      width: 280,
    },
  ];

  function renderCheck(row: FieldAccessMatrixRow): ReactElement {
    const warnings = row.issues.map((issue) => translate(issue.message));
    const notices = row.notices.map((notice) => {
      const column = matrix.columns.find(
        (candidate) => candidate.nodeId === notice.nodeId,
      );

      return `${column ? readFieldAccessStageLabel(column) : notice.nodeId} 會看到空白欄位：這一關之前還沒有人補填。`;
    });
    // Reasons a fill choice is unavailable; once the field is filled in
    // anyway, the warning above already names the same rule.
    const blockers =
      row.fillNodeIds.length === 0
        ? [
            ...row.fillBlockers.flatMap((issue) => {
              const label = FIELD_ACCESS_FILL_BLOCKER_LABELS[issue.code];

              return label ? [label] : [];
            }),
            ...(row.field.type === 'boolean'
              ? [FIELD_ACCESS_BOOLEAN_REQUIRED_NOTE]
              : []),
          ]
        : [];

    if (warnings.length + notices.length + blockers.length === 0) {
      return <Badge text="沒有問題" variant="dot-success" />;
    }

    return (
      <div style={STACK_STYLE}>
        {warnings.map((text) => (
          <Badge key={`warning:${text}`} text={text} variant="dot-warning" />
        ))}
        {notices.map((text) => (
          <Badge key={`notice:${text}`} text={text} variant="dot-info" />
        ))}
        {[...new Set(blockers)].map((text) => (
          <Badge key={`blocker:${text}`} text={text} variant="dot-info" />
        ))}
      </div>
    );
  }

  return (
    <Drawer
      bottomGhostActionText="取消"
      bottomOnGhostActionClick={onClose}
      bottomOnPrimaryActionClick={apply}
      bottomPrimaryActionText="套用"
      headerTitle="欄位與關卡總覽"
      isBottomDisplay
      isHeaderDisplay
      onClose={onClose}
      open={open}
      size="wide"
    >
      <div style={BODY_STYLE}>
        {/* InlineMessage keeps to one line, so each headline is short and
            the detail goes underneath, where it can wrap. */}
        {applyError === null ? null : (
          <div style={STACK_STYLE}>
            <InlineMessage
              content="無法套用，編輯內容仍保留。"
              severity="error"
            />
            <Badge text={applyError} variant="dot-error" />
          </div>
        )}
        <div style={STACK_STYLE}>
          {matrix.issues.length > 0 ? (
            <InlineMessage
              content={`有 ${matrix.issues.length} 個欄位設定問題，處理完才能發布。`}
              severity="warning"
            />
          ) : (
            <InlineMessage
              content="補填由該關的簽核人在核准時填寫。"
              severity="info"
            />
          )}
          <Typography color="text-neutral" variant="caption">
            {matrix.issues.length > 0
              ? '問題標示在各欄位的「檢查」欄。'
              : `申請人送出時看不到補填欄位。${FIELD_ACCESS_HIDE_NOTE}發布時還會檢查條件是否在補填前就讀取這些欄位。`}
          </Typography>
          {unplacedIssues.map((issue) => (
            <Badge
              key={issue.message}
              text={translate(issue.message)}
              variant="dot-warning"
            />
          ))}
        </div>
        <Toggle
          checked={onlyRelevant}
          inputProps={{ 'aria-label': '只看有設定或有問題的欄位' }}
          label="只看有設定或有問題的欄位"
          onChange={(event): void => setOnlyRelevant(event.target.checked)}
          size="sub"
        />
        {collapsedCount > 0 ? (
          <Typography color="text-neutral" variant="caption">
            已收起 {collapsedCount} 個沒有設定也沒有問題的欄位。
          </Typography>
        ) : null}
        {formSchema === null ? (
          <Typography color="text-neutral" variant="body">
            尚未綁定表單，沒有可設定的欄位。
          </Typography>
        ) : (
          <Table
            columns={columns}
            dataSource={visibleRows.map((row): MatrixTableRow => ({
              key: row.fieldKey,
              row,
            }))}
            fullWidth
          />
        )}
      </div>
    </Drawer>
  );
}
