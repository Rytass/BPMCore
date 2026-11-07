import type { BPMExpressionFunction } from '@rytass/bpm-core-nestjs-module';
import type { BPMExpressionValue } from '@rytass/bpm-core-shared';

/*
 * Demo host functions for the wrapper app (ADR 22 §3.5). They exist to show
 * how a host registers one and to drive the designer and seed scenarios; they
 * are not part of `@rytass/bpm-core-nestjs-module`.
 *
 * A host function must be synchronous and pure: the same arguments always give
 * the same result, with no I/O and no clock, so a dry run, a preview and the
 * real evaluation agree. Keep every version a published template still calls;
 * add `_v2` beside `_v1` instead of changing what `_v1` returns.
 */

/** Purchase amount bands used by the Taiwan manufacturing demo flows (TWD). */
const COST_BANDS: readonly { readonly band: string; readonly below: number }[] =
  [
    { band: 'LOW', below: 50_000 },
    { band: 'MEDIUM', below: 500_000 },
  ];

/**
 * `demo_costBand_v1(amount)`: `'LOW'` under 50,000, `'MEDIUM'` under 500,000,
 * otherwise `'HIGH'`. The runtime has already checked that `amount` is a finite
 * number before the handler runs.
 */
export const demoCostBandV1: BPMExpressionFunction = {
  description:
    'The purchase cost band of an amount in TWD: LOW under 50,000, MEDIUM under 500,000, otherwise HIGH.',
  handler: (...args: readonly BPMExpressionValue[]): BPMExpressionValue => {
    const amount = args[0] as number;

    return COST_BANDS.find((entry) => amount < entry.below)?.band ?? 'HIGH';
  },
  label: '採購金額級距',
  name: 'demo_costBand_v1',
  parameters: [
    { description: '採購金額（新台幣）', name: 'amount', type: 'double' },
  ],
  returnType: 'string',
};

export const API_DEMO_EXPRESSION_FUNCTIONS: readonly BPMExpressionFunction[] = [
  demoCostBandV1,
];
