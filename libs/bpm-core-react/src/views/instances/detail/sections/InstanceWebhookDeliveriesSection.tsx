'use client';

import { CSSProperties, ReactElement, useMemo, useState } from 'react';
import { Badge, Modal, Table, Typography } from '@mezzanine-ui/react';
import { ResetIcon } from '@mezzanine-ui/icons';
import type { TableActions, TableColumn } from '@mezzanine-ui/core/table';
import {
  WorkflowWebhookDeliveryRecord,
  WorkflowWebhookDeliveryStatus,
} from '@rytass/bpm-core-client/workflow';
import { formatDateTime } from '../../../../lib/format-date-time';

const SECTION_BODY_STYLE: CSSProperties = {
  display: 'grid',
  gap: 16,
};

const CELL_STACK_STYLE: CSSProperties = {
  display: 'grid',
  gap: 2,
};

const ERROR_DETAIL_STYLE: CSSProperties = {
  overflowWrap: 'anywhere',
  whiteSpace: 'pre-wrap',
};

type WebhookDeliveryRow = Readonly<
  Record<string, unknown> & {
    delivery: WorkflowWebhookDeliveryRecord;
    key: string;
  }
>;

export interface InstanceWebhookDeliveriesSectionProps {
  /** The instance's notify-node webhook deliveries, oldest first. */
  readonly deliveries: readonly WorkflowWebhookDeliveryRecord[];
  /** Resolves a node id to the label shown to the reader. */
  readonly readNodeLabel: (nodeId: string) => string;
  /**
   * Re-queues a `FAILED` delivery. A rejection is shown in the section, so
   * the caller only needs to refresh what it displays on success.
   */
  readonly onRetry: (delivery: WorkflowWebhookDeliveryRecord) => Promise<void>;
}

/**
 * Administrator-only view of the webhooks this instance's notify nodes sent
 * (ADR 18 §3.10): where each delivery stands, how many attempts it took, the
 * last error, and a retry for the ones that gave up. Carries no URL or
 * payload — the server never sends them to the browser.
 */
