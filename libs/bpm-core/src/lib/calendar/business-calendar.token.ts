import { InjectionToken } from '@nestjs/common';

/**
 * Host-provided business calendar used to resolve `BUSINESS_DAY` SLA due
 * dates.
 *
 * BPMCore deliberately ships **no** national holiday data. A host that needs
 * real working-day semantics (national holidays, make-up working Saturdays,
 * company shutdown days) implements this contract against its own calendar
 * source and registers it through `BPMRootModule`'s `businessCalendarProvider`.
 *
 * @example
 * ```ts
 * BPMRootModule.forRoot({
 *   businessCalendarProvider: {
 *     provide: BPM_BUSINESS_CALENDAR,
 *     useClass: TaiwanBusinessCalendar,
 *   },
 *   // ...
 * });
 * ```
 */
export interface BPMBusinessCalendar {
  /**
   * IANA time zone the calendar's dates are expressed in, for example
   * `Asia/Taipei`. BPM converts each instant to a local date in this zone
   * before asking {@link BPMBusinessCalendar.isBusinessDay}, so day boundaries
   * follow the host's calendar rather than the server's locale or UTC.
   */
  readonly timeZone: string;

  /**
   * Answers whether `localDate` is a working day.
   *
   * @param localDate Calendar date in `YYYY-MM-DD` form, already expressed in
   * {@link BPMBusinessCalendar.timeZone}.
   */
  isBusinessDay(localDate: string): boolean | Promise<boolean>;
}

export const BPM_BUSINESS_CALENDAR: InjectionToken<BPMBusinessCalendar> =
  Symbol('BPM_BUSINESS_CALENDAR');
