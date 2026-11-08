'use client';

import {
  type CSSProperties,
  type ReactElement,
  useEffect,
  useState,
} from 'react';
import type { TableColumn } from '@mezzanine-ui/core/table';
import {
  InlineMessage,
  Modal,
  Table,
  Typography,
} from '@mezzanine-ui/react';
import {
  WorkflowDialectDifferenceRecord,
  WorkflowDialectUpgradePreviewRecord,
  WorkflowExpressionsDraft,
  previewWorkflowDialectUpgrade,
  readExpressionIssueMessage,
  readExpressionLabelLocation,
} from '@rytass/bpm-core-client/template';

export interface DialectUpgradeModalProps {
  /** The draft to check: the designer's current state, saved or not. */
  readonly draft: WorkflowExpressionsDraft;
  readonly onCancel: () => void;
  /** The user confirmed; the host switches the draft to cel-v2. */
  readonly onConfirm: () => void;
  readonly open: boolean;
  /** Injectable for tests and Storybook. */
  readonly preview?: (
    draft: WorkflowExpressionsDraft,
  ) => Promise<WorkflowDialectUpgradePreviewRecord>;
}

// A type literal, not an interface: Table wants an index signature.
type DifferenceRow = {
  readonly difference: WorkflowDialectDifferenceRecord;
  readonly key: string;
};

const STACK_STYLE: CSSProperties = {
  display: 'grid',
  gap: 'var(--mzn-spacing-gap-base)',
};

/** `ok:<json>` / `err:<code>` as the designer reads it. */
export function readDialectOutcomeText(outcome: string): string {
  if (outcome.startsWith('ok:')) {
    return `結果 ${outcome.slice(3)}`;
  }

  if (outcome.startsWith('err:')) {
    return `錯誤 ${outcome.slice(4)}`;
  }

  return outcome;
}

const SAMPLE_LABELS: Readonly<Record<string, string>> = {
  EMPTY: '欄位都沒填',
  FILLED: '欄位都有值',
};

/** Whether the check lets the user upgrade on it. */
export function canConfirmDialectUpgrade(
  result: WorkflowDialectUpgradePreviewRecord | null,
): boolean {
  return result !== null && result.complete;
}

/**
 * The whole-draft dialect upgrade (Phase 23 P4, docs/24 §1): before a draft
 * moves from cel-legacy to cel-v2 the backend runs every expression under
 * both engines on sample data and lists where the answers differ, e.g.
 * `7 / 2` is 3.5 on legacy and an integer division on cel-v2. Nothing is
 * changed here; confirming hands the decision back to the designer, which
 * sets the dialect on the draft and saves it the usual way.
 */
export function DialectUpgradeModal({
  draft,
  onCancel,
  onConfirm,
  open,
  preview = previewWorkflowDialectUpgrade,
}: DialectUpgradeModalProps): ReactElement {
  const [result, setResult] =
    useState<WorkflowDialectUpgradePreviewRecord | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect((): (() => void) => {
    let cancelled = false;

    setResult(null);
    setFailed(false);

    if (open) {
      preview(draft)
        .then((next): void => {
          if (!cancelled) {
            setResult(next);
          }
        })
        .catch((): void => {
          if (!cancelled) {
            setFailed(true);
          }
        });
    }

    return (): void => {
      cancelled = true;
    };
    // The draft is read when the modal opens; edits behind it do not rerun it.
  }, [open]);

  const columns: TableColumn<DifferenceRow>[] = [
    {
      ellipsis: false,
      key: 'label',
      render: ({ difference }): string =>
        readExpressionLabelLocation(difference.label, draft.workflowDefinition) ??
        difference.label,
      title: '位置',
    },
    {
      key: 'sample',
      render: ({ difference }): string =>
        SAMPLE_LABELS[difference.sample] ?? difference.sample,
      title: '試算資料',
      width: 120,
    },
    {
      ellipsis: false,
      key: 'legacy',
      render: ({ difference }): string =>
        readDialectOutcomeText(difference.legacyOutcome),
      title: '目前（cel-legacy）',
    },
    {
      ellipsis: false,
      key: 'v2',
      render: ({ difference }): string =>
        readDialectOutcomeText(difference.v2Outcome),
      title: '升級後（cel-v2）',
    },
  ];

  return (
    <Modal
      cancelText="取消"
      confirmButtonProps={{ disabled: !canConfirmDialectUpgrade(result) }}
      confirmText="確認升級"
      loading={open && result === null && !failed}
      modalType="standard"
      onCancel={onCancel}
      onClose={onCancel}
      onConfirm={onConfirm}
      open={open}
      showModalFooter
      showModalHeader
      size="wide"
      supportingText="升級只改這份草稿，儲存並發布後才會影響新案件；已發布的版本維持原本的方言。"
      title="升級運算式方言到 cel-v2"
    >
      <div style={STACK_STYLE}>
        {failed ? (
          <InlineMessage
            content="無法完成升級前的比對，請稍後再試。"
            severity="error"
          />
        ) : null}
        {result === null ? null : (
          <>
            <Typography variant="body">
              {`共 ${result.expressionCount} 個運算式，已比對 ${result.checkedCount} 個；${
                result.differences.length === 0
                  ? '兩種方言的結果都相同。'
                  : `${result.differences.length} 處結果不同，請逐一確認。`
              }`}
            </Typography>
            {result.complete ? null : (
              <InlineMessage
                content="比對逾時、沒有全部完成，不能據此升級。"
                severity="error"
              />
            )}
            {result.differences.length > 0 ? (
              <Table
                columns={columns}
                dataSource={result.differences.map(
                  (difference, index): DifferenceRow => ({
                    difference,
                    key: `${difference.label}:${difference.sample}:${index}`,
                  }),
                )}
                fullWidth
              />
            ) : null}
            {result.v2Issues.map((issue, index) => (
              <InlineMessage
                content={readExpressionIssueMessage(
                  issue,
                  draft.workflowDefinition,
                )}
                key={`${issue.label}:${issue.code}:${index}`}
                severity={issue.severity === 'ERROR' ? 'error' : 'warning'}
              />
            ))}
          </>
        )}
      </div>
    </Modal>
  );
}
