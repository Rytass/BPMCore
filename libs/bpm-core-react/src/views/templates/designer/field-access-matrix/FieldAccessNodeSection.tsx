import type { CSSProperties, ReactElement } from 'react';
import { Badge, Button, InlineMessage, Typography } from '@mezzanine-ui/react';
import { readNodeFieldAccessIssues } from '@rytass/bpm-core-shared';
import type {
  UserTaskNode,
  WorkflowDefinition,
} from '@rytass/bpm-core-shared/workflow';
import { readWorkflowLintMessage } from '@rytass/bpm-core-client/template';
import type { BPMLanguage } from '../../../../lib/language-provider';
import {
  FIELD_ACCESS_HIDE_NOTE,
  isFillConflictIssue,
  readFieldAccessNodeCounts,
} from './field-access-copy';

export interface FieldAccessNodeSectionProps {
  readonly definition: WorkflowDefinition;
  readonly language: BPMLanguage;
  readonly node: UserTaskNode;
  /** Why the overview cannot open (no form bound), else `null`. */
  readonly openDisabledReason: string | null;
  readonly onOpenMatrix: () => void;
  readonly onRemoveLegacy: () => void;
}

const SECTION_STYLE: CSSProperties = {
  borderTop: '1px solid var(--mzn-color-border-neutral)',
  display: 'grid',
  gap: 8,
  paddingTop: 12,
};

const HEADING_ROW_STYLE: CSSProperties = {
  alignItems: 'center',
  display: 'flex',
  gap: 8,
  justifyContent: 'space-between',
};

/**
 * The node panel's summary of the node's field access (ADR 20 §3.3: the
 * overview is the only place to set it, so the panel only counts and points
 * there). It also carries the two warnings that belong to the node itself:
 * a leftover `fieldPermissions` key, and a node setting that cannot let its
 * approver fill fields in.
 */
export function FieldAccessNodeSection({
  definition,
  language,
  node,
  onOpenMatrix,
  onRemoveLegacy,
  openDisabledReason,
}: FieldAccessNodeSectionProps): ReactElement {
  const counts = readFieldAccessNodeCounts(node);
  const conflictMessages = readNodeFieldAccessIssues(node)
    .filter(isFillConflictIssue)
    .map((issue) =>
      readWorkflowLintMessage(issue.message, definition, language),
    );

  return (
    <section aria-label="欄位顯示與補填" style={SECTION_STYLE}>
      <div style={HEADING_ROW_STYLE}>
        <Typography component="h3" variant="h3">
          欄位顯示與補填
        </Typography>
        <Button
          disabled={openDisabledReason !== null}
          onClick={onOpenMatrix}
          size="sub"
          title={openDisabledReason ?? undefined}
          variant="base-secondary"
        >
          開啟欄位總覽
        </Button>
      </div>
      <Typography color="text-neutral" variant="body">
        本關補填 {counts.fill} 個（必填 {counts.required}）
      </Typography>
      <Typography color="text-neutral" variant="body">
        本關隱藏 {counts.hidden} 個
      </Typography>
      <Typography color="text-neutral" variant="body">
        其他欄位依預設
      </Typography>
      {openDisabledReason ? (
        <Typography color="text-neutral" variant="caption">
          {openDisabledReason}
        </Typography>
      ) : null}
      <Typography color="text-neutral" variant="caption">
        {FIELD_ACCESS_HIDE_NOTE}
      </Typography>
      {node.data.fieldPermissions !== undefined ? (
        <>
          <InlineMessage
            content="含已停用的舊欄位權限設定"
            severity="warning"
          />
          <Typography color="text-neutral" variant="caption">
            舊設定（fieldPermissions）從未生效，也不會自動轉換；移除後才能發布，需要的設定請在欄位總覽重新指定。
          </Typography>
          <div>
            <Button
              onClick={onRemoveLegacy}
              size="sub"
              variant="base-secondary"
            >
              移除舊設定
            </Button>
          </div>
        </>
      ) : null}
      {conflictMessages.map((message) => (
        <Badge key={message} text={message} variant="dot-warning" />
      ))}
    </section>
  );
}
