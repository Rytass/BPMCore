import {
  act,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type {
  ActivityLogRecord,
  ApprovalInstanceRecord,
  TaskDecisionRecord,
} from '@rytass/bpm-core-client/workflow';
import { InstanceHistorySection } from './InstanceHistorySection';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

// `@mezzanine-ui/core/stepper` and `@mezzanine-ui/react` are ESM-only, which
// the jest environment cannot load; the rest of this lib's component specs
// stub them the same way. The stubs keep `style`, `className` and `variant` so
// what this spec asserts — what the section hands to Typography — still reaches
// the DOM.
jest.mock('@mezzanine-ui/core/stepper', () => ({
  stepClasses: new Proxy(
    {},
    { get: (_target, key): string => `mzn-step-${String(key)}` },
  ),
}));

jest.mock('@mezzanine-ui/react', () => {
  function MockTypography(
    props: Readonly<Record<string, unknown>>,
  ): ReactElement {
    return (
      <span
        className={props.className as string | undefined}
        data-variant={props.variant as string | undefined}
        style={props.style as CSSProperties | undefined}
      >
        {props.children as ReactNode}
      </span>
    );
  }

  function MockStepper(props: Readonly<Record<string, unknown>>): ReactElement {
    return <div>{props.children as ReactNode}</div>;
  }

  function MockTooltip(props: Readonly<Record<string, unknown>>): ReactElement {
    return <span>{props.children as ReactNode}</span>;
  }

  return {
    Stepper: MockStepper,
    Tooltip: MockTooltip,
    Typography: MockTypography,
  };
});

const ERROR_COLOR = 'var(--mzn-color-text-error)';
const COMMENT_FONT_SIZE = 'var(--mzn-typography-h3-font-size)';
const COMMENT_LINE_HEIGHT = 'var(--mzn-typography-h3-line-height)';

function createDecisionActivityLog(
  id: string,
  action: string,
  comment: string,
): ActivityLogRecord {
  return {
    actorMemberId: 'member-approver',
    createdAt: '2026-09-07T08:44:45.000Z',
    eventType: 'TASK_DECIDED',
    id,
    instanceId: 'instance-1',
    nodeId: 'userTask_1',
    payloadJson: JSON.stringify({ action, comment }),
    taskId: `task-${id}`,
  } as unknown as ActivityLogRecord;
}

function renderHistory(
  container: HTMLElement,
  activityLogs: readonly ActivityLogRecord[],
  taskDecisionsByTaskId: ReadonlyMap<string, TaskDecisionRecord> = new Map(),
): Root {
  const root = createRoot(container);

  act((): void => {
    root.render(
      (
        <InstanceHistorySection
          activityLogs={activityLogs}
          instanceState={'RUNNING' as ApprovalInstanceRecord['state']}
          memberProfilesById={new Map()}
          signatureVerification={null}
          signaturesById={new Map()}
          taskDecisionsByTaskId={taskDecisionsByTaskId}
          tasks={[]}
          workflowSnapshot={null}
          workflowTokens={[]}
        />
      ) as ReactElement,
    );
  });

  return root;
}

/**
 * The deepest element whose whole text is `text`. Reading the deepest one
 * matters: a comment line is a `<span>` label followed by a text node, so an
 * ancestor could match the same string while carrying different styles.
 */
function findDeepestByExactText(
  container: HTMLElement,
  text: string,
): HTMLElement | null {
  const matches = Array.from(
    container.querySelectorAll<HTMLElement>('*'),
  ).filter((element): boolean => element.textContent === text);

  return matches.length > 0 ? matches[matches.length - 1] : null;
}

describe('InstanceHistorySection comment rendering', () => {
  let container: HTMLElement;
  let root: Root | null = null;

  beforeEach((): void => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach((): void => {
    if (root) {
      act((): void => {
        root?.unmount();
      });

      root = null;
    }

    container.remove();
  });

  it('separates a comment label from its text with a full-width colon', () => {
    root = renderHistory(container, [
      createDecisionActivityLog('a1', 'APPROVED', '核准，請依核定條件執行'),
    ]);

    // Without the separator the timeline reads "同意說明核准，請依核定條件執行",
    // which is both unreadable and inconsistent with every other part of the
    // step, all of which are rendered as "X：Y".
    expect(
      findDeepestByExactText(container, '同意說明：核准，請依核定條件執行'),
    ).not.toBeNull();
  });

  it('keeps a rejection reason in the error colour', () => {
    root = renderHistory(container, [
      createDecisionActivityLog('r1', 'REJECTED', '資料不足，請補件'),
    ]);

    const rejectionReason = findDeepestByExactText(
      container,
      '拒絕原因：資料不足，請補件',
    );

    expect(rejectionReason).not.toBeNull();
    // The colour is the only cue that separates a rejection reason from an
    // approval note once both are rendered as their own comment line.
    expect(rejectionReason?.style.color).toBe(ERROR_COLOR);
    expect(rejectionReason?.style.borderLeftColor).toBe(ERROR_COLOR);
  });

  it('does not grey out the label of a rejection reason', () => {
    root = renderHistory(container, [
      createDecisionActivityLog('r2', 'REJECTED', '資料不足，請補件'),
    ]);

    const label = findDeepestByExactText(container, '拒絕原因：');

    expect(label).not.toBeNull();
    expect(label?.style.color).toBe('');
  });

  it('leaves an approval note in the default text colour', () => {
    root = renderHistory(container, [
      createDecisionActivityLog('a2', 'APPROVED', '核准，請依核定條件執行'),
    ]);

    const approvalNote = findDeepestByExactText(
      container,
      '同意說明：核准，請依核定條件執行',
    );

    expect(approvalNote?.style.color).toBe('');
  });

  it('sets a comment one size above the metadata line', () => {
    root = renderHistory(container, [
      createDecisionActivityLog('a3', 'APPROVED', '核准，請依核定條件執行'),
      createDecisionActivityLog('r3', 'REJECTED', '資料不足，請補件'),
    ]);

    // Wusong reported comments as too small to notice once they moved to their
    // own line; the larger size is what sets them apart from the body-sized
    // metadata run above them, for approvals and rejections alike.
    for (const text of [
      '同意說明：核准，請依核定條件執行',
      '拒絕原因：資料不足，請補件',
    ]) {
      const comment = findDeepestByExactText(container, text);

      expect(comment?.style.fontSize).toBe(COMMENT_FONT_SIZE);
      expect(comment?.style.lineHeight).toBe(COMMENT_LINE_HEIGHT);
    }
  });

  it('sets the signer and time line in body text', () => {
    root = renderHistory(container, [
      createDecisionActivityLog('a4', 'APPROVED', '核准，請依核定條件執行'),
    ]);

    // Wusong reported this line as too small at caption size. Body is one step
    // up and still one step below the comment, which the test above pins.
    expect(
      container.querySelector<HTMLElement>('.mzn-step-description')?.dataset[
        'variant'
      ],
    ).toBe('body');
  });

  it('does not repeat the last comment on a signer who wrote nothing', () => {
    const silentLog = createDecisionActivityLog('s1', 'APPROVED', '');
    const signedLog = createDecisionActivityLog('s2', 'APPROVED', '協理意見');
    const taskId = 'task-shared';

    root = renderHistory(
      container,
      [
        {
          ...silentLog,
          payloadJson: JSON.stringify({ action: 'APPROVED', comment: null }),
          taskId,
        },
        { ...signedLog, taskId },
      ],
      new Map([[taskId, { comment: '協理意見' } as TaskDecisionRecord]]),
    );

    expect(container.textContent?.match(/協理意見/g)).toHaveLength(1);
  });
});
