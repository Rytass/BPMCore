import { Logger } from '@nestjs/common';
import type { ASTNode, Environment } from '@marcbachmann/cel-js';
import {
  allowsHostExpressionFunctions,
  BPM_BUILT_IN_EXPRESSION_FUNCTION_NAMES,
  EXPRESSION_ROOT_IDENTIFIERS_BY_USAGE_POINT,
  isExpressionUsagePoint,
  ExpressionLintCode,
  ExpressionLintIssue,
  ExpressionUsagePoint,
  readExpressionLintSeverity,
} from '@rytass/bpm-core-shared';
import {
  FormDefinitionSchema,
  FormFieldDefinition,
  isFormOptionFieldDefinition,
  readFormFieldSelectionMode,
} from '@rytass/bpm-core-shared/form';
import { BUILT_IN_EXPRESSION_FUNCTION_REGISTRY } from '../expression-function/expression-function.registry';
import type { BPMExpressionFunctionRegistry } from '../expression-function/expression-function.types';
import { parseCelLegacy } from './adapters/cel-legacy.adapter';
import {
  findCelV2ArgumentTypeMismatch,
  loadCelV2Environment,
} from './adapters/cel-v2.adapter';
import { isRegistryFunctionName } from './expression-function-invocation';
import {
  DEFAULT_EXPRESSION_DIALECT,
  ExpressionDialect,
} from './expression-dialect';

/*
 * Static reading of an expression's AST (ADR 22 §3.4, docs/24 §2.5): which
 * roots, fields and functions it uses, and the cel-v2 publish lint built on
 * that. Nothing here evaluates an expression or reads a value.
 */

/**
 * A chain of member and index steps from a root: `form.items[0].qty` is
 * `{ root: 'form', segments: ['items', '0', 'qty'] }`. `segments` stops at the
 * first step that is not a literal (a computed index or a method call), and
 * `complete` is then `false`.
 */
export interface ExpressionFieldPath {
  readonly complete: boolean;
  readonly root: string;
  readonly segments: readonly string[];
}

export interface ExpressionFunctionCall {
  readonly argumentCount: number;
  readonly name: string;
  /** `true` for a method call (`x.contains(y)`), `false` for `f(x)`. */
  readonly receiver: boolean;
}

/**
 * A method or macro called directly on a path from a root:
 * `form.items.exists(r, ...)` is `{ name: 'exists', path: form.items }`.
 */
export interface ExpressionReceiverPath {
  readonly name: string;
  readonly path: ExpressionFieldPath;
}

/**
 * A key that is not a literal: an index (`form[k]`, `form.a[form.b]`) or a map
 * literal key (`{form.k: 1}`). `root` is the root the indexed chain starts at,
 * `null` for map keys and chains that start elsewhere.
 */
export interface ExpressionComputedKey {
  readonly kind: 'INDEX' | 'MAP_KEY';
  readonly root: string | null;
}

export interface ExpressionReferences {
  /** Highest nesting of `all`/`exists`/`exists_one`/`map`/`filter`. */
  readonly comprehensionDepth: number;
  readonly computedKeys: readonly ExpressionComputedKey[];
  readonly dialect: ExpressionDialect;
  /** Paths read on the right of a `/`. */
  readonly divisorFieldPaths: readonly ExpressionFieldPath[];
  readonly fieldPaths: readonly ExpressionFieldPath[];
  /** Top-level form field keys read through `form` or `formData`. */
  readonly formFieldKeys: readonly string[];
  readonly functionCalls: readonly ExpressionFunctionCall[];
  /** Paths tested by `has(...)` or compared with `null`, `""` or `[]`. */
  readonly guardedFieldPaths: readonly ExpressionFieldPath[];
  /** The arguments of `has(...)`. */
  readonly hasArguments: readonly ExpressionFieldPath[];
  /**
   * Parsed nodes. cel-v2 counts AST nodes (the engine refuses more than
   * 200); cel-legacy counts CST atoms, steps and operators, which is a
   * different measure and only comparable with itself.
   */
  readonly nodeCount: number;
  /** Paths read inside an operand of `||`. */
  readonly orOperandFieldPaths: readonly ExpressionFieldPath[];
  readonly receiverPaths: readonly ExpressionReceiverPath[];
  /** `__proto__`, `constructor` or `prototype` used as a member, key or map key. */
  readonly reservedSegments: readonly string[];
  /** Free identifiers: names the expression reads that nothing in it binds. */
  readonly roots: readonly string[];
  /** Roots used as a value themselves, not as the start of a path. */
  readonly wholeRootReferences: readonly string[];
}

/**
 * What `readExpressionReferences` found. `UNAVAILABLE` is a cel-legacy
 * expression whose parser returned no CST to walk (the unit tests' `cel-js`
 * shim does that): per docs/24 §1 the old dialect then keeps its textual lint.
 */
export type ExpressionReferencesResult =
  | { readonly references: ExpressionReferences; readonly status: 'OK' }
  | { readonly limitExceeded: boolean; readonly status: 'PARSE_FAILED' }
  | { readonly status: 'UNAVAILABLE' };

export const RESERVED_PATH_SEGMENTS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

/** Roots the lint refuses to see used as a whole value (ADR 22 §3.4). */
const WHOLE_REFERENCE_ROOTS: ReadonlySet<string> = new Set([
  'form',
  'formData',
  'initiator',
  'row',
]);

const FORM_ROOTS: ReadonlySet<string> = new Set(['form', 'formData']);

const COMPREHENSION_MACROS: ReadonlySet<string> = new Set([
  'all',
  'exists',
  'exists_one',
  'filter',
  'map',
]);

/** ADR 22 §3.4 / docs/24 §2.7. */
export const EXPRESSION_MAX_COMPREHENSION_DEPTH = 2;

interface Collector {
  comprehensionDepth: number;
  readonly computedKeys: ExpressionComputedKey[];
  readonly divisorFieldPaths: ExpressionFieldPath[];
  readonly fieldPaths: ExpressionFieldPath[];
  readonly functionCalls: ExpressionFunctionCall[];
  readonly guardedFieldPaths: ExpressionFieldPath[];
  readonly hasArguments: ExpressionFieldPath[];
  nodeCount: number;
  readonly orOperandFieldPaths: ExpressionFieldPath[];
  readonly receiverPaths: ExpressionReceiverPath[];
  readonly reservedSegments: Set<string>;
  readonly roots: Set<string>;
  readonly wholeRootReferences: Set<string>;
}

const createCollector = (): Collector => ({
  comprehensionDepth: 0,
  computedKeys: [],
  divisorFieldPaths: [],
  fieldPaths: [],
  functionCalls: [],
  guardedFieldPaths: [],
  hasArguments: [],
  nodeCount: 0,
  orOperandFieldPaths: [],
  receiverPaths: [],
  reservedSegments: new Set(),
  roots: new Set(),
  wholeRootReferences: new Set(),
});

const toReferences = (
  collector: Collector,
  dialect: ExpressionDialect,
): ExpressionReferences => ({
  comprehensionDepth: collector.comprehensionDepth,
  computedKeys: [...collector.computedKeys],
  dialect,
  divisorFieldPaths: [...collector.divisorFieldPaths],
  fieldPaths: [...collector.fieldPaths],
  formFieldKeys: readFormFieldKeys(collector.fieldPaths),
  functionCalls: [...collector.functionCalls],
  guardedFieldPaths: [...collector.guardedFieldPaths],
  hasArguments: [...collector.hasArguments],
  nodeCount: collector.nodeCount,
  orOperandFieldPaths: [...collector.orOperandFieldPaths],
  receiverPaths: [...collector.receiverPaths],
  reservedSegments: [...collector.reservedSegments].sort(),
  roots: [...collector.roots].sort(),
  wholeRootReferences: [...collector.wholeRootReferences].sort(),
});

