import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { describeCelEvaluationError } from './cel-error-message';
import { ConditionService } from './condition.service';

/**
 * Evaluation errors from the real cel-js must never carry the evaluation
 * context. Jest maps `cel-js` to a JavaScript-eval shim that does not produce
 * cel-js messages, so the real messages are captured in a child Node process
 * (same approach as `cel-js-list-behaviour.spec.ts`) and replayed in-process
 * as errors with the same class name and message.
 */
const FORM_MARKER = 'secret-form-value';
const INITIATOR_MARKER = 'secret-initiator-value';
const NUMBER_MARKER = '424242';
const INDEX_MARKER = '9191';
const MARKERS: readonly string[] = [
  FORM_MARKER,
  INITIATOR_MARKER,
  NUMBER_MARKER,
  INDEX_MARKER,
];

const CONTEXT = {
  form: {
    count: Number(NUMBER_MARKER),
    index: Number(INDEX_MARKER),
    nothing: null,
    other: FORM_MARKER,
  },
  initiator: { name: INITIATOR_MARKER },
};

interface Probe {
  readonly expected: string;
  readonly expression: string;
  readonly name: string;
}

const PROBES: readonly Probe[] = [
  {
    expected: 'Identifier "agent" not found',
    expression: 'form.agent != null',
    name: 'absent identifier (context embedded)',
  },
  {
    expected: 'Error',
    expression: 'form.other.x == 1',
    name: 'non-object access on a string value',
  },
  {
    expected: 'CelEvaluationError',
    expression: 'size(form.count)',
    name: 'size() on a non-list value',
  },
  {
    expected: 'CelEvaluationError',
    expression: '[1, 2][form.index] == 1',
    name: 'index out of bounds',
  },
  {
    expected: 'CelTypeError',
    expression: 'form.nothing > 5',
    name: 'null ordering type error',
  },
];

interface CapturedError {
  readonly errorName: string;
  readonly message: string;
  readonly name: string;
}

const captured = captureRealCelErrors();
let mockThrown: Error | null = null;

jest.mock('cel-js', () => ({
  evaluate: (): never => {
    throw mockThrown;
  },
  parse: (expression: string): unknown => ({
    cst: { expression },
    isSuccess: true,
  }),
}));

describe('CEL evaluation error sanitising', () => {
  it('captured messages really carry the data (premise of the suite)', (): void => {
    const identifierError = readCaptured(
      'absent identifier (context embedded)',
    );

    expect(identifierError.message).toContain(FORM_MARKER);
    expect(identifierError.message).toContain(INITIATOR_MARKER);
    expect(
      readCaptured('non-object access on a string value').message,
    ).toContain(FORM_MARKER);
    expect(readCaptured('size() on a non-list value').message).toContain(
      NUMBER_MARKER,
    );
    expect(readCaptured('index out of bounds').message).toContain(INDEX_MARKER);
    expect(readCaptured('null ordering type error').errorName).toBe(
      'CelTypeError',
    );
  });

  it.each(PROBES)(
    'describeCelEvaluationError keeps only the allowlisted part: $name',
    ({ expected, name }): void => {
      const description = describeCelEvaluationError(
        toError(readCaptured(name)),
      );

      expect(description).toBe(expected);
      MARKERS.forEach((marker) => expect(description).not.toContain(marker));
    },
  );

  it.each(PROBES)(
    'ConditionService error keeps the label and nothing from the engine message: $name',
    ({ expected, expression, name }): void => {
      mockThrown = toError(readCaptured(name));

      const thrown = catchError(() =>
        new ConditionService().evaluateBoolean(
          expression,
          CONTEXT,
          'workflow.edges.e1.condition',
        ),
      );

      expect(thrown).toBeInstanceOf(BadRequestException);
      expect((thrown as BadRequestException).message).toBe(
        `workflow.edges.e1.condition: ${expected}`,
      );
      MARKERS.forEach((marker) =>
        expect((thrown as BadRequestException).message).not.toContain(marker),
      );
    },
  );

  it('names the identifier only for the identifier error', (): void => {
    const messages = PROBES.map(({ name }) =>
      describeCelEvaluationError(toError(readCaptured(name))),
    );

    expect(messages.filter((message) => message.includes('"agent"'))).toEqual([
      'Identifier "agent" not found',
    ]);
  });

  it('accepts the no-context variant and refuses a look-alike prefix', (): void => {
    expect(
      describeCelEvaluationError(
        new Error('Identifier "agent" not found, no context passed'),
      ),
    ).toBe('Identifier "agent" not found');
    expect(
      describeCelEvaluationError(
        new Error(`Identifier "agent" not found; leaked ${FORM_MARKER}`),
      ),
    ).toBe('Error');
    expect(
      describeCelEvaluationError(
        new Error(`Cannot obtain "x" from non-object context: ${FORM_MARKER}`),
      ),
    ).toBe('Error');
  });

  it('reduces a non-Error throw and an odd error name to a fixed word', (): void => {
    expect(describeCelEvaluationError(FORM_MARKER)).toBe('EvaluationError');

    const oddName = Object.assign(new Error('x'), {
      name: `Bad ${FORM_MARKER}`,
    });

    expect(describeCelEvaluationError(oddName)).toBe('EvaluationError');
  });

  function readCaptured(name: string): CapturedError {
    const found = captured.find((item) => item.name === name);

    if (!found) {
      throw new Error(`No captured error for ${name}`);
    }

    return found;
  }
});

function toError(item: CapturedError): Error {
  return Object.assign(new Error(item.message), { name: item.errorName });
}

function catchError(action: () => unknown): unknown {
  try {
    action();
  } catch (error: unknown) {
    return error;
  }

  throw new Error('Expected the action to throw');
}

function captureRealCelErrors(): readonly CapturedError[] {
  const script = `
    import { evaluate, parse } from 'cel-js';

    const context = ${JSON.stringify(CONTEXT)};
    const probes = ${JSON.stringify(PROBES)};
    const results = probes.map(({ expression, name }) => {
      try {
        evaluate(parse(expression).cst, { ...context });
      } catch (error) {
        return { errorName: error.name, message: error.message, name };
      }

      throw new Error('probe did not throw: ' + name);
    });

    process.stdout.write(JSON.stringify(results));
  `;
  const output = execFileSync(
    process.execPath,
    ['--input-type=module', '-e', script],
    {
      cwd: resolve(__dirname, '../../..'),
      encoding: 'utf8',
    },
  );

  return JSON.parse(output) as readonly CapturedError[];
}
