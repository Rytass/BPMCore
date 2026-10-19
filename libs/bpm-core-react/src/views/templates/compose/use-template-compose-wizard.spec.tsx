import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  BPMLanguageProvider,
  type BPMLanguage,
} from '../../../lib/language-provider';
import {
  useTemplateComposeWizard,
  type TemplateComposeWizard,
} from './use-template-compose-wizard';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const composeApprovalTemplateWithForm = jest.fn();

// Only the request is stubbed: the lint translation is the real one, so these
// cases cover the provider → hook → `readWorkflowLintMessage` path end to end.
jest.mock('@rytass/bpm-core-client/template', () => ({
  ...jest.requireActual('@rytass/bpm-core-client/template'),
  composeApprovalTemplateWithForm: (...args: readonly unknown[]): unknown =>
    composeApprovalTemplateWithForm(...args),
}));

describe('useTemplateComposeWizard publish errors', (): void => {
  let container: HTMLElement;
  let root: Root;
  let wizard: TemplateComposeWizard | null = null;

  function Harness(): null {
    wizard = useTemplateComposeWizard();

    return null;
  }

  function render(language?: BPMLanguage): void {
    const tree: ReactElement = language ? (
      <BPMLanguageProvider language={language}>
        <Harness />
      </BPMLanguageProvider>
    ) : (
      <Harness />
    );

    act((): void => {
      root.render(tree);
    });
  }

  async function publish(): Promise<string | null> {
    await act(async (): Promise<void> => {
      await wizard?.publish();
    });

    return wizard?.publishError ?? null;
  }

  beforeEach((): void => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    composeApprovalTemplateWithForm.mockRejectedValue(
      new Error('workflow must include at least one endEvent node'),
    );
  });

  afterEach((): void => {
    act((): void => {
      root.unmount();
    });
    container.remove();
    wizard = null;
    composeApprovalTemplateWithForm.mockReset();
  });

  it('writes the lint line in Chinese without a provider', async (): Promise<void> => {
    render();

    expect(await publish()).toBe('流程至少要有一個「結束」節點。');
  });

  it('follows the language the host switches to', async (): Promise<void> => {
    render('en');

    expect(await publish()).toBe(
      'The flow needs at least one "End" (結束) node.',
    );

    render('zh-TW');

    expect(await publish()).toBe('流程至少要有一個「結束」節點。');
  });

  it('writes the unknown-error fallback in the active language', async (): Promise<void> => {
    composeApprovalTemplateWithForm.mockRejectedValue('not an Error');
    render('en');

    expect(await publish()).toBe('An unknown error occurred');
  });
});