/** Unique top-level keys of the paths rooted at `form` or `formData`, in first-seen order. */
export const readFormFieldKeys = (
  paths: readonly ExpressionFieldPath[],
): readonly string[] => [
  ...new Set(
    paths
      .filter((path) => FORM_ROOTS.has(path.root) && path.segments.length > 0)
      .map((path) => path.segments[0]),
  ),
];

const noteReceiver = (
  collector: Collector,
  name: string,
  path: ExpressionFieldPath | null,
): void => {
  if (path !== null) {
    collector.receiverPaths.push({ name, path });
  }
};

const noteReserved = (collector: Collector, segment: string): void => {
  if (RESERVED_PATH_SEGMENTS.has(segment)) {
    collector.reservedSegments.add(segment);
  }
};

/**
 * The roots, field paths, function calls and structure an expression uses,
 * read from its AST without evaluating it. Names a comprehension binds (`x`
 * in `form.items.exists(x, x.qty > 0)`) are only in scope inside it: the same
 * name outside it is a root.
 *
 * Works for both dialects. cel-v2 reads the engine's AST; cel-legacy walks the
 * CST of `cel-js` and answers `UNAVAILABLE` when there is none to walk.
 */
export function readExpressionReferences(
  expression: string,
  dialect: ExpressionDialect = DEFAULT_EXPRESSION_DIALECT,
): ExpressionReferencesResult {
  return dialect === 'cel-v2'
    ? readCelV2References(expression)
    : readCelLegacyReferences(expression);
}

// ---------------------------------------------------------------- cel-v2 ---

type CelV2ParseOutcome =
  | { readonly ast: ASTNode; readonly status: 'OK' }
  | { readonly limitExceeded: boolean; readonly status: 'PARSE_FAILED' };

/**
 * Parses with the shared cel-v2 environment. The engine applies the AST node
 * and depth limits while parsing; breaking one is a `limit_exceeded` error,
 * told apart here so the lint can call it complexity rather than syntax. The
 * error's message is never read: it can echo the expression.
 */
const parseCelV2Ast = (
  expression: string,
  environment: Environment = loadCelV2Environment(),
): CelV2ParseOutcome => {
  try {
    return { ast: environment.parse(expression).ast, status: 'OK' };
  } catch (error: unknown) {
    return {
      limitExceeded:
        typeof error === 'object' &&
        error !== null &&
        (error as { readonly code?: unknown }).code === 'limit_exceeded',
      status: 'PARSE_FAILED',
    };
  }
};

function readCelV2References(
  expression: string,
  environment?: Environment,
): ExpressionReferencesResult {
  const parsed = parseCelV2Ast(expression, environment);

  if (parsed.status !== 'OK') {
    return parsed;
  }

  return {
    references: collectCelV2References(parsed.ast),
    status: 'OK',
  };
}

const collectCelV2References = (ast: ASTNode): ExpressionReferences => {
  const collector = createCollector();

  visitCelV2(ast, new Set(), 0, collector);

  return toReferences(collector, 'cel-v2');
};

type CelV2Step =
  | { readonly kind: 'member'; readonly name: string }
  | { readonly index: ASTNode; readonly kind: 'index' };

const readCelV2Chain = (
  node: ASTNode,
): { readonly base: ASTNode; readonly steps: readonly CelV2Step[] } => {
  if (node.op === '.' || node.op === '.?') {
    const inner = readCelV2Chain(node.args[0]);

    return {
      base: inner.base,
      steps: [...inner.steps, { kind: 'member', name: node.args[1] }],
    };
  }

  if (node.op === '[]' || node.op === '[?]') {
    const inner = readCelV2Chain(node.args[0]);

    return {
      base: inner.base,
      steps: [...inner.steps, { index: node.args[1], kind: 'index' }],
    };
  }

  return { base: node, steps: [] };
};

/** A literal index or key as a path segment, or `null` when it is computed. */
const readCelV2LiteralKey = (
  node: ASTNode,
): { readonly key: string; readonly string: boolean } | null => {
  if (node.op !== 'value') {
    return null;
  }

  if (typeof node.args === 'string') {
    return { key: node.args, string: true };
  }

  return typeof node.args === 'bigint' || typeof node.args === 'number'
    ? { key: String(node.args), string: false }
    : null;
};

const isCelV2EmptyLiteral = (node: ASTNode): boolean =>
  (node.op === 'value' && (node.args === null || node.args === '')) ||
  (node.op === 'list' && node.args.length === 0);

const visitCelV2Access = (
  node: ASTNode,
  scope: ReadonlySet<string>,
  depth: number,
  collector: Collector,
): ExpressionFieldPath | null => {
  const { base, steps } = readCelV2Chain(node);
  const rootName = base.op === 'id' && !scope.has(base.args) ? base.args : null;

  collector.nodeCount += steps.length;

  if (base.op === 'id') {
    collector.nodeCount += 1;

    if (rootName !== null) {
      collector.roots.add(rootName);
    }
  } else {
    visitCelV2(base, scope, depth, collector);
  }

  const { complete, segments } = steps.reduce<{
    readonly complete: boolean;
    readonly segments: readonly string[];
  }>(
    (state, step) => {
      if (step.kind === 'member') {
        noteReserved(collector, step.name);

        return state.complete
          ? { complete: true, segments: [...state.segments, step.name] }
          : state;
      }

      const literal = readCelV2LiteralKey(step.index);

      if (literal !== null) {
        collector.nodeCount += 1;

        if (literal.string) {
          noteReserved(collector, literal.key);
        }

        return state.complete
          ? { complete: true, segments: [...state.segments, literal.key] }
          : state;
      }

      collector.computedKeys.push({ kind: 'INDEX', root: rootName });
      visitCelV2(step.index, scope, depth, collector);

      return { complete: false, segments: state.segments };
    },
    { complete: true, segments: [] },
  );

  if (rootName === null) {
    return null;
  }

  const path: ExpressionFieldPath = { complete, root: rootName, segments };

  collector.fieldPaths.push(path);

  return path;
};

const visitCelV2Children = (
  nodes: readonly ASTNode[],
  scope: ReadonlySet<string>,
  depth: number,
  collector: Collector,
): void => {
  nodes.forEach((child): void => {
    visitCelV2(child, scope, depth, collector);
  });
};

/**
 * Visits one node. Returns the field path when the node is a path from a
 * root, so a caller can tell what `has(...)` or `== null` is about.
 */
