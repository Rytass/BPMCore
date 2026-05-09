const ISO_DURATION_PATTERN =
  /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/u;

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

export function parseIsoDurationToMilliseconds(value: string): number | null {
  const match = ISO_DURATION_PATTERN.exec(value.trim());

  if (!match) {
    return null;
  }

  const days = readDurationUnit(match[1]);
  const hours = readDurationUnit(match[2]);
  const minutes = readDurationUnit(match[3]);
  const seconds = readDurationUnit(match[4]);
  const totalSeconds =
    seconds +
    minutes * SECONDS_PER_MINUTE +
    hours * MINUTES_PER_HOUR * SECONDS_PER_MINUTE +
    days * HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE;

  return totalSeconds > 0 ? totalSeconds * MS_PER_SECOND : null;
}

function readDurationUnit(value: string | undefined): number {
  return value ? Number(value) : 0;
}
