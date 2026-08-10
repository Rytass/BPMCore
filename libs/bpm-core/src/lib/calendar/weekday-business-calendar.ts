import { BPMBusinessCalendar } from './business-calendar.token';

const SATURDAY = 6;
const SUNDAY = 0;

/**
 * Built-in fallback calendar: Monday through Friday are working days, weekends
 * are not, and no holiday is known.
 *
 * This is what a host gets when it opts a node into `BUSINESS_DAY` without
 * registering a calendar. It is intentionally naive — a host that cares about
 * national holidays or make-up working days must supply its own
 * {@link BPMBusinessCalendar}.
 */
export class BPMWeekdayBusinessCalendar implements BPMBusinessCalendar {
  readonly timeZone: string;

  constructor(timeZone = 'UTC') {
    this.timeZone = timeZone;
  }

  isBusinessDay(localDate: string): boolean {
    // `localDate` is already expressed in this calendar's zone, so reading it
    // back as a UTC instant yields the correct weekday without re-applying an
    // offset.
    const weekday = new Date(`${localDate}T00:00:00.000Z`).getUTCDay();

    return weekday !== SATURDAY && weekday !== SUNDAY;
  }
}
