import { act, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { WorkflowWebhookManagedEndpointRecord } from '@rytass/bpm-core-client/template';
import * as templateApi from '@rytass/bpm-core-client/template';
import { AdminWebhookEndpointsView } from './AdminWebhookEndpointsView';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

jest.mock('@mezzanine-ui/core/table', () => ({}));
jest.mock('@mezzanine-ui/core/form', () => ({
  FormFieldDensity: { TIGHT: 'tight' },
  FormFieldLayout: { HORIZONTAL: 'horizontal', VERTICAL: 'vertical' },
}));
jest.mock('@mezzanine-ui/react/ContentHeader', () => ({
  __esModule: true,
  default: (props: Readonly<Record<string, unknown>>): ReactElement => (
    <header>
      <h1>{props.title as string}</h1>
      {props.children as ReactNode}
    </header>
  ),
}));

jest.mock('@mezzanine-ui/react', () => {
  const Container = (
    props: Readonly<Record<string, unknown>>,
  ): ReactElement => <div>{props.children as ReactNode}</div>;
  const Button = (props: Readonly<Record<string, unknown>>): ReactElement => (
    <button
      disabled={Boolean(props.disabled)}
      onClick={props.onClick as () => void}
      type="button"
    >
      {props.children as ReactNode}
    </button>
  );
  const Table = (props: Readonly<Record<string, unknown>>): ReactElement => {
    const columns = props.columns as readonly {
      readonly key: string;
      readonly render: (row: unknown) => ReactNode;
    }[];
    const rows = props.dataSource as readonly { readonly key: string }[];
    const actions = props.actions as
      | {
          readonly render: (
            row: unknown,
          ) => readonly {
            readonly name: string;
            readonly onClick: () => void;
          }[];
        }
      | undefined;

    return (
      <div>
        {rows.map((row): ReactElement => (
          <div data-row={row.key} key={row.key}>
            {columns.map((column): ReactElement => (
              <span key={column.key}>{column.render(row)}</span>
            ))}
            {(actions?.render(row) ?? []).map((action): ReactElement => (
              <button key={action.name} onClick={action.onClick} type="button">
                {action.name}
              </button>
            ))}
          </div>
        ))}
      </div>
    );
  };

  return {
    Badge: (props: Readonly<Record<string, unknown>>): ReactElement => (
      <span>{props.text as string}</span>
    ),
    Button,
    FormField: Container,
    Input: Container,
    Modal: (props: Readonly<Record<string, unknown>>): ReactElement | null =>
      props.open ? (
        <div data-modal="">{props.children as ReactNode}</div>
      ) : null,
    PageHeader: Container,
    Section: Container,
    SectionGroup: Container,
    Select: Container,
    Table,
    Textarea: Container,
    Toggle: Container,
    Typography: (props: Readonly<Record<string, unknown>>): ReactElement => (
      <span>{props.children as ReactNode}</span>
    ),
  };
});

jest.mock('@rytass/bpm-core-client/template', () => ({
  createWorkflowWebhookEndpoint: jest.fn(),
  listWorkflowWebhookEndpointAudits: jest.fn(),
  listWorkflowWebhookManagedEndpoints: jest.fn(),
  readWorkflowWebhookEndpointManagement: jest.fn(),
  rotateWorkflowWebhookEndpointSecret: jest.fn(),
  setWorkflowWebhookEndpointActive: jest.fn(),
  testWorkflowWebhookEndpoint: jest.fn(),
  updateWorkflowWebhookEndpoint: jest.fn(),
}));

const api = templateApi as jest.Mocked<typeof templateApi>;

const ENDPOINT: WorkflowWebhookManagedEndpointRecord = {
  active: true,
  createdAt: '2026-09-15T00:00:00.000Z',
  createdByMemberId: 'member-001',
  deprecated: false,
  description: null,
  hasSigningSecret: true,
  headerNames: ['Authorization'],
  id: 'endpoint-1',
  key: 'crm.lead',
  label: 'CRM 名單',
  method: 'POST',
  parameters: [],
  secretRotatedAt: null,
  timeoutMs: null,
  updatedAt: '2026-09-15T00:00:00.000Z',
  updatedByMemberId: 'member-001',
  url: 'https://crm.example.com/hooks',
  version: 1,
};

describe('AdminWebhookEndpointsView', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach((): void => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    jest.clearAllMocks();
  });

  afterEach((): void => {
    act((): void => root.unmount());
    container.remove();
  });

  async function render(): Promise<void> {
    await act(async (): Promise<void> => {
      root.render(<AdminWebhookEndpointsView />);
    });
  }

  function button(name: string): HTMLButtonElement {
    const found = [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === name,
    );

    if (!found) {
      throw new Error(`button ${name} was not rendered`);
    }

    return found;
  }

  it('explains that the server does not manage endpoints and blocks creating one', async (): Promise<void> => {
    api.readWorkflowWebhookEndpointManagement.mockResolvedValue({
      allowedUrlPatterns: [],
      enabled: false,
    });

    await render();

    expect(container.textContent).toContain(
      '此伺服器未啟用後台維護的 Webhook 端點',
    );
    expect(button('新增端點').disabled).toBe(true);
    expect(api.listWorkflowWebhookManagedEndpoints).not.toHaveBeenCalled();
  });

  it('lists endpoints with header names and secret status but no values', async (): Promise<void> => {
    api.readWorkflowWebhookEndpointManagement.mockResolvedValue({
      allowedUrlPatterns: ['https://*.example.com/hooks'],
      enabled: true,
    });
    api.listWorkflowWebhookManagedEndpoints.mockResolvedValue([ENDPOINT]);

    await render();

    const row = container.querySelector('[data-row="endpoint-1"]');

    expect(row?.textContent).toContain('crm.lead@1');
    expect(row?.textContent).toContain('已設定簽章金鑰');
    expect(row?.textContent).toContain('Header：Authorization');
    expect(container.textContent).toContain(
      '允許的 URL：https://*.example.com/hooks',
    );
  });

  it('disables an endpoint and reports it', async (): Promise<void> => {
    api.readWorkflowWebhookEndpointManagement.mockResolvedValue({
      allowedUrlPatterns: ['https://*.example.com/hooks'],
      enabled: true,
    });
    api.listWorkflowWebhookManagedEndpoints.mockResolvedValue([ENDPOINT]);
    api.setWorkflowWebhookEndpointActive.mockResolvedValue({
      ...ENDPOINT,
      active: false,
    });

    await render();
    await act(async (): Promise<void> => {
      button('停用').click();
    });

    expect(api.setWorkflowWebhookEndpointActive).toHaveBeenCalledWith(
      'endpoint-1',
      false,
    );
    expect(container.textContent).toContain('已停用「CRM 名單」。');
  });

  it('shows a readable message when a test send is rate limited', async (): Promise<void> => {
    api.readWorkflowWebhookEndpointManagement.mockResolvedValue({
      allowedUrlPatterns: ['https://*.example.com/hooks'],
      enabled: true,
    });
    api.listWorkflowWebhookManagedEndpoints.mockResolvedValue([ENDPOINT]);
    api.testWorkflowWebhookEndpoint.mockRejectedValue(
      new Error('WORKFLOW_WEBHOOK_TEST_RATE_LIMITED: wait'),
    );

    await render();
    await act(async (): Promise<void> => {
      button('測試送出').click();
    });

    expect(container.textContent).toContain('測試送出太頻繁');
  });
});
