import { NotificationDigestModeEnum } from './notification.enums';

const MINUTES_PER_DAY = 24 * 60;
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

/**
 * A `time` column value as stored by `notification_preferences`, expressed as
 * minutes since local midnight. `null` when the preference is unset or holds a
 * value the DTO pattern would have rejected — a stored value BPM cannot read
 * must degrade to "no quiet hours" rather than throw during delivery.
 */
function parseTimeOfDay(value: string | null): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(
    value?.trim() ?? '',
  );

  if (!match) {
    return null;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

interface ZonedWallClock {
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly month: number;
  readonly year: number;
}

function readZonedWallClock(at: Date, timeZone: string): ZonedWallClock {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  // `hourCycle: h23` is what `hour12: false` resolves to in every runtime this
  // package supports, but Node has historically rendered midnight as `24`.
  const hour = read('hour');

  return {
    day: read('day'),
    hour: hour === 24 ? 0 : hour,
    minute: read('minute'),
    month: read('month'),
    year: read('year'),
  };
}

/** How far ahead of UTC the zone's local clock runs at `at`, in milliseconds. */
function readZoneOffsetMs(at: Date, timeZone: string): number {
  const wallClock = readZonedWallClock(at, timeZone);

  return (
    Date.UTC(
      wallClock.year,
      wallClock.month - 1,
      wallClock.day,
      wallClock.hour,
      wallClock.minute,
    ) -
    // The formatter drops seconds and milliseconds, so compare against an
    // instant truncated the same way.
    Math.floor(at.getTime() / MS_PER_MINUTE) * MS_PER_MINUTE
  );
}

/**
 * The instant at which the zone's local clock reads the given wall-clock time.
 *
 * Resolved in two passes because the offset to apply is itself a function of
 * the instant: the first pass guesses using the offset in force at the naive
 * UTC reading, the second re-reads the offset at that guess. That settles
 * every case except a wall-clock time inside a spring-forward gap, which does
 * not exist locally and lands on the instant the clock jumps to.
 */
function zonedWallClockToInstant(
  wallClock: ZonedWallClock,
  timeZone: string,
): Date {
  const naiveUtc = Date.UTC(
    wallClock.year,
    wallClock.month - 1,
    wallClock.day,
    wallClock.hour,
    wallClock.minute,
  );
  const firstGuess = new Date(
    naiveUtc - readZoneOffsetMs(new Date(naiveUtc), timeZone),
  );

  return new Date(naiveUtc - readZoneOffsetMs(firstGuess, timeZone));
}

/**
 * The first instant at or after `at` whose local clock reads
 * `minuteOfDay`. Returns `at` itself when it already lands exactly there.
 */
function nextLocalTimeOfDay(
  at: Date,
  timeZone: string,
  minuteOfDay: number,
): Date {
  const wallClock = readZonedWallClock(at, timeZone);
  const sameDay = zonedWallClockToInstant(
    {
      ...wallClock,
      hour: Math.floor(minuteOfDay / 60),
      minute: minuteOfDay % 60,
    },
    timeZone,
  );

  if (sameDay.getTime() >= at.getTime()) {
    return sameDay;
  }

  // Step a day forward through the instant rather than the calendar so a
  // month or year boundary needs no special case, then re-anchor the local
  // time in case the offset changed overnight.
  const nextDay = readZonedWallClock(
    new Date(sameDay.getTime() + MS_PER_DAY),
    timeZone,
  );

  return zonedWallClockToInstant(
    {
      ...nextDay,
      hour: Math.floor(minuteOfDay / 60),
      minute: minuteOfDay % 60,
    },
    timeZone,
  );
}

export interface NotificationQuietHours {
  readonly quietHoursEnd: string | null;
  readonly quietHoursStart: string | null;
  readonly timeZone: string;
}

/**
 * Whether `at` falls inside the recipient's quiet hours.
 *
 * A window whose start equals its end is treated as **no** quiet hours rather
 * than as all day: the destructive reading of an ambiguous setting is the one
 * that silently swallows every notification.
 */
export function isWithinQuietHours(
  at: Date,
  { quietHoursEnd, quietHoursStart, timeZone }: NotificationQuietHours,
): boolean {
  const start = parseTimeOfDay(quietHoursStart);
  const end = parseTimeOfDay(quietHoursEnd);

  if (start === null || end === null || start === end) {
    return false;
  }

  const wallClock = readZonedWallClock(at, timeZone);
  const minuteOfDay = wallClock.hour * 60 + wallClock.minute;

  return start < end
    ? minuteOfDay >= start && minuteOfDay < end
    : // A window that wraps past midnight (22:00–08:00) is the common case.
      minuteOfDay >= start || minuteOfDay < end;
}

/**
 * The instant the current quiet period ends, or `null` when `at` is not inside
 * one.
 */
export function resolveQuietHoursEnd(
  at: Date,
  quietHours: NotificationQuietHours,
): Date | null {
  if (!isWithinQuietHours(at, quietHours)) {
    return null;
  }

  const end = parseTimeOfDay(quietHours.quietHoursEnd);

  return end === null
    ? null
    : nextLocalTimeOfDay(at, quietHours.timeZone, end % MINUTES_PER_DAY);
}

export interface EmailReleaseOptions extends NotificationQuietHours {
  /** Local hour at which a `DAILY` recipient's held email is flushed. */
  readonly digestHour: number;
  readonly digestMode: NotificationDigestModeEnum;
}

/**
 * When an email notification created at `at` may actually be sent, or `null`
 * when it may go out immediately.
 *
 * The returned instant is written to the row's `nextRetryAt`, which is exactly
 * what the delivery scan already treats as "not before": deferring reuses the
 * retry machinery instead of adding a second scheduler, and means quiet hours
 * *delay* a notification rather than drop it.
 */
export function resolveEmailReleaseAt(
  at: Date,
  options: EmailReleaseOptions,
): Date | null {
  const digestAt =
    options.digestMode === NotificationDigestModeEnum.DAILY
      ? nextLocalTimeOfDay(
          at,
          options.timeZone,
          normalizeDigestHour(options.digestHour) * 60,
        )
      : at;
  // Re-checked at the digest boundary, not at `at`: a digest hour that itself
  // falls inside the quiet window must still wait for the window to close.
  const releaseAt = resolveQuietHoursEnd(digestAt, options) ?? digestAt;

  return releaseAt.getTime() > at.getTime() ? releaseAt : null;
}

export const DEFAULT_EMAIL_DIGEST_HOUR = 9;

/**
 * Last-resort zone for quiet hours, used only when neither
 * `notificationQuietHoursTimeZone` nor a registered business calendar answers.
 */
export const DEFAULT_QUIET_HOURS_TIME_ZONE = 'UTC';

export function normalizeDigestHour(value: number | undefined): number {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 23
    ? value
    : DEFAULT_EMAIL_DIGEST_HOUR;
}