function visitCelV2(
  node: ASTNode,
  scope: ReadonlySet<string>,
  depth: number,
  collector: Collector,
): ExpressionFieldPath | null {
  switch (node.op) {
    case 'value':
      collector.nodeCount += 1;

      return null;
    case 'id':
      collector.nodeCount += 1;

      if (!scope.has(node.args)) {
        collector.roots.add(node.args);
        collector.wholeRootReferences.add(node.args);
      }

      return null;
    case '.':
    case '.?':
    case '[]':
    case '[?]':
      return visitCelV2Access(node, scope, depth, collector);
    case 'call': {
      const [name, args] = node.args;

      collector.nodeCount += 1;

      if (name === 'has' && args.length === 1) {
        const path = visitCelV2(args[0], scope, depth, collector);

        if (path !== null) {
          collector.hasArguments.push(path);
          collector.guardedFieldPaths.push(path);
        }

        return null;
      }

      collector.functionCalls.push({
        argumentCount: args.length,
        name,
        receiver: false,
      });
      visitCelV2Children(args, scope, depth, collector);

      return null;
    }
    case 'rcall': {
      const [name, receiver, args] = node.args;
      const bound = args[0];

      collector.nodeCount += 1;

      if (
        COMPREHENSION_MACROS.has(name) &&
        bound?.op === 'id' &&
        (args.length === 2 || args.length === 3)
      ) {
        const innerDepth = depth + 1;

        collector.comprehensionDepth = Math.max(
          collector.comprehensionDepth,
          innerDepth,
        );
        collector.nodeCount += 1;
        noteReceiver(
          collector,
          name,
          visitCelV2(receiver, scope, depth, collector),
        );
        visitCelV2Children(
          args.slice(1),
          new Set([...scope, bound.args]),
          innerDepth,
          collector,
        );

        return null;
      }

      // `cel.bind(v, init, body)` is deliberately not a scope here: the
      // evaluation guard (`ConditionService`) refuses `cel` as a root, so the
      // lint reports `cel` and `v` as roots too rather than pass what every
      // case would then fail on.
      collector.functionCalls.push({
        argumentCount: args.length,
        name,
        receiver: true,
      });
      noteReceiver(
        collector,
        name,
        visitCelV2(receiver, scope, depth, collector),
      );
      visitCelV2Children(args, scope, depth, collector);

      return null;
    }
    case 'list':
      collector.nodeCount += 1;
      visitCelV2Children(node.args, scope, depth, collector);

      return null;
    case 'map':
      collector.nodeCount += 1;
      node.args.forEach(([key, value]): void => {
        if (key.op === 'value') {
          collector.nodeCount += 1;

          if (typeof key.args === 'string') {
            noteReserved(collector, key.args);
          }
        } else {
          collector.computedKeys.push({ kind: 'MAP_KEY', root: null });
          visitCelV2(key, scope, depth, collector);
        }

        visitCelV2(value, scope, depth, collector);
      });

      return null;
    case '||': {
      const start = collector.fieldPaths.length;

      collector.nodeCount += 1;
      visitCelV2Children(node.args, scope, depth, collector);
      collector.orOperandFieldPaths.push(...collector.fieldPaths.slice(start));

      return null;
    }
    case '/': {
      collector.nodeCount += 1;
      visitCelV2(node.args[0], scope, depth, collector);

      const start = collector.fieldPaths.length;

      visitCelV2(node.args[1], scope, depth, collector);
      collector.divisorFieldPaths.push(...collector.fieldPaths.slice(start));

      return null;
    }
    case '==':
    case '!=': {
      const [left, right] = node.args;

      collector.nodeCount += 1;

      const leftPath = visitCelV2(left, scope, depth, collector);
      const rightPath = visitCelV2(right, scope, depth, collector);

      if (leftPath !== null && isCelV2EmptyLiteral(right)) {
        collector.guardedFieldPaths.push(leftPath);
      }

      if (rightPath !== null && isCelV2EmptyLiteral(left)) {
        collector.guardedFieldPaths.push(rightPath);
      }

      return null;
    }
    case '!_':
    case '-_':
      collector.nodeCount += 1;
      visitCelV2(node.args, scope, depth, collector);

      return null;
    case '?:':
      collector.nodeCount += 1;
      visitCelV2Children(node.args, scope, depth, collector);

      return null;
    default:
      // The remaining operators are binary: `&&`, `in`, `+ - * %`, `< <= > >=`.
      collector.nodeCount += 1;
      visitCelV2Children(node.args, scope, depth, collector);

      return null;
  }
}

// ------------------------------------------------------------ cel-legacy ---

interface LegacyToken {
  readonly image: string;
  readonly startOffset: number;
  readonly tokenType: { readonly name: string };
}

interface LegacyCstNode {
  readonly children: Readonly<Record<string, readonly LegacyCstElement[]>>;
  readonly name: string;
}

type LegacyCstElement = LegacyCstNode | LegacyToken;

const isLegacyCstNode = (value: unknown): value is LegacyCstNode =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { readonly name?: unknown }).name === 'string' &&
  typeof (value as { readonly children?: unknown }).children === 'object' &&
  (value as { readonly children?: unknown }).children !== null;

const isLegacyToken = (value: LegacyCstElement): value is LegacyToken =>
  typeof (value as { readonly image?: unknown }).image === 'string';

const readLegacyNodes = (
  node: LegacyCstNode,
  key: string,
): readonly LegacyCstNode[] =>
  (node.children[key] ?? []).filter(isLegacyCstNode);

const readLegacyTokens = (
  node: LegacyCstNode,
  key: string,
): readonly LegacyToken[] => (node.children[key] ?? []).filter(isLegacyToken);

const readLegacyElements = (node: LegacyCstNode): readonly LegacyCstElement[] =>
  Object.values(node.children).flat();

function readCelLegacyReferences(
  expression: string,
): ExpressionReferencesResult {
  const handle = parseCelLegacy(expression);

  if (handle === null) {
    return { limitExceeded: false, status: 'PARSE_FAILED' };
  }

  if (!isLegacyCstNode(handle.native)) {
    return { status: 'UNAVAILABLE' };
  }

  const collector = createCollector();

  visitLegacy(handle.native, new Set(), 0, collector);

  return { references: toReferences(collector, 'cel-legacy'), status: 'OK' };
}

/** The one wrapped atom of a trivial chain (`expr` → … → `atomicExpression`). */
const unwrapLegacyAtom = (node: LegacyCstNode): LegacyCstElement | null => {
  const elements = readLegacyElements(node);

  if (node.name === 'atomicExpression') {
    return elements.length === 1 ? elements[0] : null;
  }

  if (node.name === 'parenthesisExpression') {
    const inner = readLegacyNodes(node, 'expr')[0];

    return inner ? unwrapLegacyAtom(inner) : null;
  }

  if (elements.length !== 1) {
    return null;
  }

  const [only] = elements;

  return isLegacyCstNode(only) ? unwrapLegacyAtom(only) : null;
};

/** cel-legacy does not decode escapes (P1 G25), so only plain literals count. */
const readLegacyStringLiteral = (token: LegacyToken): string | null => {
  if (token.tokenType.name !== 'StringLiteral') {
    return null;
  }

  const match = /^"([^"\\]*)"$|^'([^'\\]*)'$/u.exec(token.image);

  return match ? (match[1] ?? match[2] ?? '') : null;
};

const readLegacyLiteralKey = (
  expression: LegacyCstNode,
): { readonly key: string; readonly string: boolean } | null => {
  const atom = unwrapLegacyAtom(expression);

  if (atom === null || !isLegacyToken(atom)) {
    return null;
  }

  const text = readLegacyStringLiteral(atom);

  if (text !== null) {
    return { key: text, string: true };
  }

  return atom.tokenType.name === 'Integer' ||
    atom.tokenType.name === 'UnsignedInteger'
    ? { key: atom.image.replace(/[uU]$/u, ''), string: false }
    : null;
};

const isLegacyEmptyLiteral = (node: LegacyCstNode): boolean => {
  const atom = unwrapLegacyAtom(node);

  if (atom === null) {
    return false;
  }

  if (isLegacyToken(atom)) {
    return (
      atom.tokenType.name === 'Null' || readLegacyStringLiteral(atom) === ''
    );
  }

  return (
    atom.name === 'listExpression' && readLegacyNodes(atom, 'lhs').length === 0
  );
};

/** The bare identifier an `expr` is, if it is nothing else. */
const readLegacyBareIdentifier = (node: LegacyCstNode): string | null => {
  const atom = unwrapLegacyAtom(node);

  if (
    atom === null ||
    isLegacyToken(atom) ||
    atom.name !== 'identifierExpression' ||
    readLegacyElements(atom).length !== 1
  ) {
    return null;
  }

  return readLegacyTokens(atom, 'Identifier')[0]?.image ?? null;
};

const readLegacyCallArguments = (
  node: LegacyCstNode,
): readonly LegacyCstNode[] => [
  ...readLegacyNodes(node, 'arg'),
  ...readLegacyNodes(node, 'args'),
];

const visitLegacyAll = (
  nodes: readonly LegacyCstNode[],
  scope: ReadonlySet<string>,
  depth: number,
  collector: Collector,
): void => {
  nodes.forEach((child): void => {
    visitLegacy(child, scope, depth, collector);
  });
};

