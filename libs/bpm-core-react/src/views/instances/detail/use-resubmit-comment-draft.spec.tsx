import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  type ResubmitCommentDraft,
  useResubmitCommentDraft,
} from './use-resubmit-comment-draft';

describe('useResubmitCommentDraft', () => {
  let container: HTMLDivElement;
  let root: Root;
  const latest: { draft: ResubmitCommentDraft | null } = { draft: null };

  function Probe({
    instanceId,
  }: {
    readonly instanceId: string;
  }): ReactElement {
    latest.draft = useResubmitCommentDraft(instanceId);

    return <span>{latest.draft.comment}</span>;
  }

  async function render(instanceId: string): Promise<void> {
    await act(async (): Promise<void> => {
      root.render(<Probe instanceId={instanceId} />);
    });
  }

  function draft(): ResubmitCommentDraft {
    if (!latest.draft) {
      throw new Error('not rendered');
    }

    return latest.draft;
  }

  beforeEach((): void => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    latest.draft = null;
  });

  afterEach((): void => {
    act((): void => root.unmount());
    container.remove();
  });

  it('keeps the draft while the same case re-renders', async (): Promise<void> => {
    await render('instance-a');
    act((): void => draft().setComment('已補上報價單'));
    await render('instance-a');

    expect(draft().comment).toBe('已補上報價單');
  });

  it('shows another case empty while keeping the draft for its own case', async (): Promise<void> => {
    await render('instance-a');
    act((): void => draft().setComment('A 的說明'));
    await render('instance-b');

    expect(draft().comment).toBe('');

    await render('instance-a');

    expect(draft().comment).toBe('A 的說明');
  });

  // One draft at a time: typing on another case replaces it.
  it('replaces the draft once the applicant types on another case', async (): Promise<void> => {
    await render('instance-a');
    act((): void => draft().setComment('A 的說明'));
    await render('instance-b');
    act((): void => draft().setComment('B 的說明'));
    await render('instance-a');

    expect(draft().comment).toBe('');
  });

  // Read from the draft's own case, not reset by an effect: the first render
  // of another case must not flash the previous case's text.
  it('shows nothing from the previous case on the first render of another', async (): Promise<void> => {
    const seen: string[] = [];

    function Recorder({
      instanceId,
    }: {
      readonly instanceId: string;
    }): ReactElement {
      const value = useResubmitCommentDraft(instanceId);

      latest.draft = value;
      seen.push(`${instanceId}:${value.comment}`);

      return <span />;
    }

    await act(async (): Promise<void> => {
      root.render(<Recorder instanceId="instance-a" />);
    });
    act((): void => draft().setComment('A 的說明'));
    seen.length = 0;
    await act(async (): Promise<void> => {
      root.render(<Recorder instanceId="instance-b" />);
    });

    expect(seen).not.toContain('instance-b:A 的說明');
    expect(seen[0]).toBe('instance-b:');
  });

  it('clears the draft once its case is resubmitted', async (): Promise<void> => {
    await render('instance-a');
    act((): void => draft().setComment('A 的說明'));
    act((): void => draft().clearAfterResubmit('instance-a'));

    expect(draft().comment).toBe('');
  });

  // A resubmission of A that settles after the page moved to B must not wipe
  // what the applicant has started typing on B.
  it("keeps another case's draft when an earlier resubmission settles late", async (): Promise<void> => {
    await render('instance-a');
    const clearForA = draft().clearAfterResubmit;

    await render('instance-b');
    act((): void => draft().setComment('B 的說明'));
    act((): void => clearForA('instance-a'));

    expect(draft().comment).toBe('B 的說明');
  });
});
