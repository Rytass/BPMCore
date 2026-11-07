import { Logger } from '@nestjs/common';
import { ConditionService } from './condition.service';
import {
  readExpressionOutcome,
  runExpressionDifferential,
} from './expression-differential';
import {
  DIFFERENTIAL_CORPUS,
  readDifferentialContext,
} from './expression-differential.corpus';

/**
 * Phase 23 P1 gate: every expression shape in the repo, evaluated by both real
 * engines. A new difference, or a changed outcome, fails here. Each id below is
 * listed and judged in docs/23 §P1; add it there before adding it here.
 */
const DOCUMENTED_DIFFERENCE_IDS: readonly string[] = [
  'D06',
  'D20',
  'D21',
  'D30',
  'D31',
  'D32',
  'D33',
  'G14',
  'G25',
  'F01',
  'F11',
  'F27',
  'P02',
  'P04',
  'P06',
  'P08',
  'P09',
  'P10',
  'P11',
  'P21',
  'P24',
  'P25',
  'P26',
  'P27',
  'P28',
  'P34',
  'P35',
  'P39',
  'P41',
  'P42',
  'P43',
  'P44',
  'P45',
];

describe('cel-legacy and cel-v2 on the repo corpus', (): void => {
  const service = new ConditionService();

  beforeAll((): void => {
    service.prepareEngine('cel-legacy');
    service.prepareEngine('cel-v2');
  });

  beforeEach((): void => {
    jest.spyOn(Logger.prototype, 'debug').mockReturnValue(undefined);
    jest.spyOn(Logger.prototype, 'warn').mockReturnValue(undefined);
  });

  afterEach((): void => {
    jest.restoreAllMocks();
  });

  it('has unique ids', (): void => {
    const ids = DIFFERENTIAL_CORPUS.map((entry) => entry.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(DIFFERENTIAL_CORPUS.map((entry) => [entry.id, entry] as const))(
    '%s gives the pinned outcome in each dialect',
    (_id, entry): void => {
      const result = runExpressionDifferential(
        {
          context: readDifferentialContext(entry),
          expression: entry.expression,
        },
        service,
      );

      expect({ legacy: result.legacy, v2: result.v2 }).toEqual(entry.expected);
    },
  );

  it('lists every difference, and only those, as documented', (): void => {
    const differing = DIFFERENTIAL_CORPUS.filter(
      (entry) => entry.expected.legacy !== entry.expected.v2,
    ).map((entry) => entry.id);

    expect(differing).toEqual(DOCUMENTED_DIFFERENCE_IDS);
  });

  // Phase 23 P1 gate: a definition or rule saved before the dialect existed
  // has none, and must evaluate exactly as cel-legacy did.
  it.each(DIFFERENTIAL_CORPUS.map((entry) => [entry.id, entry] as const))(
    '%s without a dialect evaluates as cel-legacy',
    (_id, entry): void => {
      expect(
        readExpressionOutcome(
          service,
          {
            context: readDifferentialContext(entry),
            expression: entry.expression,
          },
          undefined,
        ),
      ).toBe(entry.expected.legacy);
    },
  );
});