/** `lhs` followed by any number of `rhs`: an n-ary operator chain. */
const visitLegacyChain = (
  node: LegacyCstNode,
  scope: ReadonlySet<string>,
  depth: number,
  collector: Collector,
): ExpressionFieldPath | null => {
  const lhs = readLegacyNodes(node, 'lhs');
  const rhs = readLegacyNodes(node, 'rhs');

  if (rhs.length === 0) {
    return lhs[0] ? visitLegacy(lhs[0], scope, depth, collector) : null;
  }

  collector.nodeCount += rhs.length;
  visitLegacyAll([...lhs, ...rhs], scope, depth, collector);

  return null;
};

/** The member and index steps after an identifier, in source order. */
const readLegacySteps = (node: LegacyCstNode): readonly LegacyCstNode[] => {
  const offsetOf = (step: LegacyCstNode): number => {
    const first = readLegacyElements(step).find(isLegacyToken);

    return first?.startOffset ?? 0;
  };

  return [
    ...readLegacyNodes(node, 'identifierDotExpression'),
    ...readLegacyNodes(node, 'identifierIndexExpression'),
    ...readLegacyNodes(node, 'indexExpression'),
    ...readLegacyNodes(node, 'Index'),
  ].sort((left, right) => offsetOf(left) - offsetOf(right));
};

interface LegacyStepState {
  readonly complete: boolean;
  readonly segments: readonly string[];
}

const visitLegacyStep = (
  step: LegacyCstNode,
  state: LegacyStepState,
  rootName: string | null,
  scope: ReadonlySet<string>,
  depth: number,
  collector: Collector,
): LegacyStepState => {
  collector.nodeCount += 1;

  if (step.name !== 'identifierDotExpression') {
    const index = readLegacyNodes(step, 'expr')[0];
    const literal = index ? readLegacyLiteralKey(index) : null;

    if (literal !== null) {
      if (literal.string) {
        noteReserved(collector, literal.key);
      }

      return state.complete
        ? { complete: true, segments: [...state.segments, literal.key] }
        : state;
    }

    collector.computedKeys.push({ kind: 'INDEX', root: rootName });

    if (index) {
      visitLegacy(index, scope, depth, collector);
    }

    return { complete: false, segments: state.segments };
  }

  const name = readLegacyTokens(step, 'Identifier')[0]?.image ?? '';

  if (readLegacyTokens(step, 'OpenParenthesis').length === 0) {
    noteReserved(collector, name);

    return state.complete
      ? { complete: true, segments: [...state.segments, name] }
      : state;
  }

  const args = readLegacyCallArguments(step);
  const bound = args[0] ? readLegacyBareIdentifier(args[0]) : null;

  if (rootName !== null && state.complete) {
    // A method called on the root itself uses the root as a value.
    if (state.segments.length === 0) {
      collector.wholeRootReferences.add(rootName);
    }

    noteReceiver(collector, name, {
      complete: true,
      root: rootName,
      segments: state.segments,
    });
  }

  if (COMPREHENSION_MACROS.has(name) && bound !== null && args.length >= 2) {
    const innerDepth = depth + 1;

    collector.comprehensionDepth = Math.max(
      collector.comprehensionDepth,
      innerDepth,
    );
    visitLegacyAll(
      args.slice(1),
      new Set([...scope, bound]),
      innerDepth,
      collector,
    );
  } else {
    collector.functionCalls.push({
      argumentCount: args.length,
      name,
      receiver: true,
    });
    visitLegacyAll(args, scope, depth, collector);
  }

  return { complete: false, segments: state.segments };
};

const visitLegacySteps = (
  steps: readonly LegacyCstNode[],
  rootName: string | null,
  scope: ReadonlySet<string>,
  depth: number,
  collector: Collector,
): LegacyStepState =>
  steps.reduce<LegacyStepState>(
    (state, step) =>
      visitLegacyStep(step, state, rootName, scope, depth, collector),
    { complete: true, segments: [] },
  );

function visitLegacy(
  node: LegacyCstNode,
  scope: ReadonlySet<string>,
  depth: number,
  collector: Collector,
): ExpressionFieldPath | null {
  switch (node.name) {
    case 'expr': {
      const condition = readLegacyNodes(node, 'conditionalOr')[0];
      const branches = [
        ...readLegacyNodes(node, 'lhs'),
        ...readLegacyNodes(node, 'rhs'),
      ];
      const path = condition
        ? visitLegacy(condition, scope, depth, collector)
        : null;

      if (branches.length === 0) {
        return path;
      }

      collector.nodeCount += 1;
      visitLegacyAll(branches, scope, depth, collector);

      return null;
    }
    case 'conditionalOr': {
      if (readLegacyNodes(node, 'rhs').length === 0) {
        return visitLegacyChain(node, scope, depth, collector);
      }

      const start = collector.fieldPaths.length;

      visitLegacyChain(node, scope, depth, collector);
      collector.orOperandFieldPaths.push(...collector.fieldPaths.slice(start));

      return null;
    }
    case 'conditionalAnd':
    case 'addition':
      return visitLegacyChain(node, scope, depth, collector);
    case 'relation': {
      const [left] = readLegacyNodes(node, 'lhs');
      const [right] = readLegacyNodes(node, 'rhs');
      const [operator] = readLegacyTokens(node, 'ComparisonOperator');

      if (!right || !left) {
        return left ? visitLegacy(left, scope, depth, collector) : null;
      }

      collector.nodeCount += 1;

      const leftPath = visitLegacy(left, scope, depth, collector);
      const rightPath = visitLegacy(right, scope, depth, collector);

      if (operator?.image === '==' || operator?.image === '!=') {
        if (leftPath !== null && isLegacyEmptyLiteral(right)) {
          collector.guardedFieldPaths.push(leftPath);
        }

        if (rightPath !== null && isLegacyEmptyLiteral(left)) {
          collector.guardedFieldPaths.push(rightPath);
        }
      }

      return null;
    }
    case 'multiplication': {
      const [left] = readLegacyNodes(node, 'lhs');
      const rhs = readLegacyNodes(node, 'rhs');
      const operators = readLegacyTokens(node, 'MultiplicationOperator');

      if (rhs.length === 0) {
        return left ? visitLegacy(left, scope, depth, collector) : null;
      }

      collector.nodeCount += rhs.length;

      if (left) {
        visitLegacy(left, scope, depth, collector);
      }

      rhs.forEach((operand, index): void => {
        const start = collector.fieldPaths.length;

        visitLegacy(operand, scope, depth, collector);

        if (operators[index]?.image === '/') {
          collector.divisorFieldPaths.push(
            ...collector.fieldPaths.slice(start),
          );
        }
      });

      return null;
    }
    case 'unaryExpression': {
      const [atom] = readLegacyNodes(node, 'atomicExpression');

      if (!atom) {
        return null;
      }

      if (readLegacyTokens(node, 'UnaryOperator').length === 0) {
        return visitLegacy(atom, scope, depth, collector);
      }

      collector.nodeCount += 1;
      visitLegacy(atom, scope, depth, collector);

      return null;
    }
    case 'atomicExpression': {
      const [child] = readLegacyElements(node);

      if (!child) {
        return null;
      }

      if (isLegacyToken(child)) {
        collector.nodeCount += 1;

        return null;
      }

      return visitLegacy(child, scope, depth, collector);
    }
    case 'parenthesisExpression': {
      const [inner] = readLegacyNodes(node, 'expr');

      return inner ? visitLegacy(inner, scope, depth, collector) : null;
    }
    case 'listExpression': {
      collector.nodeCount += 1;
      visitLegacyAll(
        [...readLegacyNodes(node, 'lhs'), ...readLegacyNodes(node, 'rhs')],
        scope,
        depth,
        collector,
      );
      visitLegacySteps(readLegacySteps(node), null, scope, depth, collector);

      return null;
    }
    case 'mapExpression': {
      collector.nodeCount += 1;
      readLegacyNodes(node, 'keyValues').forEach((entry): void => {
        const [key] = readLegacyNodes(entry, 'key');
        const [value] = readLegacyNodes(entry, 'value');
        const literal = key ? readLegacyLiteralKey(key) : null;

        collector.nodeCount += 1;

        const atom = key ? unwrapLegacyAtom(key) : null;

        if (literal !== null) {
          if (literal.string) {
            noteReserved(collector, literal.key);
          }
        } else if (key && (atom === null || !isLegacyToken(atom))) {
          // Any literal token (`true`, `1.5`) is still a literal key.
          collector.computedKeys.push({ kind: 'MAP_KEY', root: null });
          visitLegacy(key, scope, depth, collector);
        }

        if (value) {
          visitLegacy(value, scope, depth, collector);
        }
      });
      visitLegacySteps(readLegacySteps(node), null, scope, depth, collector);

      return null;
    }
    case 'macrosExpression': {
      const name = readLegacyTokens(node, 'Identifier')[0]?.image ?? '';
      const args = readLegacyCallArguments(node);

      collector.nodeCount += 1;

      if (name === 'has' && args.length === 1) {
        const path = visitLegacy(args[0], scope, depth, collector);

        if (path !== null) {
          collector.hasArguments.push(path);
          collector.guardedFieldPaths.push(path);
        }

        return null;
      }

      collector.functionCalls.push({
        argumentCount: args.length,
        name,
        receiver: false,
      });
      visitLegacyAll(args, scope, depth, collector);

      return null;
    }
    case 'identifierExpression': {
      const name = readLegacyTokens(node, 'Identifier')[0]?.image ?? '';
      const rootName = scope.has(name) ? null : name;
      const steps = readLegacySteps(node);

      collector.nodeCount += 1;

      if (rootName !== null) {
        collector.roots.add(rootName);
      }

      if (steps.length === 0) {
        if (rootName !== null) {
          collector.wholeRootReferences.add(rootName);
        }

        return null;
      }

      const { complete, segments } = visitLegacySteps(
        steps,
        rootName,
        scope,
        depth,
        collector,
      );

      if (rootName === null) {
        return null;
      }

      const path: ExpressionFieldPath = { complete, root: rootName, segments };

      collector.fieldPaths.push(path);

      return path;
    }
    default:
      visitLegacyAll(
        readLegacyElements(node).filter(isLegacyCstNode),
        scope,
        depth,
        collector,
      );

      return null;
  }
}

