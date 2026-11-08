import {
  API_DEMO_EXPRESSION_FUNCTIONS,
  demoCostBandV1,
} from './api-expression-functions';

// The core's registration checks run when BPM boots (and in the core's own
// registry spec). Importing the registry here would make ts-jest compile the
// whole core under this app's settings, so this spec stays on the handler.
describe('API demo expression functions', (): void => {
  it('registers one versioned, synchronous function', (): void => {
    expect(API_DEMO_EXPRESSION_FUNCTIONS.map((fn) => fn.name)).toEqual([
      'demo_costBand_v1',
    ]);
    expect(demoCostBandV1.parameters).toEqual([
      { description: '採購金額（新台幣）', name: 'amount', type: 'double' },
    ]);
    expect(demoCostBandV1.returnType).toBe('string');
    expect(Object.prototype.toString.call(demoCostBandV1.handler)).toBe(
      '[object Function]',
    );
  });

  it.each([
    [0, 'LOW'],
    [49_999.99, 'LOW'],
    [50_000, 'MEDIUM'],
    [499_999, 'MEDIUM'],
    [500_000, 'HIGH'],
  ])('bands %p as %p', (amount: number, band: string): void => {
    expect(demoCostBandV1.handler(amount)).toBe(band);
  });
});
