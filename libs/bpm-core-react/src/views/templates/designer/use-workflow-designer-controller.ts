import { useCallback, useMemo, useRef, useState } from 'react';
import {
  WorkflowCommand,
  WorkflowCommandResult,
  WorkflowDesignerState,
  WorkflowMacroCommand,
  WorkflowDirectory,
  WorkflowExpressionTools,
  WorkflowSnapshot,
  WORKFLOW_TOOLSET,
  WorkflowTool,
  WorkflowToolResult,
  applyWorkflowCommand,
  applyWorkflowMacroCommand,
  executeWorkflowTool,
  readWorkflowSnapshot,
} from '@rytass/bpm-core-shared';
import { WorkflowDefinition } from '@rytass/bpm-core-shared/workflow';

/**
 * Bridges the pure, framework-agnostic workflow command layer
 * (`@rytass/bpm-core-shared`) to React. It owns the {@link WorkflowDesignerState}
 * and is the single dispatch path through which both the designer UI and the
 * LLM assistant mutate the workflow — guaranteeing the assistant can do exactly
 * what a user can.
 *
 * The pure reducer only describes logical structure; this hook injects the
 * pixel concern: whenever a command reports `effects.layout`, the supplied
 * `layout` function (dagre) recomputes node positions, and `onLayout` is invoked
 * so the host can refit the viewport.
 */
export interface UseWorkflowDesignerControllerOptions {
  readonly initialState: WorkflowDesignerState;
  /** Recompute node pixel positions (dagre) — runs after topology changes. */
  readonly layout: (definition: WorkflowDefinition) => WorkflowDefinition;
  /** Notified with the laid-out definition so the host can refit the viewport. */
  readonly onLayout?: (definition: WorkflowDefinition) => void;
  /** Org directory backing the LLM's member/org lookup query tools. */
  readonly directory?: WorkflowDirectory;
  /**
   * Backend expression lint / preview / catalog for the assistant (Phase 23
   * P4). Read per tool call with the state the call runs against. Without it
   * every tool call that writes an expression is refused.
   */
  readonly expressionTools?: (
    state: WorkflowDesignerState,
  ) => WorkflowExpressionTools;
}

export interface WorkflowDesignerController {
  readonly state: WorkflowDesignerState;
  readonly snapshot: WorkflowSnapshot;
  /** The advertised LLM tool catalog (JSON Schema input contracts). */
  readonly tools: readonly WorkflowTool[];
  /** Dispatch a single primitive command. */
  readonly dispatch: (command: WorkflowCommand) => WorkflowCommandResult;
  /** Dispatch a high-level macro command. */
  readonly dispatchMacro: (
    command: WorkflowMacroCommand,
  ) => WorkflowCommandResult;
  /** Execute an LLM tool call by name; mutations commit + relayout. Async
   * because directory query tools may fetch from the host. */
  readonly executeTool: (
    toolName: string,
    input: unknown,
  ) => Promise<WorkflowToolResult>;
  /** Replace the whole state (e.g. after loading a draft from the server). */
  readonly replaceState: (
    next:
      | WorkflowDesignerState
      | ((current: WorkflowDesignerState) => WorkflowDesignerState),
  ) => void;
  /** Imperatively read the latest committed state (avoids stale closures). */
  readonly getState: () => WorkflowDesignerState;
}

export function useWorkflowDesignerController({
  directory,
  expressionTools,
  initialState,
  layout,
  onLayout,
}: UseWorkflowDesignerControllerOptions): WorkflowDesignerController {
  const [state, setState] = useState<WorkflowDesignerState>(initialState);
  // Mirror state in a ref so dispatch reads the freshest value even when called
  // multiple times within one React batch (e.g. a macro fold by the UI).
  const stateRef = useRef<WorkflowDesignerState>(initialState);
  // Latest directory, read at tool-call time (avoids re-creating executeTool).
  const directoryRef = useRef<WorkflowDirectory | undefined>(directory);
  directoryRef.current = directory;
  const expressionToolsRef = useRef(expressionTools);
  expressionToolsRef.current = expressionTools;

  const commit = useCallback(
    (result: WorkflowCommandResult): WorkflowCommandResult => {
      if (!result.changed && !result.error) {
        return result;
      }

      const committedDefinition = result.effects.layout
        ? layout(result.state.definition)
        : result.state.definition;
      const committedState: WorkflowDesignerState = {
        ...result.state,
        definition: committedDefinition,
      };

      stateRef.current = committedState;
      setState(committedState);

      if (result.effects.layout) {
        onLayout?.(committedDefinition);
      }

      return { ...result, state: committedState };
    },
    [layout, onLayout],
  );

  const dispatch = useCallback(
    (command: WorkflowCommand): WorkflowCommandResult =>
      commit(applyWorkflowCommand(stateRef.current, command)),
    [commit],
  );

  const dispatchMacro = useCallback(
    (command: WorkflowMacroCommand): WorkflowCommandResult =>
      commit(applyWorkflowMacroCommand(stateRef.current, command)),
    [commit],
  );

  // Tool calls run one after another: each reads the state the previous one
  // committed, so parallel calls from one assistant turn cannot overwrite
  // each other while one waits on the backend lint.
  const toolQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  const runTool = useCallback(
    async (toolName: string, input: unknown): Promise<WorkflowToolResult> => {
      const before = stateRef.current;
      const result = await executeWorkflowTool(before, toolName, input, {
        directory: directoryRef.current,
        expressions: expressionToolsRef.current?.(before),
      });

      if (result.ok && (result.kind === 'mutation' || result.kind === 'macro')) {
        // An expression write waits on the backend lint; committing a result
        // computed from a state the user has since edited would drop that edit.
        if (stateRef.current !== before) {
          return {
            error: '檢查運算式期間畫布已被修改，這次變更沒有套用，請重新讀取 snapshot 後再試。',
            ok: false,
          };
        }

        const committed = commit(result.result);

        return {
          ...result,
          result: committed,
          snapshot: readWorkflowSnapshot(committed.state),
        };
      }

      return result;
    },
    [commit],
  );

  const executeTool = useCallback(
    (toolName: string, input: unknown): Promise<WorkflowToolResult> => {
      const run = toolQueueRef.current.then(
        (): Promise<WorkflowToolResult> => runTool(toolName, input),
      );

      toolQueueRef.current = run.catch((): void => undefined);

      return run;
    },
    [runTool],
  );

  const replaceState = useCallback(
    (
      next:
        | WorkflowDesignerState
        | ((current: WorkflowDesignerState) => WorkflowDesignerState),
    ): void => {
      const resolved =
        typeof next === 'function' ? next(stateRef.current) : next;

      stateRef.current = resolved;
      setState(resolved);
    },
    [],
  );

  const getState = useCallback((): WorkflowDesignerState => stateRef.current, []);

  const snapshot = useMemo((): WorkflowSnapshot => readWorkflowSnapshot(state), [
    state,
  ]);

  return useMemo(
    (): WorkflowDesignerController => ({
      dispatch,
      dispatchMacro,
      executeTool,
      getState,
      replaceState,
      snapshot,
      state,
      tools: WORKFLOW_TOOLSET,
    }),
    [
      dispatch,
      dispatchMacro,
      executeTool,
      getState,
      replaceState,
      snapshot,
      state,
    ],
  );
}
