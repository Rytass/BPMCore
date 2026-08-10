import { Injectable } from '@nestjs/common';
import type { BPMBusinessCalendar } from '@rytass/bpm-core-nestjs-module';

/**
 * Reference `BPMBusinessCalendar` for the wrapper app.
 *
 * BPMCore ships no national holiday data on purpose — this lives in the host,
 * exactly where a real deployment would put it. A production host would read
 * these dates from its own calendar table (Argus keeps them in a code table
 * maintained by system administrators) instead of hard-coding them; this
 * version only needs to be good enough to demo and to exercise the e2e flows.
 *
 * Both directions matter for Taiwan: a public holiday makes a weekday
 * non-working, and a make-up working day (補班日) makes a Saturday working.
 */
const TAIWAN_HOLIDAYS: ReadonlySet<string> = new Set([
  '2026-01-01',
  '2026-02-16',
  '2026-02-17',
  '2026-02-18',
  '2026-02-19',
  '2026-02-20',
  '2026-04-03',
  '2026-04-06',
  '2026-05-01',
  '2026-06-19',
  '2026-09-25',
  '2026-10-09',
  '2026-10-26',
]);

const TAIWAN_MAKE_UP_WORKDAYS: ReadonlySet<string> = new Set(['2026-02-14']);

const SATURDAY = 6;
const SUNDAY = 0;

@Injectable()
export class ApiTaiwanBusinessCalendar implements BPMBusinessCalendar {
  readonly timeZone = 'Asia/Taipei';

  isBusinessDay(localDate: string): boolean {
    if (TAIWAN_MAKE_UP_WORKDAYS.has(localDate)) {
      return true;
    }

    if (TAIWAN_HOLIDAYS.has(localDate)) {
      return false;
    }

    const weekday = new Date(`${localDate}T00:00:00.000Z`).getUTCDay();

    return weekday !== SATURDAY && weekday !== SUNDAY;
  }
}
