import { NotificationDigestModeEnum } from './notification.enums';
import {
  isWithinQuietHours,
  resolveEmailReleaseAt,
  resolveQuietHoursEnd,
} from './notification-schedule';

const TAIPEI = 'Asia/Taipei';

describe('isWithinQuietHours', () => {
  it('treats a window that wraps past midnight as one period', () => {
    const quietHours = {
      quietHoursEnd: '08:00',
      quietHoursStart: '22:00',
      timeZone: TAIPEI,
    };

    // 23:30 and 03:00 Taipei — both inside the same 22:00–08:00 window.
    expect(
      isWithinQuietHours(new Date('2026-08-18T15:30:00.000Z'), quietHours),
    ).toBe(true);
    expect(
      isWithinQuietHours(new Date('2026-08-18T19:00:00.000Z'), quietHours),
    ).toBe(true);
    // 09:00 Taipei.
    expect(
      isWithinQuietHours(new Date('2026-08-18T01:00:00.000Z'), quietHours),
    ).toBe(false);
  });

  it('reads the window in the configured zone, not in UTC', () => {
    const at = new Date('2026-08-18T15:30:00.000Z');

    expect(
      isWithinQuietHours(at, {
        quietHoursEnd: '08:00',
        quietHoursStart: '22:00',
        timeZone: TAIPEI,
      }),
    ).toBe(true);
    // The same instant is 15:30 in UTC, which is outside the window.
    expect(
      isWithinQuietHours(at, {
        quietHoursEnd: '08:00',
        quietHoursStart: '22:00',
        timeZone: 'UTC',
      }),
    ).toBe(false);
  });

  it('handles a window inside a single day', () => {
    const quietHours = {
      quietHoursEnd: '05:00',
      quietHoursStart: '01:00',
      timeZone: TAIPEI,
    };

    // 03:00 Taipei.
    expect(
      isWithinQuietHours(new Date('2026-08-18T19:00:00.000Z'), quietHours),
    ).toBe(true);
    // 23:30 Taipei.
    expect(
      isWithinQuietHours(new Date('2026-08-18T15:30:00.000Z'), quietHours),
    ).toBe(false);
  });

  it('never silences on an unset, unreadable or empty window', () => {
    const at = new Date('2026-08-18T15:30:00.000Z');

    expect(
      isWithinQuietHours(at, {
        quietHoursEnd: null,
        quietHoursStart: '22:00',
        timeZone: TAIPEI,
      }),
    ).toBe(false);
    expect(
      isWithinQuietHours(at, {
        quietHoursEnd: 'not-a-time',
        quietHoursStart: '22:00',
        timeZone: TAIPEI,
      }),
    ).toBe(false);
    // start === end is ambiguous, and the reading that swallows a whole day of
    // notifications is the wrong one to guess.
    expect(
      isWithinQuietHours(at, {
        quietHoursEnd: '22:00',
        quietHoursStart: '22:00',
        timeZone: TAIPEI,
      }),
    ).toBe(false);
  });
});

describe('resolveQuietHoursEnd', () => {
  it('returns the next local end of the window', () => {
    // 23:30 Taipei on 2026-08-18 → 08:00 Taipei on 2026-08-19.
    expect(
      resolveQuietHoursEnd(new Date('2026-08-18T15:30:00.000Z'), {
        quietHoursEnd: '08:00',
        quietHoursStart: '22:00',
        timeZone: TAIPEI,
      })?.toISOString(),
    ).toBe('2026-08-19T00:00:00.000Z');
  });

  it('returns null outside the window', () => {
    expect(
      resolveQuietHoursEnd(new Date('2026-08-18T01:00:00.000Z'), {
        quietHoursEnd: '08:00',
        quietHoursStart: '22:00',
        timeZone: TAIPEI,
      }),
    ).toBeNull();
  });

  it('lands on the correct instant across a spring-forward transition', () => {
    // 2026-03-08 is the US spring-forward date; 02:00 does not exist locally.
    // 23:30 New York on 2026-03-07 is 04:30Z on the 8th; the window closes at
    // 08:00 EDT, which is 12:00Z rather than the 13:00Z an EST offset gives.
    expect(
      resolveQuietHoursEnd(new Date('2026-03-08T04:30:00.000Z'), {
        quietHoursEnd: '08:00',
        quietHoursStart: '22:00',
        timeZone: 'America/New_York',
      })?.toISOString(),
    ).toBe('2026-03-08T12:00:00.000Z');
  });
});

describe('resolveEmailReleaseAt', () => {
  const instantNoQuietHours = {
    digestHour: 9,
    digestMode: NotificationDigestModeEnum.INSTANT,
    quietHoursEnd: null,
    quietHoursStart: null,
    timeZone: TAIPEI,
  };

  it('sends immediately when nothing defers it', () => {
    expect(
      resolveEmailReleaseAt(
        new Date('2026-08-18T15:30:00.000Z'),
        instantNoQuietHours,
      ),
    ).toBeNull();
  });

  it('holds an instant email until quiet hours close', () => {
    expect(
      resolveEmailReleaseAt(new Date('2026-08-18T15:30:00.000Z'), {
        ...instantNoQuietHours,
        quietHoursEnd: '08:00',
        quietHoursStart: '22:00',
      })?.toISOString(),
    ).toBe('2026-08-19T00:00:00.000Z');
  });

  it('holds a daily-digest email until the next digest hour', () => {
    // 14:00 Taipei → the 09:00 digest hour has passed, so the next one is
    // 09:00 Taipei the following day (01:00Z).
    expect(
      resolveEmailReleaseAt(new Date('2026-08-18T06:00:00.000Z'), {
        ...instantNoQuietHours,
        digestMode: NotificationDigestModeEnum.DAILY,
      })?.toISOString(),
    ).toBe('2026-08-19T01:00:00.000Z');
  });

  it('pushes a digest hour that falls inside quiet hours to the window close', () => {
    expect(
      resolveEmailReleaseAt(new Date('2026-08-18T06:00:00.000Z'), {
        ...instantNoQuietHours,
        digestHour: 7,
        digestMode: NotificationDigestModeEnum.DAILY,
        // 06:00–08:00 Taipei swallows the 07:00 digest hour.
        quietHoursEnd: '08:00',
        quietHoursStart: '06:00',
      })?.toISOString(),
    ).toBe('2026-08-19T00:00:00.000Z');
  });

  it('falls back to a sane digest hour when the host configured nonsense', () => {
    expect(
      resolveEmailReleaseAt(new Date('2026-08-18T06:00:00.000Z'), {
        ...instantNoQuietHours,
        digestHour: 99,
        digestMode: NotificationDigestModeEnum.DAILY,
      })?.toISOString(),
    ).toBe('2026-08-19T01:00:00.000Z');
  });
});