/** Whether the expression reads the top-level form field `fieldKey`. */
export const readsFormField = (
  references: ExpressionReferences,
  fieldKey: string,
): boolean => references.formFieldKeys.includes(fieldKey);

/**
 * Whether the expression steps inside the table field `tableKey`
 * (`form.items.qty`, `form.items[0]`, `form.items.exists(r, ...)`), the AST
 * twin of `referencesTableInternals` (ADR 16 §3.8). The table as a whole
 * (`size(form.items)`, `form.items.size()`, `form.items == null`) is not.
 */
export const readsTableInternals = (
  references: ExpressionReferences,
  tableKey: string,
): boolean =>
  references.fieldPaths.some(
    (path) =>
      FORM_ROOTS.has(path.root) &&
      path.segments[0] === tableKey &&
      (path.segments.length > 1 || !path.complete),
  ) ||
  references.receiverPaths.some(
    ({ name, path }) =>
      name !== 'size' &&
      FORM_ROOTS.has(path.root) &&
      path.segments.length === 1 &&
      path.segments[0] === tableKey,
  );

// ------------------------------------------------------- cel-v2 lint -------

/** The slice of the function registry the lint uses (docs/24 §3: P3 implements it). */
export type ExpressionFunctionAvailability = Pick<
  BPMExpressionFunctionRegistry,
  'assertPublishable' | 'get'
>;

export interface ExpressionLintContext {
  /** Overrides the use point's roots. Without either, roots are not checked. */
  readonly allowedRootIdentifiers?: readonly string[];
  /**
   * The bound form. With it, field keys are checked against the schema and
   * the type check knows each field's type; without it every field is `dyn`.
   */
  readonly formSchema?: FormDefinitionSchema | null;
  /**
   * The registry that answers which functions are available. Absent means
   * only the nine built-ins exist (`BPM_BUILT_IN_EXPRESSION_FUNCTION_NAMES`);
   * `ConditionService` fills it with the registry it was given. Host code:
   * a throw or a malformed answer is isolated and refuses the names asked
   * about (`EXPR_FUNCTION_NOT_REGISTERED`), never its message.
   */
  readonly functionRegistry?: ExpressionFunctionAvailability | null;
  /** The field a `SET_FORM_FIELD` writes; decides its result type. */
  readonly targetField?: FormFieldDefinition | null;
  readonly usagePoint?: ExpressionUsagePoint;
}

/**
 * The CEL types a form field is declared with for the lint's type check
 * (docs/24-design/p2-p3 §2.2). Only names the engine accepts are produced;
 * anything else is `dyn`. Never `optional(...)`: the engine cannot convert it.
 */
export const readExpressionFieldType = (field: FormFieldDefinition): string => {
  switch (field.type) {
    case 'text':
    case 'textarea':
    case 'date':
    case 'datetime':
    case 'org_unit':
      return 'string';
    case 'number':
    case 'money':
      return 'double';
    case 'boolean':
      return 'bool';
    case 'member':
      return field.multiple === true ? 'list<string>' : 'string';
    case 'select':
    case 'autocomplete':
    case 'radio':
    case 'checkbox':
      return isFormOptionFieldDefinition(field) &&
        readFormFieldSelectionMode(field) === 'multiple'
        ? 'list<string>'
        : 'string';
    case 'table':
      return 'list<dyn>';
    default:
      return 'dyn';
  }
};

const readSchemaFields = (
  schema: FormDefinitionSchema | null | undefined,
): readonly FormFieldDefinition[] =>
  Array.isArray(schema?.fields)
    ? schema.fields.filter(
        (field): field is FormFieldDefinition =>
          typeof field?.fieldKey === 'string' &&
          !RESERVED_PATH_SEGMENTS.has(field.fieldKey),
      )
    : [];

interface EngineFunctionNames {
  readonly globals: ReadonlySet<string>;
  readonly methods: ReadonlySet<string>;
}

const readDefinedFunctionNames = (
  environment: Environment,
): EngineFunctionNames => {
  const functions = environment.getDefinitions().functions;

  return {
    globals: new Set(
      functions
        .filter((definition) => !definition.receiverType)
        .map((definition) => definition.name),
    ),
    methods: new Set(
      functions
        .filter((definition) => Boolean(definition.receiverType))
        .map((definition) => definition.name),
    ),
  };
};

let pristineFunctionNames: EngineFunctionNames | null = null;

/**
 * The functions cel-v2 itself provides (`size`, `int`, `contains`, …), read
 * from a fresh environment of the same class so that host functions a later
 * environment may register are never mistaken for the engine's own.
 */
const readEngineFunctionNames = (): EngineFunctionNames => {
  if (pristineFunctionNames === null) {
    const EnvironmentClass = loadCelV2Environment()
      .constructor as new () => Environment;

    pristineFunctionNames = readDefinedFunctionNames(new EnvironmentClass());
  }

  return pristineFunctionNames;
};

const knownFunctionNamesByEnvironment = new WeakMap<
  Environment,
  ReadonlySet<string>
>();

/** Global functions the shared environment can type-check today. */
const readCheckableGlobalNames = (
  environment: Environment,
): ReadonlySet<string> => {
  const cached = knownFunctionNamesByEnvironment.get(environment);

  if (cached) {
    return cached;
  }

  const names = readDefinedFunctionNames(environment).globals;

  knownFunctionNamesByEnvironment.set(environment, names);

  return names;
};

