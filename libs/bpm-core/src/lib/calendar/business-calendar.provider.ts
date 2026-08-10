import { Provider } from '@nestjs/common';
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
 * Treats Monday–Friday as working days in the time zone configured through
 * `notificationSlaBusinessCalendarTimeZone`, and knows about no holidays. Hosts
 * that need national holidays or make-up working days replace this provider via
 * `BPMRootModule`'s `businessCalendarProvider`.
 */
export const defaultBusinessCalendarProvider: Provider<BPMBusinessCalendar> = {
  inject: [BPM_NOTIFICATION_OPTIONS],
  provide: BPM_BUSINESS_CALENDAR,
  useFactory: (
    options: BPMResolvedNotificationOptions,
  ): BPMBusinessCalendar =>
    new BPMWeekdayBusinessCalendar(options.slaBusinessCalendarTimeZone),
};