export function InstanceWebhookDeliveriesSection({
  deliveries,
  onRetry,
  readNodeLabel,
}: InstanceWebhookDeliveriesSectionProps): ReactElement {
  const [confirming, setConfirming] =
    useState<WorkflowWebhookDeliveryRecord | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(
    (): WebhookDeliveryRow[] =>
      deliveries.map((delivery) => ({ delivery, key: delivery.id })),
    [deliveries],
  );

  const columns = useMemo(
    (): TableColumn<WebhookDeliveryRow>[] => [
      {
        key: 'endpoint',
        render: ({ delivery }: WebhookDeliveryRow): ReactElement => (
          <div style={CELL_STACK_STYLE}>
            <Typography component="span" variant="body">
              {delivery.endpointLabel ?? delivery.endpointKey}
            </Typography>
            <Typography color="text-neutral" component="span" variant="caption">
              {delivery.endpointKey}@{delivery.endpointVersion} ·{' '}
              {readNodeLabel(delivery.nodeId)}
            </Typography>
          </div>
        ),
        title: '外部系統',
        width: 240,
      },
      {
        key: 'status',
        render: ({ delivery }: WebhookDeliveryRow): ReactElement => (
          <WebhookDeliveryStatusBadge status={delivery.status} />
        ),
        title: '狀態',
        width: 120,
      },
      {
        key: 'attemptCount',
        render: ({ delivery }: WebhookDeliveryRow): ReactElement => (
          <Typography component="span" variant="body">
            {delivery.attemptCount}
          </Typography>
        ),
        title: '嘗試次數',
        width: 100,
      },
      {
        key: 'lastError',
        render: ({ delivery }: WebhookDeliveryRow): ReactElement =>
          delivery.lastErrorCode && delivery.status !== 'SENT' ? (
            <div style={CELL_STACK_STYLE}>
              <Typography color="text-error" component="span" variant="body">
                {delivery.lastErrorCode}
              </Typography>
              {delivery.lastErrorDetail ? (
                <Typography
                  color="text-neutral"
                  component="span"
                  style={ERROR_DETAIL_STYLE}
                  variant="caption"
                >
                  {delivery.lastErrorDetail}
                </Typography>
              ) : null}
            </div>
          ) : (
            <Typography color="text-neutral" component="span" variant="body">
              —
            </Typography>
          ),
        title: '最後錯誤',
        width: 280,
      },
      {
        key: 'time',
        render: ({ delivery }: WebhookDeliveryRow): ReactElement => (
          <Typography component="span" variant="body">
            {readDeliveryTimeLabel(delivery)}
          </Typography>
        ),
        title: '時間',
        width: 220,
      },
    ],
    [readNodeLabel],
  );

  const actions = useMemo(
    (): TableActions<WebhookDeliveryRow> => ({
      render: ({
        delivery,
      }): ReturnType<TableActions<WebhookDeliveryRow>['render']> =>
        // A row that failed while being queued was never sent and its frozen
        // event never passed the parameter checks; the server refuses it too.
        delivery.status === 'FAILED' && delivery.attemptCount > 0
          ? [
              {
                disabled: (): boolean => retrying,
                icon: ResetIcon,
                iconType: 'leading',
                name: '重新傳送',
                onClick: (): void => {
                  setError(null);
                  setConfirming(delivery);
                },
              },
            ]
          : [],
      variant: 'base-secondary',
      width: 140,
    }),
    [retrying],
  );

  async function handleConfirmRetry(): Promise<void> {
    if (!confirming) {
      return;
    }

    setRetrying(true);
    setError(null);

    try {
      await onRetry(confirming);
      setConfirming(null);
    } catch (retryError: unknown) {
      setConfirming(null);
      setError(
        retryError instanceof Error && retryError.message
          ? retryError.message
          : '重新傳送失敗，請稍後再試。',
      );
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div style={SECTION_BODY_STYLE}>
      <Typography component="h2" variant="h3">
        外部系統通知
      </Typography>
      {error ? (
        <Typography color="text-error" variant="body">
          {error}
        </Typography>
      ) : null}
      {rows.length > 0 ? (
        <Table
          actions={actions}
          columns={columns}
          dataSource={rows}
          fullWidth
        />
      ) : (
        <Typography color="text-neutral" variant="body">
          此案件沒有外部系統通知。
        </Typography>
      )}
      <Modal
        cancelText="取消"
        confirmText="重新傳送"
        loading={retrying}
        modalStatusType="info"
        modalType="standard"
        onCancel={(): void => setConfirming(null)}
        onClose={(): void => setConfirming(null)}
        onConfirm={(): void => void handleConfirmRetry()}
        open={Boolean(confirming)}
        showModalFooter
        showModalHeader
        supportingText="會以相同的投遞編號重新送出，接收端可據此避免重複處理。"
        title="重新傳送通知"
      >
        <Typography variant="body">
          確定要重新通知「
          {confirming?.endpointLabel ?? confirming?.endpointKey ?? ''}」嗎？
        </Typography>
      </Modal>
    </div>
  );
}

function WebhookDeliveryStatusBadge({
  status,
}: {
  readonly status: WorkflowWebhookDeliveryStatus;
}): ReactElement {
  if (status === 'SENT') {
    return <Badge size="sub" text="已送達" variant="dot-success" />;
  }

  if (status === 'FAILED') {
    return <Badge size="sub" text="失敗" variant="dot-error" />;
  }

  return (
    <Badge
      size="sub"
      text={status === 'PENDING' ? '等待傳送' : '傳送中'}
      variant="dot-info"
    />
  );
}

function readDeliveryTimeLabel(
  delivery: WorkflowWebhookDeliveryRecord,
): string {
  if (delivery.sentAt) {
    return `送達：${formatDateTime(delivery.sentAt)}`;
  }

  if (delivery.status === 'PENDING' && delivery.nextRetryAt) {
    return `下次重試：${formatDateTime(delivery.nextRetryAt)}`;
  }

  return delivery.lastAttemptAt
    ? `最後嘗試：${formatDateTime(delivery.lastAttemptAt)}`
    : `建立：${formatDateTime(delivery.createdAt)}`;
}
