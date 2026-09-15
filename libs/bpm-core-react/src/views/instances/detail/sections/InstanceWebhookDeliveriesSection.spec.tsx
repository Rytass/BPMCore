import { act, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { WorkflowWebhookDeliveryRecord } from '@rytass/bpm-core-client/workflow';
import { InstanceWebhookDeliveriesSection } from './InstanceWebhookDeliveriesSection';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

jest.mock('@mezzanine-ui/core/table', () => ({}));

// `@mezzanine-ui/react` is ESM-only; the stubs render just enough — cells,
// row actions and the modal's confirm — for the section's own logic to be
// driven through the DOM.
jest.mock('@mezzanine-ui/react', () => {
  interface MockAction {
    readonly disabled?: (record: unknown) => boolean;
    readonly name: string;
    readonly onClick: () => void;
  }

  function MockTable(props: Readonly<Record<string, unknown>>): ReactElement {
    const columns = props.columns as readonly {
      readonly key: string;
      readonly render: (row: unknown) => ReactNode;
    }[];
    const rows = props.dataSource as readonly { readonly key: string }[];
    const actions = props.actions as {
      readonly render: (row: unknown) => readonly MockAction[];
    };

    return (
      <div>
        {rows.map((row): ReactElement => (
          <div data-row={row.key} key={row.key}>
            {columns.map((column): ReactElement => (
              <span data-cell={column.key} key={column.key}>
                {column.render(row)}
              </span>
            ))}
            {actions.render(row).map((action): ReactElement => (
              <button
                disabled={action.disabled?.(row)}
                key={action.name}
                onClick={action.onClick}
                type="button"
              >
                {action.name}
              </button>
            ))}
          </div>
        ))}
      </div>
    );
  }

  function MockModal(
    props: Readonly<Record<string, unknown>>,
  ): ReactElement | null {
    return props.open ? (
      <div data-modal="">
        {props.children as ReactNode}
        <button onClick={props.onConfirm as () => void} type="button">
          {props.confirmText as string}
        </button>
      </div>
    ) : null;
  }

  return {
    Badge: (props: Readonly<Record<string, unknown>>): ReactElement => (
      <span data-badge={props.variant as string}>{props.text as string}</span>
    ),
    Modal: MockModal,
    Table: MockTable,
    Typography: (props: Readonly<Record<string, unknown>>): ReactElement => (
      <span>{props.children as ReactNode}</span>
    ),
  };
});

function delivery(
  overrides: Partial<WorkflowWebhookDeliveryRecord>,
): WorkflowWebhookDeliveryRecord {
  return {
    attemptCount: 1,
    createdAt: '2026-09-15T10:00:00.000Z',
    endpointKey: 'demo.ok',
    endpointLabel: '示範：採購核准',
    endpointVersion: 1,
    id: 'delivery-ok',
    instanceId: 'instance-1',
    lastAttemptAt: '2026-09-15T10:00:01.000Z',
    lastErrorCode: null,
    lastErrorDetail: null,
    lastResponseStatus: 200,
    nextRetryAt: null,
    nodeId: 'notify',
    sentAt: '2026-09-15T10:00:01.000Z',
    status: 'SENT',
    targetId: 'wh-ok',
    updatedAt: '2026-09-15T10:00:01.000Z',
    ...overrides,
  };
}

const FAILED = delivery({
  attemptCount: 6,
  endpointKey: 'demo.flaky',
  endpointLabel: null,
  id: 'delivery-failed',
  lastErrorCode: 'WEBHOOK_HTTP_503',
  lastErrorDetail: 'service unavailable',
  lastResponseStatus: 503,
  sentAt: null,
  status: 'FAILED',
  targetId: 'wh-flaky',
});

// Failed while being queued: never sent, so there is nothing to send again.
const QUEUE_FAILED = delivery({
  attemptCount: 0,
  endpointKey: 'demo.gone',
  id: 'delivery-queue-failed',
  lastAttemptAt: null,
  lastErrorCode: 'WEBHOOK_ENDPOINT_MISSING',
  lastResponseStatus: null,
  sentAt: null,
  status: 'FAILED',
  targetId: 'wh-gone',
});

describe('InstanceWebhookDeliveriesSection', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach((): void => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach((): void => {
    act((): void => root.unmount());
    container.remove();
  });

  function render(
    onRetry: (record: WorkflowWebhookDeliveryRecord) => Promise<void>,
  ): void {
    act((): void => {
      root.render(
        <InstanceWebhookDeliveriesSection
          deliveries={[delivery({}), FAILED, QUEUE_FAILED]}
          onRetry={onRetry}
          readNodeLabel={(nodeId): string => `節點 ${nodeId}`}
        />,
      );
    });
  }

  function readRow(id: string): HTMLElement {
    const row = container.querySelector<HTMLElement>(`[data-row="${id}"]`);

    if (!row) {
      throw new Error(`row ${id} was not rendered`);
    }

    return row;
  }

  function clickButton(scope: ParentNode, name: string): Promise<void> {
    const button = [...scope.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === name,
    );

    if (!button) {
      throw new Error(`button ${name} was not rendered`);
    }

    return act(async (): Promise<void> => {
      button.click();
    });
  }

  it('shows status, the error only for undelivered rows, and the key when the label is gone', (): void => {
    render(async (): Promise<void> => undefined);

    expect(readRow('delivery-ok').textContent).toContain('已送達');
    expect(readRow('delivery-ok').textContent).not.toContain('WEBHOOK_');
    expect(readRow('delivery-failed').textContent).toContain(
      'WEBHOOK_HTTP_503',
    );
    expect(
      readRow('delivery-failed').querySelector('[data-cell="endpoint"]')
        ?.textContent,
    ).toContain('demo.flaky');
    expect(
      readRow('delivery-failed')
        .querySelector('[data-badge]')
        ?.getAttribute('data-badge'),
    ).toBe('dot-error');
  });

  it('offers a retry only on FAILED rows and sends it after confirmation', async (): Promise<void> => {
    const onRetry = jest.fn(async (): Promise<void> => undefined);

    render(onRetry);

    expect(readRow('delivery-ok').querySelector('button')).toBeNull();
    expect(readRow('delivery-queue-failed').querySelector('button')).toBeNull();

    await clickButton(readRow('delivery-failed'), '重新傳送');
    expect(onRetry).not.toHaveBeenCalled();

    const modal = container.querySelector('[data-modal]');

    expect(modal).not.toBeNull();
    await clickButton(modal as Element, '重新傳送');

    expect(onRetry).toHaveBeenCalledWith(FAILED);
    expect(container.querySelector('[data-modal]')).toBeNull();
  });

  it('shows why a retry was refused', async (): Promise<void> => {
    render(async (): Promise<void> => {
      throw new Error('only FAILED deliveries can be retried');
    });

    await clickButton(readRow('delivery-failed'), '重新傳送');
    await clickButton(
      container.querySelector('[data-modal]') as Element,
      '重新傳送',
    );

    expect(container.textContent).toContain(
      'only FAILED deliveries can be retried',
    );
  });
});
