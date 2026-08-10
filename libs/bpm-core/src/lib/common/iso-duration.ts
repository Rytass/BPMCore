const ISO_DURATION_PATTERN =
  /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/u;

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

export const MS_PER_DAY =
  HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;

/**
 * The day component and the sub-day (time) component of an ISO duration, kept
 * apart because business-day SLA scheduling advances them differently: `days`
 * skips non-business dates, `timeMs` is added as plain elapsed time.
 */
export interface IsoDurationParts {
  readonly days: number;
  readonly timeMs: number;
}

export function parseIsoDurationToMilliseconds(value: string): number | null {
  const parts = parseIsoDurationParts(value);

  return parts ? parts.days * MS_PER_DAY + parts.timeMs : null;
}

export function parseIsoDurationParts(value: string): IsoDurationParts | null {
  const match = ISO_DURATION_PATTERN.exec(value.trim());

  if (!match) {
    return null;
  }

  const days = readDurationUnit(match[1]);
  const hours = readDurationUnit(match[2]);
  const minutes = readDurationUnit(match[3]);
  const seconds = readDurationUnit(match[4]);
  const timeSeconds =
    seconds +
    minutes * SECONDS_PER_MINUTE +
    hours * MINUTES_PER_HOUR * SECONDS_PER_MINUTE;

  if (days === 0 && timeSeconds === 0) {
    return null;
  }

  return { days, timeMs: timeSeconds * MS_PER_SECOND };
}

function readDurationUnit(value: string | undefined): number {
  return value ? Number(value) : 0;
}