const issue = (
  code: ExpressionLintCode,
  label: string,
  subject?: string,
): ExpressionLintIssue => ({
  code,
  label,
  severity: readExpressionLintSeverity(code),
  ...(subject === undefined ? {} : { subject }),
});

/**
 * A use point that is set but is not one (a client may send any string, a
 * prototype key such as `toString` included). It is never used as an index:
 * such a context allows no root and no host function, so the lint fails
 * closed instead of throwing.
 */
const hasUnknownUsagePoint = (context: ExpressionLintContext): boolean =>
  context.usagePoint !== undefined &&
  context.usagePoint !== null &&
  !isExpressionUsagePoint(context.usagePoint);

const readAllowedRoots = (
  context: ExpressionLintContext,
): readonly string[] | null => {
  if (context.allowedRootIdentifiers?.length) {
    return context.allowedRootIdentifiers;
  }

  if (hasUnknownUsagePoint(context)) {
    return [];
  }

  return context.usagePoint
    ? EXPRESSION_ROOT_IDENTIFIERS_BY_USAGE_POINT[context.usagePoint]
    : null;
};

const lintStructure = (
  references: ExpressionReferences,
  label: string,
  context: ExpressionLintContext,
): readonly ExpressionLintIssue[] => {
  const allowedRoots = readAllowedRoots(context);
  const allowed = new Set(allowedRoots ?? []);
  const rootIssues =
    allowedRoots === null
      ? []
      : references.roots
          .filter((root) => !allowed.has(root))
          .map((root) => issue('EXPR_ROOT_NOT_ALLOWED', label, root));
  const wholeIssues = references.wholeRootReferences
    .filter(
      (root) =>
        WHOLE_REFERENCE_ROOTS.has(root) &&
        (allowedRoots === null || allowed.has(root)),
    )
    .map((root) => issue('EXPR_WHOLE_FORM_REFERENCE', label, root));

  return [
    ...rootIssues,
    ...wholeIssues,
    ...(references.computedKeys.length > 0
      ? [issue('EXPR_COMPUTED_KEY', label)]
      : []),
    ...references.reservedSegments.map((segment) =>
      issue('EXPR_RESERVED_PATH_SEGMENT', label, segment),
    ),
    ...(references.comprehensionDepth > EXPRESSION_MAX_COMPREHENSION_DEPTH
      ? [issue('EXPR_COMPREHENSION_NESTING', label)]
      : []),
  ];
};

const lintFields = (
  references: ExpressionReferences,
  label: string,
  schema: FormDefinitionSchema | null | undefined,
): readonly ExpressionLintIssue[] => {
  if (!schema) {
    return [];
  }

  const known = new Set(
    readSchemaFields(schema).map((field) => field.fieldKey),
  );

  return references.formFieldKeys
    .filter((fieldKey) => !known.has(fieldKey))
    .map((fieldKey) => issue('EXPR_FIELD_UNKNOWN', label, fieldKey));
};

const lintLogger = new Logger('ExpressionLint');

/**
 * Logs that the host's function registry failed the lint. Only a fixed
 * reason: the registry's own message is host text and is never kept
 * (docs/24 §2.6).
 */
const logRegistryFailure = (reason: string): void => {
  lintLogger.warn(`code=EXPR_FUNCTION_NOT_REGISTERED reason=${reason}`);
};

const isStringList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

/**
 * The called function names the registry cannot vouch for, in first-seen
 * order and without duplicates (ADR 22 §5.3; publish and rollback share it).
 *
 * Only names {@link isRegistryFunctionName} accepts — `…_vN` and the nine
 * built-ins — are put to `assertPublishable`; any other name can never be
 * registered and is always reported. Without a registry only the built-ins
 * exist.
 *
 * The registry is host code and is isolated: an `assertPublishable` that
 * throws or answers something other than a list of strings makes every name
 * asked about unavailable. The result only ever holds names the expression
 * itself called, never a value the registry returned.
 */
export function readUnavailableExpressionFunctions(
  names: readonly string[],
  registry: ExpressionFunctionAvailability | null | undefined,
): readonly string[] {
  const unique = [...new Set(names)];
  const asked = unique.filter(isRegistryFunctionName);
  const builtIns: ReadonlySet<string> = new Set(
    BPM_BUILT_IN_EXPRESSION_FUNCTION_NAMES,
  );
  const answered = ((): ReadonlySet<string> => {
    if (!registry) {
      return new Set(asked.filter((name) => !builtIns.has(name)));
    }

    if (asked.length === 0) {
      return new Set();
    }

    try {
      const result: unknown = registry.assertPublishable(asked);

      if (isStringList(result)) {
        return new Set(result);
      }

      logRegistryFailure('assert-publishable-shape');
    } catch {
      logRegistryFailure('assert-publishable-threw');
    }

    return new Set(asked);
  })();

  return unique.filter(
    (name) => !isRegistryFunctionName(name) || answered.has(name),
  );
}

/**
 * The parameter count the registry declares for `name`: `ABSENT` when `get`
 * answers `null` (`assertPublishable` already decided availability), `BROKEN`
 * when it throws or returns something without a parameter list. Isolated like
 * {@link readUnavailableExpressionFunctions}.
 */
const readRegisteredParameterCount = (
  registry: ExpressionFunctionAvailability,
  name: string,
): number | 'ABSENT' | 'BROKEN' => {
  try {
    const registered: unknown = registry.get(name);

    if (registered === null) {
      return 'ABSENT';
    }

    const parameters =
      typeof registered === 'object'
        ? (registered as { readonly parameters?: unknown }).parameters
        : undefined;

    if (Array.isArray(parameters)) {
      return parameters.length;
    }

    logRegistryFailure('get-shape');
  } catch {
    logRegistryFailure('get-threw');
  }

  return 'BROKEN';
};

/**
 * The cel-v2 environment the lint parses and type-checks with: the one of the
 * registry the evaluation will use, so host functions are type-checked too
 * (docs/24 §2.5). Building it reads the registry's `list` and `get`; when
 * that fails the built-ins-only environment is used and `failed` is set, and
 * the lint refuses the expression (evaluation could not build it either).
 */
interface LintEnvironment {
  readonly environment: Environment;
  readonly failed: boolean;
}

const readLintEnvironment = (
  registry: BPMExpressionFunctionRegistry | null | undefined,
): LintEnvironment => {
  if (!registry || registry === BUILT_IN_EXPRESSION_FUNCTION_REGISTRY) {
    return { environment: loadCelV2Environment(), failed: false };
  }

  // Loaded first and outside the `try`: a failure to load the engine is a
  // configuration error, not the registry's.
  const builtInEnvironment = loadCelV2Environment();

  try {
    return { environment: loadCelV2Environment(registry), failed: false };
  } catch {
    logRegistryFailure('environment');

    return { environment: builtInEnvironment, failed: true };
  }
};

interface FunctionLintResult {
  readonly issues: readonly ExpressionLintIssue[];
  /** Global functions the lint environment cannot type-check. */
  readonly uncheckable: boolean;
}

