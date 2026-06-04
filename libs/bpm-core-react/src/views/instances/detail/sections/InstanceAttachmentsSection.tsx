'use client';

import { CSSProperties, ReactElement, useMemo } from 'react';
import { Table, Typography } from '@mezzanine-ui/react';
import { DownloadIcon, FileSearchIcon } from '@mezzanine-ui/icons';
import type { TableActions, TableColumn } from '@mezzanine-ui/core/table';
import { AttachmentRecord } from '@rytass/bpm-core-client/workflow';
import { formatDateTime } from '../../../../lib/format-date-time';
import { AttachmentRow, formatFileSize } from './shared';

const SECTION_BODY_STYLE: CSSProperties = {
  display: 'grid',
  gap: 16,
};

export interface InstanceAttachmentsSectionProps {
  /** The list of attachments for this instance. */
  readonly attachments: readonly AttachmentRecord[];
  /** Called when the user clicks the download action for an attachment. */
  readonly onDownload: (attachment: AttachmentRecord) => void;
  /** Called when the user clicks the preview action for a PDF attachment. */
  readonly onPreview: (attachment: AttachmentRecord) => void;
}

/**
 * Renders the attachments section of the approval instance detail page.
 * Shows a table of attachments with download and (for PDFs) preview actions.
 */
export function InstanceAttachmentsSection({
  attachments,
  onDownload,
  onPreview,
}: InstanceAttachmentsSectionProps): ReactElement {
  const attachmentRows = useMemo(
    (): AttachmentRow[] =>
      attachments.map((attachment) => ({
        attachment,
        createdAt: attachment.createdAt,
        filename: attachment.filename,
        id: attachment.id,
        key: attachment.id,
        mimeType: attachment.mimeType,
        sizeLabel: formatFileSize(Number(attachment.sizeBytes)),
      })),
    [attachments],
  );

  const attachmentColumns = useMemo(
    (): TableColumn<AttachmentRow>[] => [
      { dataIndex: 'filename', key: 'filename', title: '檔名', width: 260 },
      { dataIndex: 'mimeType', key: 'mimeType', title: '類型', width: 180 },
      { dataIndex: 'sizeLabel', key: 'sizeLabel', title: '大小', width: 120 },
      {
        key: 'createdAt',
        render: (record: AttachmentRow): ReactElement => (
          <Typography component="span" variant="body">
            {formatDateTime(record.createdAt)}
          </Typography>
        ),
        title: '上傳時間',
        width: 220,
      },
    ],
    [],
  );

  const attachmentActions = useMemo(
    (): TableActions<AttachmentRow> => ({
      render: (record): ReturnType<TableActions<AttachmentRow>['render']> => [
        ...(record.mimeType === 'application/pdf'
          ? [
              {
                icon: FileSearchIcon,
                iconType: 'leading' as const,
                name: '預覽',
                onClick: (): void => {
                  onPreview(record.attachment);
                },
              },
            ]
          : []),
        {
          icon: DownloadIcon,
          iconType: 'leading',
          name: '下載',
          onClick: (): void => {
            onDownload(record.attachment);
          },
        },
      ],
      variant: 'base-secondary',
      width: 160,
    }),
    [onDownload, onPreview],
  );

  return (
    <div style={SECTION_BODY_STYLE}>
      <Typography component="h2" variant="h3">
        附件
      </Typography>
      {attachmentRows.length > 0 ? (
        <Table
          actions={attachmentActions}
          columns={attachmentColumns}
          dataSource={attachmentRows}
          fullWidth
        />
      ) : (
        <Typography color="text-neutral" variant="body">
          此案件沒有附件。
        </Typography>
      )}
    </div>
  );
}
