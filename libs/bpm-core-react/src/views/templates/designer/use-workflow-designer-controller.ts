import { useCallback, useMemo, useRef, useState } from 'react';
import {
  WorkflowCommand,
  WorkflowCommandResult,
  WorkflowDesignerState,
  WorkflowMacroCommand,
  WorkflowDirectory,
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

  const executeTool = useCallback(
    async (toolName: string, input: unknown): Promise<WorkflowToolResult> => {
      const result = await executeWorkflowTool(
        stateRef.current,
        toolName,
        input,
        { directory: directoryRef.current },
      );

      if (result.ok && (result.kind === 'mutation' || result.kind === 'macro')) {
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
