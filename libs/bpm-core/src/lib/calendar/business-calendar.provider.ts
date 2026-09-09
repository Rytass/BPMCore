import { Provider } from '@nestjs/common';
import {
  BPM_ROOT_OPTIONS,
  BPMRootRuntimeOptions,
} from '../bpm/bpm-root-options';
import {
  BPM_NOTIFICATION_OPTIONS,
  BPMResolvedNotificationOptions,
} from '../notification/notification-options';
import {
  BPM_BUSINESS_CALENDAR,
  BPMBusinessCalendar,
} from './business-calendar.token';
import { BPMWeekdayBusinessCalendar } from './weekday-business-calendar';

/**
 * Default {@link BPMBusinessCalendar} used when the host registers none.
 *
 * Prefers a calendar handed to `BPMRootModule` as a runtime value
 * (`businessCalendar`, which a `forRootAsync` factory can build once its
 * secrets are in hand) and otherwise treats Monday–Friday as working days in
 * the time zone configured through `notificationSlaBusinessCalendarTimeZone`,
 * knowing about no holidays.
 *
 * `BPM_ROOT_OPTIONS` is injected optionally so `CalendarModule` still resolves
 * when it is used on its own, outside `BPMRootModule`.
 */
export const defaultBusinessCalendarProvider: Provider<BPMBusinessCalendar> = {
  inject: [
    { optional: true, token: BPM_ROOT_OPTIONS },
    BPM_NOTIFICATION_OPTIONS,
  ],
  provide: BPM_BUSINESS_CALENDAR,
  useFactory: (
    rootOptions: BPMRootRuntimeOptions | undefined,
    options: BPMResolvedNotificationOptions,
  ): BPMBusinessCalendar =>
    rootOptions?.businessCalendar ??
    new BPMWeekdayBusinessCalendar(options.slaBusinessCalendarTimeZone),
};