const lintFunctions = (
  references: ExpressionReferences,
  label: string,
  context: ExpressionLintContext,
  lintEnvironment: LintEnvironment,
): FunctionLintResult => {
  const engine = readEngineFunctionNames();
  const unknownMethods = [
    ...new Set(
      references.functionCalls
        .filter((call) => call.receiver && !engine.methods.has(call.name))
        .map((call) => call.name),
    ),
  ];
  const hostCalls = references.functionCalls.filter(
    (call) => !call.receiver && !engine.globals.has(call.name),
  );
  const hostNames = [...new Set(hostCalls.map((call) => call.name))];
  const registry = context.functionRegistry ?? null;
  const builtIns: ReadonlySet<string> = new Set(
    BPM_BUILT_IN_EXPRESSION_FUNCTION_NAMES,
  );
  const missing = new Set(
    lintEnvironment.failed
      ? hostNames
      : readUnavailableExpressionFunctions(hostNames, registry),
  );
  // A call whose argument count matches no registered parameter list names
  // no registered function either (ADR 22 §5.3: "the function and version").
  const wrongArity = registry
    ? hostCalls
        .filter((call) => !missing.has(call.name))
        .filter((call) => {
          const count = readRegisteredParameterCount(registry, call.name);

          return count !== 'ABSENT' && count !== call.argumentCount;
        })
        .map((call) => call.name)
    : [];
  const notRegistered = [
    ...new Set([...unknownMethods, ...missing, ...wrongArity]),
  ];
  const hostFunctionsAllowed = hasUnknownUsagePoint(context)
    ? false
    : !context.usagePoint || allowsHostExpressionFunctions(context.usagePoint);
  const notAllowed = hostFunctionsAllowed
    ? []
    : hostNames.filter((name) => !missing.has(name) && !builtIns.has(name));
  const checkable = readCheckableGlobalNames(lintEnvironment.environment);

  return {
    issues: [
      ...notRegistered.map((name) =>
        issue('EXPR_FUNCTION_NOT_REGISTERED', label, name),
      ),
      // A registry that cannot be read refuses even an expression that
      // calls nothing: evaluation builds its environment from the same list.
      ...(lintEnvironment.failed && notRegistered.length === 0
        ? [issue('EXPR_FUNCTION_NOT_REGISTERED', label)]
        : []),
      ...notAllowed.map((name) =>
        issue('EXPR_FUNCTION_NOT_ALLOWED', label, name),
      ),
    ],
    uncheckable:
      lintEnvironment.failed ||
      unknownMethods.length > 0 ||
      hostNames.some((name) => !checkable.has(name)),
  };
};

/** Base CEL types a use point may produce; `null` means anything. */
const readExpectedResultTypes = (
  context: ExpressionLintContext,
): readonly string[] | null => {
  switch (context.usagePoint) {
    case 'INITIATOR_POLICY':
    case 'ENTRY_CONDITION':
    case 'FLOW_CONDITION':
    case 'DELEGATION_CONDITION':
      return ['bool'];
    case 'APPROVER_RESOLVER':
      return ['string', 'list'];
    case 'DATA_SOURCE_BINDING':
    case 'NOTIFY_WEBHOOK_BINDING':
      return ['bool', 'double', 'int', 'null', 'string', 'uint'];
    case 'SERVICE_FORM_FIELD_VALUE': {
      if (!context.targetField) {
        return null;
      }

      const declared = readExpressionFieldType(context.targetField);
      const base = declared.split('<')[0];

      if (base === 'dyn') {
        return null;
      }

      return base === 'double'
        ? ['double', 'int', 'uint', 'null']
        : [base, 'null'];
    }
    default:
      return null;
  }
};

const isResultTypeAccepted = (
  type: string | undefined,
  expected: readonly string[] | null,
): boolean => {
  if (expected === null || type === undefined) {
    return true;
  }

  const base = type.split('<')[0].trim();

  return base === 'dyn' || base === 'null_type' || expected.includes(base);
};

type TypeCheckOutcome =
  | { readonly status: 'OK'; readonly type: string | undefined }
  | {
      readonly code: 'EXPR_FIELD_TYPE_MISMATCH' | 'EXPR_FIELD_UNKNOWN';
      readonly fieldKey: string | null;
      readonly status: 'FAILED';
    };

interface CheckErrorShape {
  readonly code?: unknown;
  readonly node?: unknown;
}

const readCheckErrorNode = (error: unknown): ASTNode | null => {
  const node = (error as CheckErrorShape | null)?.node;

  return typeof node === 'object' &&
    node !== null &&
    typeof (node as { readonly op?: unknown }).op === 'string'
    ? (node as ASTNode)
    : null;
};

/**
 * Comparisons a typed check refuses that the runtime (where every field is
 * `dyn`) accepts and the designer writes on purpose: `form.x != null`,
 * `form.amount != ""`, `form.member != []` (`readConditionExpression`) and
 * `form.qty in [1, 2, 3]` (P1 P03 routes the same in both dialects).
 */
const isTolerated = (node: ASTNode): boolean =>
  node.op === 'in' ||
  ((node.op === '==' || node.op === '!=') &&
    node.args.some((operand) => isCelV2EmptyLiteral(operand)));

/**
 * The schema type (its base, `list<string>` is `list`) of an argument that is
 * exactly `form.<key>`, `formData.<key>` or `form["<key>"]` for a field
 * `runTypeCheck` demoted to `dyn`; `null` for anything else, which keeps the
 * type the check gave it.
 */
const readDemotedFieldType = (
  argument: ASTNode,
  schemaTypes: ReadonlyMap<string, string> | null,
  checkedTypes: ReadonlyMap<string, string> | null,
): string | null => {
  if (schemaTypes === null || checkedTypes === null) {
    return null;
  }

  const { base, steps } = readCelV2Chain(argument);
  const step = steps.length === 1 ? steps[0] : null;
  const literal =
    step?.kind === 'index' ? readCelV2LiteralKey(step.index) : null;
  const fieldKey =
    step?.kind === 'member'
      ? step.name
      : literal?.string === true
        ? literal.key
        : null;

  if (
    fieldKey === null ||
    base.op !== 'id' ||
    !FORM_ROOTS.has(base.args) ||
    argument.op === '.?' ||
    argument.op === '[?]' ||
    checkedTypes.get(fieldKey) !== 'dyn'
  ) {
    return null;
  }

  const schemaType = schemaTypes.get(fieldKey);

  return schemaType === undefined || schemaType === 'dyn'
    ? null
    : schemaType.split('<')[0].trim();
};

const createLintEnvironment = (
  fieldTypes: ReadonlyMap<string, string> | null,
  base: Environment,
): Environment => {
  // `clone` copies the registry environment's registrations (the mixed
  // int/double operators, the built-ins and the host's functions) without
  // touching it. That environment is frozen when it is built (cel-v2
  // adapter), before anyone can clone it, so cloning here never stops a
  // registration that is still to come, whichever of boot, lint and
  // evaluation runs first.
  const environment = base.clone();

  if (fieldTypes !== null) {
    const schema = Object.fromEntries(fieldTypes);

    environment.registerVariable({ name: 'form', schema });
    environment.registerVariable({ name: 'formData', schema });
  }

  return environment;
};

/**
 * `env.check()` with each form field declared at its schema type. A refused
 * comparison the runtime accepts (see `isTolerated`) demotes the fields in it
 * to `dyn` and checks again; anything else is the finding. Bounded by the
 * field count, since every round demotes at least one field.
 */
