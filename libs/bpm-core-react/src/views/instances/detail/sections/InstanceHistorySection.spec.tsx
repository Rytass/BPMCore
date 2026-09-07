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
} from '@rytass/bpm-core-client/workflow';
import { InstanceHistorySection } from './InstanceHistorySection';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

// `@mezzanine-ui/core/stepper` and `@mezzanine-ui/react` are ESM-only, which
// the jest environment cannot load; the rest of this lib's component specs
// stub them the same way. The stubs keep `style` and `className` so what this
// spec asserts — the inline styles the section hands to Typography — still
// reaches the DOM.
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
          taskDecisionsByTaskId={new Map()}
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
});
