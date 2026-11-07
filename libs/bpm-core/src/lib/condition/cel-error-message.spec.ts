import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import {
  CelEngineUnavailableError,
  describeCelEvaluationError,
} from './cel-error-message';
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
const LIST_MARKER = 'TWD';
const SUFFIX_MARKER = 'u';
const MARKERS: readonly string[] = [
  FORM_MARKER,
  INITIATOR_MARKER,
  NUMBER_MARKER,
  INDEX_MARKER,
  LIST_MARKER,
  `"${SUFFIX_MARKER}"`,
];

const CONTEXT = {
  form: {
    count: Number(NUMBER_MARKER),
    index: Number(INDEX_MARKER),
    items: [1, 2],
    map: { known: 1 },
    nothing: null,
    other: FORM_MARKER,
    sel: LIST_MARKER,
    suffix: SUFFIX_MARKER,
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
    expected: 'Identifier "a-b" not found',
    expression: 'form["a-b"] != null',
    name: 'absent key that is not an identifier',
  },
  {
    expected: 'Identifier not found',
    expression: 'form[form.other] == 1',
    name: 'form indexed by a string form value',
  },
  {
    expected: 'Identifier not found',
    expression: 'form.map[initiator.name] == 1',
    name: 'map indexed by an initiator value',
  },
  {
    expected: 'Identifier not found',
    expression: 'form.items[form.index] == 1',
    name: 'list indexed by a number form value',
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
  {
    expected: 'Identifier not found',
    expression: 'form.map[form.sel] == 1 || form.sel in ["TWD"]',
    name: 'one-element list literal equal to the evaluated index',
  },
  {
    expected: 'Identifier not found',
    expression: 'form.map[form.suffix] == 5u',
    name: 'number suffix equal to the evaluated index',
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
    expect(
      readCaptured('form indexed by a string form value').message,
    ).toContain(FORM_MARKER);
    expect(readCaptured('map indexed by an initiator value').message).toContain(
      INITIATOR_MARKER,
    );
    expect(
      readCaptured('list indexed by a number form value').message,
    ).toContain(INDEX_MARKER);
    expect(
      readCaptured('absent key that is not an identifier').message,
    ).toContain('Identifier "a-b" not found');
    expect(readCaptured('size() on a non-list value').message).toContain(
      NUMBER_MARKER,
    );
    expect(readCaptured('index out of bounds').message).toContain(INDEX_MARKER);
    expect(readCaptured('null ordering type error').errorName).toBe(
      'CelTypeError',
    );
    expect(
      readCaptured('one-element list literal equal to the evaluated index')
        .message,
    ).toContain(`Identifier "${LIST_MARKER}" not found`);
    expect(
      readCaptured('number suffix equal to the evaluated index').message,
    ).toContain(`Identifier "${SUFFIX_MARKER}" not found`);
  });

  it.each(PROBES)(
    'describeCelEvaluationError keeps only the allowlisted part: $name',
    ({ expected, expression, name }): void => {
      const description = describeCelEvaluationError(
        toError(readCaptured(name)),
        expression,
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
    const messages = PROBES.map(({ expression, name }) =>
      describeCelEvaluationError(toError(readCaptured(name)), expression),
    );

    expect(
      messages.filter((message) => message.startsWith('Identifier "')),
    ).toEqual(['Identifier "agent" not found', 'Identifier "a-b" not found']);
  });

  it('names the engine-load failure by its class, not its message', (): void => {
    expect(
      describeCelEvaluationError(
        new CelEngineUnavailableError(`cannot load (${FORM_MARKER})`),
      ),
    ).toBe('CelEngineUnavailableError');
  });

  it('drops the name when there is no expression to vouch for it', (): void => {
    expect(
      describeCelEvaluationError(
        toError(readCaptured('absent identifier (context embedded)')),
      ),
    ).toBe('Identifier not found');
  });

  it('does not take a name from inside a string literal', (): void => {
    const error = new Error('Identifier "agent" not found, no context passed');

    expect(describeCelEvaluationError(error, 'form.x == "agent"')).toBe(
      'Identifier not found',
    );
    expect(describeCelEvaluationError(error, 'form.agent == "x"')).toBe(
      'Identifier "agent" not found',
    );
    expect(describeCelEvaluationError(error, 'form["agent"] == "x"')).toBe(
      'Identifier "agent" not found',
    );
    expect(describeCelEvaluationError(error, "form['agent'] == 'x'")).toBe(
      'Identifier "agent" not found',
    );
  });

  it('counts a bracketed string as an index only after an expression', (): void => {
    const error = new Error('Identifier "k" not found, no context passed');
    const echoed = 'Identifier "k" not found';
    const dropped = 'Identifier not found';

    ['form.m["k"] == 1', 'form.m [ "k" ] == 1', '(form.m)["k"] == 1'].forEach(
      (expression) =>
        expect(describeCelEvaluationError(error, expression)).toBe(echoed),
    );
    [
      '["k"] == form.l',
      'form.x in ["k"]',
      'form.x in["k"]',
      'f(["k"])',
      '[1, ["k"]]',
      '[["k"]]',
    ].forEach((expression) =>
      expect(describeCelEvaluationError(error, expression)).toBe(dropped),
    );
  });

  it('does not take a name from the suffix of a number', (): void => {
    const error = new Error('Identifier "u" not found, no context passed');

    expect(describeCelEvaluationError(error, 'form.x == 5u')).toBe(
      'Identifier not found',
    );
    expect(
      describeCelEvaluationError(
        new Error('Identifier "e5" not found, no context passed'),
        'form.x == 1e5',
      ),
    ).toBe('Identifier not found');
    expect(describeCelEvaluationError(error, 'form.u == 5u')).toBe(
      'Identifier "u" not found',
    );
  });

  it('accepts the no-context variant and refuses a look-alike prefix', (): void => {
    expect(
      describeCelEvaluationError(
        new Error('Identifier "agent" not found, no context passed'),
        'form.agent != null',
      ),
    ).toBe('Identifier "agent" not found');
    expect(
      describeCelEvaluationError(
        new Error(`Identifier "agent" not found; leaked ${FORM_MARKER}`),
        'form.agent != null',
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