const runTypeCheck = (
  expression: string,
  fieldTypes: ReadonlyMap<string, string> | null,
  base: Environment,
): TypeCheckOutcome => {
  const check = (
    types: ReadonlyMap<string, string> | null,
    rounds: number,
  ): TypeCheckOutcome => {
    const parsed = createLintEnvironment(types, base).parse(expression);
    const result = parsed.check();

    if (result.valid) {
      // The engine checks host and built-in parameters through their
      // signatures, except numbers, which are registered as `dyn` there:
      // compare each argument's checked type with the declared one here, or
      // `demo_costBand_v1(form.title)` publishes and fails every case.
      // A field demoted to `dyn` for a tolerated comparison is demoted in the
      // whole expression, so an argument that is that field is compared at
      // its schema type: `form.title != null && f(form.title)` still fails
      // every case with a text title.
      const mismatch = findCelV2ArgumentTypeMismatch(
        parsed.ast,
        base,
        (argument): string | null =>
          readDemotedFieldType(argument as ASTNode, fieldTypes, types),
      );

      if (mismatch === null) {
        return { status: 'OK', type: result.type };
      }

      const argumentFieldKeys = collectCelV2References(
        mismatch.argument as ASTNode,
      ).formFieldKeys;

      return {
        code: 'EXPR_FIELD_TYPE_MISMATCH',
        fieldKey: argumentFieldKeys.length === 1 ? argumentFieldKeys[0] : null,
        status: 'FAILED',
      };
    }

    const node = readCheckErrorNode(result.error);
    const fieldKeys = node ? collectCelV2References(node).formFieldKeys : [];
    const code = (result.error as CheckErrorShape | undefined)?.code;

    if (code === 'no_such_key') {
      return {
        code: 'EXPR_FIELD_UNKNOWN',
        fieldKey: fieldKeys.length === 1 ? fieldKeys[0] : null,
        status: 'FAILED',
      };
    }

    const demotable =
      types === null || node === null || !isTolerated(node)
        ? []
        : fieldKeys.filter((fieldKey) => {
            const type = types.get(fieldKey);

            return type !== undefined && type !== 'dyn';
          });

    if (types === null || demotable.length === 0 || rounds <= 0) {
      return {
        code: 'EXPR_FIELD_TYPE_MISMATCH',
        fieldKey: fieldKeys.length === 1 ? fieldKeys[0] : null,
        status: 'FAILED',
      };
    }

    return check(
      new Map(
        [...types].map(([fieldKey, type]): readonly [string, string] => [
          fieldKey,
          demotable.includes(fieldKey) ? 'dyn' : type,
        ]),
      ),
      rounds - 1,
    );
  };

  return check(fieldTypes, fieldTypes?.size ?? 0);
};

const lintTypes = (
  expression: string,
  label: string,
  context: ExpressionLintContext,
  base: Environment,
): readonly ExpressionLintIssue[] => {
  const fields = readSchemaFields(context.formSchema);
  const fieldTypes = context.formSchema
    ? new Map(
        fields.map((field): readonly [string, string] => [
          field.fieldKey,
          readExpressionFieldType(field),
        ]),
      )
    : null;
  const outcome = runTypeCheck(expression, fieldTypes, base);

  if (outcome.status === 'FAILED') {
    return [issue(outcome.code, label, outcome.fieldKey ?? undefined)];
  }

  return isResultTypeAccepted(outcome.type, readExpectedResultTypes(context))
    ? []
    : [issue('EXPR_RESULT_TYPE_MISMATCH', label)];
};

const readPathKey = (path: ExpressionFieldPath): string =>
  [path.root, ...path.segments].join('.');

const readGuardedFormFieldKeys = (
  references: ExpressionReferences,
): ReadonlySet<string> =>
  new Set(readFormFieldKeys(references.guardedFieldPaths));

const lintWarnings = (
  references: ExpressionReferences,
  label: string,
  context: ExpressionLintContext,
): readonly ExpressionLintIssue[] => {
  const fields = readSchemaFields(context.formSchema);
  const fieldsByKey = new Map(fields.map((field) => [field.fieldKey, field]));
  const guarded = readGuardedFormFieldKeys(references);
  const optionalIssues = context.formSchema
    ? references.formFieldKeys
        .filter((fieldKey) => fieldsByKey.get(fieldKey)?.required === false)
        .filter((fieldKey) => !guarded.has(fieldKey))
        .map((fieldKey) =>
          issue('EXPR_OPTIONAL_FIELD_WITHOUT_HAS', label, fieldKey),
        )
    : [];
  const orAbsorbs = readFormFieldKeys(references.orOperandFieldPaths).some(
    (fieldKey) => !guarded.has(fieldKey),
  );
  const hasTested = new Set(references.hasArguments.map(readPathKey));
  const hasNestedParent = references.hasArguments.some(
    (path) =>
      path.segments.length >= 2 &&
      !hasTested.has(
        readPathKey({ ...path, segments: path.segments.slice(0, -1) }),
      ),
  );
  const readsForm = references.roots.some((root) => FORM_ROOTS.has(root));
  const target = context.targetField;
  const hiddenCopies =
    context.usagePoint === 'SERVICE_FORM_FIELD_VALUE' &&
    target &&
    target.hidden !== true
      ? references.formFieldKeys.filter(
          (fieldKey) =>
            fieldKey !== target.fieldKey &&
            fieldsByKey.get(fieldKey)?.hidden === true,
        )
      : [];

  return [
    ...optionalIssues,
    ...(orAbsorbs ? [issue('EXPR_OR_ABSORBS_ERROR', label)] : []),
    ...(hasNestedParent ? [issue('EXPR_HAS_NESTED_PARENT', label)] : []),
    ...(context.usagePoint === 'APPROVER_RESOLVER' && readsForm
      ? [issue('EXPR_APPROVER_READS_FORM', label)]
      : []),
    ...hiddenCopies.map((fieldKey) =>
      issue('EXPR_HIDDEN_FIELD_COPIED', label, fieldKey),
    ),
    ...(references.divisorFieldPaths.length > 0
      ? [issue('EXPR_DIVISOR_IS_FIELD', label)]
      : []),
  ];
};

/**
 * The cel-v2 lint of one expression (ADR 22 §3.4, docs/24 §2.2): errors that
 * refuse a publish and warnings that do not, in that order. The expression is
 * expected trimmed and within the length limit (`ConditionService` checks
 * both first).
 *
 * `environmentRegistry` is the registry evaluation will run with (the one
 * `ConditionService` was given): the expression is parsed and type-checked in
 * its cel-v2 environment, so the built-ins and the host's functions are
 * type-checked like the engine's own. Absent means the built-ins only. It is
 * separate from `context.functionRegistry`, which only answers availability
 * (`assertPublishable`, `get`) and need not be able to build an environment.
 *
 * The type check (`env.check()`) runs only when nothing structural is wrong
 * and every function called is one that environment knows; a call to one it
 * does not know is covered by `EXPR_FUNCTION_NOT_REGISTERED` instead.
 */
export function lintCelV2Expression(
  expression: string,
  label: string,
  context: ExpressionLintContext = {},
  environmentRegistry?: BPMExpressionFunctionRegistry | null,
): readonly ExpressionLintIssue[] {
  const lintEnvironment = readLintEnvironment(environmentRegistry);
  const parsed = readCelV2References(expression, lintEnvironment.environment);

  if (parsed.status !== 'OK') {
    return [
      issue(
        parsed.status === 'PARSE_FAILED' && parsed.limitExceeded
          ? 'EXPR_COMPLEXITY_EXCEEDED'
          : 'EXPR_PARSE_FAILED',
        label,
      ),
    ];
  }

  const { references } = parsed;
  const structural = lintStructure(references, label, context);
  const fieldIssues = lintFields(references, label, context.formSchema);
  const functions = lintFunctions(references, label, context, lintEnvironment);
  const errors = [...structural, ...fieldIssues, ...functions.issues];
  const typeIssues =
    errors.length === 0 && !functions.uncheckable
      ? lintTypes(expression, label, context, lintEnvironment.environment)
      : [];

  return [
    ...errors,
    ...typeIssues,
    ...lintWarnings(references, label, context),
  ];
}

/**
 * The global function names an expression calls that cel-v2 does not provide
 * itself: the built-ins and host functions a rollback must find registered
 * (docs/24 §1). `null` when the expression cannot be read. Hand the result to
 * {@link readUnavailableExpressionFunctions}, which applies the same name
 * rule and registry isolation as the publish lint.
 */
export function readExpressionHostFunctionNames(
  expression: string,
  dialect: ExpressionDialect = DEFAULT_EXPRESSION_DIALECT,
): readonly string[] | null {
  // cel-legacy has no function registration at all: nothing to look up.
  if (dialect !== 'cel-v2') {
    return [];
  }

  const parsed = readCelV2References(expression);

  if (parsed.status !== 'OK') {
    return null;
  }

  const engine = readEngineFunctionNames().globals;

  return [
    ...new Set(
      parsed.references.functionCalls
        .filter((call) => !call.receiver && !engine.has(call.name))
        .map((call) => call.name),
    ),
  ];
}
