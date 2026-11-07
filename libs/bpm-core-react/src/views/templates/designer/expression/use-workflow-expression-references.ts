import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  WorkflowExpressionsDraft,
  WorkflowExpressionsRecord,
  analyzeWorkflowExpressions,
  readExpressionFieldReferences,
} from '@rytass/bpm-core-client/template';
import type { GraphQlRequestOptions } from '@rytass/bpm-core-client';

export interface WorkflowExpressionReferences {
  readonly analysis: WorkflowExpressionsRecord | null;
  /** Field key → labels of the expressions reading it. */
  readonly references: ReadonlyMap<string, readonly string[]>;
  /**
   * The references of the draft as it is now. Answers from the last analysis
   * when it was made for this very draft, otherwise asks the backend at once.
   * Resolves to `null` when the backend cannot answer, so a caller guarding a
   * destructive edit can refuse it instead of letting it through.
   */
  readonly resolveCurrentReferences: () => Promise<ReadonlyMap<
    string,
    readonly string[]
  > | null>;
}

interface KeyedAnalysis {
  readonly key: string;
  readonly record: WorkflowExpressionsRecord;
}

/**
 * The backend's reading of the draft's expressions (Phase 23 P4), refreshed a
 * moment after the draft stops changing. Field references come from the
 * backend's AST, never from parsing CEL in the browser. A failed analysis
 * leaves the last answer in place for display; `resolveCurrentReferences`
 * never answers from a stale or missing analysis.
 */
export function useWorkflowExpressionReferences(
  draft: WorkflowExpressionsDraft,
  enabled: boolean,
  analyze: (
    draft: WorkflowExpressionsDraft,
    options?: GraphQlRequestOptions,
  ) => Promise<WorkflowExpressionsRecord> = analyzeWorkflowExpressions,
  debounceMs = 800,
): WorkflowExpressionReferences {
  const [analysis, setAnalysis] = useState<KeyedAnalysis | null>(null);
  const key = JSON.stringify(draft);
  // The latest draft and analysis, for the imperative resolver below.
  const latestRef = useRef<{
    readonly analysis: KeyedAnalysis | null;
    readonly draft: WorkflowExpressionsDraft;
    readonly key: string;
  }>({ analysis, draft, key });

  latestRef.current = { analysis, draft, key };

  useEffect((): (() => void) => {
    if (!enabled) {
      return (): void => undefined;
    }

    const controller = new AbortController();
    const timer = setTimeout((): void => {
      analyze(draft, { signal: controller.signal })
        .then((record): void => setAnalysis({ key, record }))
        .catch((): void => undefined);
    }, debounceMs);

    return (): void => {
      clearTimeout(timer);
      controller.abort();
    };
    // `key` stands for the draft's content.
  }, [analyze, debounceMs, enabled, key]);

  const references = useMemo(
    (): ReadonlyMap<string, readonly string[]> =>
      readExpressionFieldReferences(analysis?.record ?? null),
    [analysis],
  );

  const resolveCurrentReferences = useCallback(async (): Promise<ReadonlyMap<
    string,
    readonly string[]
  > | null> => {
    const latest = latestRef.current;

    if (latest.analysis !== null && latest.analysis.key === latest.key) {
      return readExpressionFieldReferences(latest.analysis.record);
    }

    try {
      const record = await analyze(latest.draft);

      setAnalysis({ key: latest.key, record });

      return readExpressionFieldReferences(record);
    } catch {
      return null;
    }
  }, [analyze]);

  return {
    analysis: analysis?.record ?? null,
    references,
    resolveCurrentReferences,
  };
}
