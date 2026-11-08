/**
 * The value types an expression function declares for its parameters and its
 * result (ADR 22 §3.5). They name CEL types; `dyn` accepts any JSON value.
 */
export type BPMExpressionValueType =
  'bool' | 'double' | 'dyn' | 'int' | 'list' | 'map' | 'null' | 'string';

/** A JSON value as an expression function receives and returns it. */
export type BPMExpressionValue =
  | boolean
  | number
  | string
  | null
  | readonly BPMExpressionValue[]
  | { readonly [key: string]: BPMExpressionValue };

export interface BPMExpressionFunctionParameter {
  readonly description?: string;
  readonly name: string;
  readonly type: BPMExpressionValueType;
}

/**
 * What the designer, the catalog and the publish lint may know about a
 * function: everything except its handler. The browser only ever sees this.
 */
export interface BPMExpressionFunctionDescriptor {
  /** `true` for the nine core functions (`round` … `upper`). */
  readonly builtIn: boolean;
  readonly description: string;
  readonly label: string;
  /** Host functions carry their version: `erp_costBand_v1`. Built-ins do not. */
  readonly name: string;
  readonly parameters: readonly BPMExpressionFunctionParameter[];
  readonly returnType: BPMExpressionValueType;
}

/** The names the core reserves for its built-in functions (ADR 22 §3.5). */
export const BPM_BUILT_IN_EXPRESSION_FUNCTION_NAMES = [
  'abs',
  'ceil',
  'floor',
  'lower',
  'max',
  'min',
  'round',
  'trim',
  'upper',
] as const;

export type BPMBuiltInExpressionFunctionName =
  (typeof BPM_BUILT_IN_EXPRESSION_FUNCTION_NAMES)[number];

/** Host function names: lower camel segments joined by `_`, ending in `_vN`. */
export const BPM_EXPRESSION_FUNCTION_NAME_PATTERN =
  /^[a-z][A-Za-z0-9]*(_[A-Za-z0-9]+)*_v[0-9]+$/u;
