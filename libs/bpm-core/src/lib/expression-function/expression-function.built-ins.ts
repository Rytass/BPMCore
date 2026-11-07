import type {
  BPMBuiltInExpressionFunctionName,
  BPMExpressionFunctionParameter,
  BPMExpressionValue,
} from '@rytass/bpm-core-shared';
import type { BPMExpressionFunction } from './expression-function.types';

/*
 * The nine core functions (ADR 22 §3.5). Pure computation only: no time, no
 * randomness, no I/O, so a dry run, a preview and the real evaluation always
 * agree. Their names are reserved and carry no version suffix.
 *
 * Every handler receives arguments the runtime has already checked against
 * `parameters` (a `double` is a finite JS number, a `string` a string), so the
 * casts below only restate that check.
 *
 * Numeric results are always `double`, in both dialects: cel-legacy only has JS
 * numbers, and in cel-v2 `round(form.amount) == 2` still holds through the
 * exact `int == double` operator the adapter registers.
 */

const NUMBER_PARAMETER: BPMExpressionFunctionParameter = {
  name: 'value',
  type: 'double',
};

const STRING_PARAMETER: BPMExpressionFunctionParameter = {
  name: 'value',
  type: 'string',
};

const PAIR_PARAMETERS: readonly BPMExpressionFunctionParameter[] = [
  { name: 'left', type: 'double' },
  { name: 'right', type: 'double' },
];

/** `-0` reads as `0` in JSON but not to `Object.is`; results never carry it. */
const withoutNegativeZero = (value: number): number =>
  value === 0 ? 0 : value;

const unaryNumber =
  (operation: (value: number) => number) =>
  (...args: readonly BPMExpressionValue[]): BPMExpressionValue =>
    withoutNegativeZero(operation(args[0] as number));

const binaryNumber =
  (operation: (left: number, right: number) => number) =>
  (...args: readonly BPMExpressionValue[]): BPMExpressionValue =>
    withoutNegativeZero(operation(args[0] as number, args[1] as number));

const unaryString =
  (operation: (value: string) => string) =>
  (...args: readonly BPMExpressionValue[]): BPMExpressionValue =>
    operation(args[0] as string);

/**
 * Rounds half away from zero, as spreadsheets and most business rules do:
 * `round(2.5)` is 3 and `round(-2.5)` is -3. `Math.round` alone would give -2.
 */
const roundHalfAwayFromZero = (value: number): number =>
  Math.sign(value) * Math.round(Math.abs(value));

/**
 * The built-ins, in the order `list()` reports them (alphabetical, matching
 * `BPM_BUILT_IN_EXPRESSION_FUNCTION_NAMES`).
 */
export const BPM_BUILT_IN_EXPRESSION_FUNCTIONS: readonly (BPMExpressionFunction & {
  readonly name: BPMBuiltInExpressionFunctionName;
})[] = Object.freeze([
  {
    description: 'The absolute value of a number.',
    handler: unaryNumber(Math.abs),
    label: '絕對值',
    name: 'abs',
    parameters: [NUMBER_PARAMETER],
    returnType: 'double',
  },
  {
    description: 'The smallest integer not less than a number.',
    handler: unaryNumber(Math.ceil),
    label: '無條件進位',
    name: 'ceil',
    parameters: [NUMBER_PARAMETER],
    returnType: 'double',
  },
  {
    description: 'The largest integer not greater than a number.',
    handler: unaryNumber(Math.floor),
    label: '無條件捨去',
    name: 'floor',
    parameters: [NUMBER_PARAMETER],
    returnType: 'double',
  },
  {
    description:
      'A string in lower case. Locale independent: the same input always gives the same result.',
    handler: unaryString((value: string): string => value.toLowerCase()),
    label: '轉小寫',
    name: 'lower',
    parameters: [STRING_PARAMETER],
    returnType: 'string',
  },
  {
    description: 'The larger of two numbers.',
    handler: binaryNumber(Math.max),
    label: '較大值',
    name: 'max',
    parameters: PAIR_PARAMETERS,
    returnType: 'double',
  },
  {
    description: 'The smaller of two numbers.',
    handler: binaryNumber(Math.min),
    label: '較小值',
    name: 'min',
    parameters: PAIR_PARAMETERS,
    returnType: 'double',
  },
  {
    description:
      'A number rounded to the nearest integer; halves round away from zero.',
    handler: unaryNumber(roundHalfAwayFromZero),
    label: '四捨五入',
    name: 'round',
    parameters: [NUMBER_PARAMETER],
    returnType: 'double',
  },
  {
    description: 'A string without leading and trailing whitespace.',
    handler: unaryString((value: string): string => value.trim()),
    label: '去除前後空白',
    name: 'trim',
    parameters: [STRING_PARAMETER],
    returnType: 'string',
  },
  {
    description:
      'A string in upper case. Locale independent: the same input always gives the same result.',
    handler: unaryString((value: string): string => value.toUpperCase()),
    label: '轉大寫',
    name: 'upper',
    parameters: [STRING_PARAMETER],
    returnType: 'string',
  },
]);
