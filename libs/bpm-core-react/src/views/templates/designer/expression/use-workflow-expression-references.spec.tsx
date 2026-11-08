import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type {
  WorkflowExpressionsDraft,
  WorkflowExpressionsRecord,
} from '@rytass/bpm-core-client/template';
import { readFallbackWorkflowDefinition } from '@rytass/bpm-core-shared';
import {
  type WorkflowExpressionReferences,
  useWorkflowExpressionReferences,
} from './use-workflow-expression-references';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const DRAFT: WorkflowExpressionsDraft = {
  formDefinitionVersionId: null,
  initiatorPolicyCel: null,
  workflowDefinition: readFallbackWorkflowDefinition(),
};

type Analyze = (draft: WorkflowExpressionsDraft) => Promise<WorkflowExpressionsRecord>;

function readRecord(fieldKeys: readonly string[]): WorkflowExpressionsRecord {
  return {
    dialect: 'cel-v2',
    expressions: [
      {
        fieldKeys,
        issues: [],
        label: 'workflow.edges.e1.data.condition',
        usagePoint: 'EDGE_CONDITION',
      },
    ],
  };
}

interface Mounted {
  readonly current: () => WorkflowExpressionReferences;
  readonly render: (draft: WorkflowExpressionsDraft) => void;
  readonly unmount: () => void;
}

function mount(analyze: Analyze, debounceMs: number): Mounted {
  const container = document.createElement('div');
  const root: Root = createRoot(container);
  const latest: { value: WorkflowExpressionReferences | null } = { value: null };

  function Probe({ draft }: { readonly draft: WorkflowExpressionsDraft }): null {
    latest.value = useWorkflowExpressionReferences(draft, true, analyze, debounceMs);

    return null;
  }

  const render = (draft: WorkflowExpressionsDraft): void => {
    act((): void => {
      root.render(<Probe draft={draft} />);
    });
  };

  render(DRAFT);

  return {
    current: (): WorkflowExpressionReferences => {
      if (latest.value === null) {
        throw new Error('not rendered');
      }

      return latest.value;
    },
    render,
    unmount: (): void => {
      act((): void => root.unmount());
    },
  };
}

describe('useWorkflowExpressionReferences.resolveCurrentReferences', () => {
  it('asks the backend at once when no analysis has arrived yet', async () => {
    const analyze = jest.fn<ReturnType<Analyze>, Parameters<Analyze>>(async () =>
      readRecord(['amount']),
    );
    const mounted = mount(analyze, 60_000);
    let resolved: ReadonlyMap<string, readonly string[]> | null = null;

    await act(async (): Promise<void> => {
      resolved = await mounted.current().resolveCurrentReferences();
    });

    expect(analyze).toHaveBeenCalledTimes(1);
    expect(resolved).toEqual(new Map([['amount', ['workflow.edges.e1.data.condition']]]));
    mounted.unmount();
  });

  it('answers null when the backend cannot answer', async () => {
    const analyze = jest.fn<ReturnType<Analyze>, Parameters<Analyze>>(async () => {
      throw new Error('403');
    });
    const mounted = mount(analyze, 60_000);
    let resolved: ReadonlyMap<string, readonly string[]> | null | undefined;

    await act(async (): Promise<void> => {
      resolved = await mounted.current().resolveCurrentReferences();
    });

    expect(resolved).toBeNull();
    mounted.unmount();
  });

  it('reuses an analysis made for the same draft and re-asks once the draft changes', async () => {
    jest.useFakeTimers();

    try {
      const analyze = jest.fn<ReturnType<Analyze>, Parameters<Analyze>>(async () =>
        readRecord(['amount']),
      );
      const mounted = mount(analyze, 10);

      await act(async (): Promise<void> => {
        jest.advanceTimersByTime(10);
      });
      expect(analyze).toHaveBeenCalledTimes(1);

      await act(async (): Promise<void> => {
        await mounted.current().resolveCurrentReferences();
      });
      expect(analyze).toHaveBeenCalledTimes(1);

      mounted.render({ ...DRAFT, initiatorPolicyCel: 'true' });

      await act(async (): Promise<void> => {
        await mounted.current().resolveCurrentReferences();
      });
      expect(analyze).toHaveBeenCalledTimes(2);
      mounted.unmount();
    } finally {
      jest.useRealTimers();
    }
  });
});
