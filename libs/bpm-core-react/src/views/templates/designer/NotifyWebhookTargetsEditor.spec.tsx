import { act, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { NotifyWebhookTarget } from '@rytass/bpm-core-shared/workflow';
import {
  NOTIFY_WEBHOOK_NO_ENDPOINTS_MESSAGE,
  NotifyWebhookTargetsEditor,
} from './NotifyWebhookTargetsEditor';
import type { NotifyWebhookDesignerEndpoint } from './notify-webhook-designer';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

jest.mock('@mezzanine-ui/core/form', () => ({
  FormFieldDensity: { TIGHT: 'tight' },
  FormFieldLayout: { HORIZONTAL: 'horizontal', VERTICAL: 'vertical' },
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
  const InlineMessage = (
    props: Readonly<Record<string, unknown>>,
  ): ReactElement => (
    <div data-severity={props.severity as string} role="status">
      {props.content as string}
    </div>
  );

  return {
    Button,
    FormField: Container,
    InlineMessage,
    Input: (): ReactElement => <input />,
    Select: (): ReactElement => <select />,
    Textarea: (): ReactElement => <textarea />,
    Typography: Container,
  };
});

const ACTIVE_ENDPOINT: NotifyWebhookDesignerEndpoint = {
  deprecated: false,
  description: null,
  key: 'demo.ok',
  label: '示範端點',
  parameters: [],
  source: 'REGISTRY',
  version: 1,
} as unknown as NotifyWebhookDesignerEndpoint;

const DEPRECATED_ENDPOINT: NotifyWebhookDesignerEndpoint = {
  ...ACTIVE_ENDPOINT,
  deprecated: true,
  key: 'demo.old',
} as NotifyWebhookDesignerEndpoint;

const EXISTING_TARGET: NotifyWebhookTarget = {
  bindings: [],
  endpoint: { key: 'demo.old', version: 1 },
  id: 'target-1',
};

describe('NotifyWebhookTargetsEditor', () => {
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
    props: Partial<Parameters<typeof NotifyWebhookTargetsEditor>[0]>,
  ): void {
    act((): void => {
      root.render(
        <NotifyWebhookTargetsEditor
          catalog={[]}
          catalogState="ready"
          formFields={[]}
          onChange={jest.fn()}
          targets={[]}
          {...props}
        />,
      );
    });
  }

  it('explains that no endpoint is available when the catalog is empty', (): void => {
    render({ catalog: [] });

    expect(container.textContent).toContain('Webhook');
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      NOTIFY_WEBHOOK_NO_ENDPOINTS_MESSAGE,
    );
    expect(container.textContent).not.toContain('新增 Webhook');
  });

  it('treats a catalog of only deprecated endpoints as empty', (): void => {
    render({ catalog: [DEPRECATED_ENDPOINT] });

    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      NOTIFY_WEBHOOK_NO_ENDPOINTS_MESSAGE,
    );
  });

  it('stays hidden when the catalog could not be loaded', (): void => {
    render({ catalogState: 'unavailable' });

    expect(container.innerHTML).toBe('');
  });

  it('offers adding a webhook when an endpoint is available', (): void => {
    render({ catalog: [ACTIVE_ENDPOINT] });

    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.textContent).toContain('新增 Webhook');
  });

  it('keeps existing targets editable even when no endpoint is available', (): void => {
    render({ catalog: [DEPRECATED_ENDPOINT], targets: [EXISTING_TARGET] });

    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.textContent).toContain('新增 Webhook');
  });
});
