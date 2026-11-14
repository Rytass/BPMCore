/**
 * Tuning for the instance event outbox (ADR 27 §1.4). Defaults match the
 * workflow webhook outbox so an operator reasons about one retry policy.
 */
export interface BPMInstanceEventDeliveryOptions {
  /** Rows claimed per scan. Default 25. */
  readonly batchSize: number;
  /** Time the observer gets to answer one event. Default 10000 ms. */
  readonly dispatchTimeoutMs: number;
  /** Attempts before a row is parked as `FAILED`. Default 6. */
  readonly maxAttempts: number;
  /** Upper bound on a single retry delay. Default 3600000 ms. */
  readonly maxRetryDelayMs: number;
  /** Days a `DELIVERED` row is kept. `FAILED` rows are never swept. Default 30. */
  readonly retentionDays: number;
  /** Base of the exponential retry delay. Default 30000 ms. */
  readonly retryBaseDelayMs: number;
  /** Interval of the fallback scan. Default 15000 ms. */
  readonly scanIntervalMs: number;
}

export const DEFAULT_BPM_INSTANCE_EVENT_DELIVERY_OPTIONS: BPMInstanceEventDeliveryOptions =
  {
    batchSize: 25,
    dispatchTimeoutMs: 10_000,
    maxAttempts: 6,
    maxRetryDelayMs: 3_600_000,
    retentionDays: 30,
    retryBaseDelayMs: 30_000,
    scanIntervalMs: 15_000,
  };

/**
 * Fills every unset or non-positive field from the defaults. A host that sets
 * `batchSize: 0` gets 25, not an outbox that never delivers.
 */
export function resolveInstanceEventDeliveryOptions(
  overrides: Partial<BPMInstanceEventDeliveryOptions> | undefined,
): BPMInstanceEventDeliveryOptions {
  const defaults = DEFAULT_BPM_INSTANCE_EVENT_DELIVERY_OPTIONS;

  return {
    batchSize: readPositive(overrides?.batchSize, defaults.batchSize),
    dispatchTimeoutMs: readPositive(
      overrides?.dispatchTimeoutMs,
      defaults.dispatchTimeoutMs,
    ),
    maxAttempts: readPositive(overrides?.maxAttempts, defaults.maxAttempts),
    maxRetryDelayMs: readPositive(
      overrides?.maxRetryDelayMs,
      defaults.maxRetryDelayMs,
    ),
    retentionDays: readPositive(
      overrides?.retentionDays,
      defaults.retentionDays,
    ),
    retryBaseDelayMs: readPositive(
      overrides?.retryBaseDelayMs,
      defaults.retryBaseDelayMs,
    ),
    scanIntervalMs: readPositive(
      overrides?.scanIntervalMs,
      defaults.scanIntervalMs,
    ),
  };
}

function readPositive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}
