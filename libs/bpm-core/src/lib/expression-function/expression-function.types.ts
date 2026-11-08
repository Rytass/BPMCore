import type {
  BPMExpressionFunctionDescriptor,
  BPMExpressionValue,
} from '@rytass/bpm-core-shared';

/**
 * A function an expression may call (ADR 22 §3.5). The handler is host code:
 * it must be synchronous and pure, and only ever sees deep-frozen copies of
 * its arguments. The core never passes it an auth context.
 */
export interface BPMExpressionFunction extends Omit<
  BPMExpressionFunctionDescriptor,
  'builtIn'
> {
  readonly handler: (
    ...args: readonly BPMExpressionValue[]
  ) => BPMExpressionValue;
}

/**
 * The functions available to expressions: the core built-ins plus whatever
 * the host registered. Shared contract between the publish lint (P2) and the
 * registry implementation (P3); see docs/24 §3.
 */
export interface BPMExpressionFunctionRegistry {
  /** The function registered under `name`, or `null`. */
  get(name: string): BPMExpressionFunction | null;
  /** Descriptors of every available function, built-ins first. */
  list(): readonly BPMExpressionFunctionDescriptor[];
  /**
   * The names among `names` that are not available, in their first-seen
   * order and without duplicates. An empty result means all are available;
   * publish and rollback refuse a version whose result is not empty.
   */
  assertPublishable(names: readonly string[]): readonly string[];
}

/** Host-provided functions, as a multi-value list. Unset means none. */
export const BPM_EXPRESSION_FUNCTIONS = Symbol('BPM_EXPRESSION_FUNCTIONS');

/** The resolved registry the core injects. */
export const BPM_EXPRESSION_FUNCTION_REGISTRY = Symbol(
  'BPM_EXPRESSION_FUNCTION_REGISTRY',
);
