import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import { BPMBusinessCalendar } from './business-calendar.token';
import { defaultBusinessCalendarProvider } from './business-calendar.provider';
import { BPMSlaScheduleService } from './sla-schedule.service';

export interface CalendarModuleOptions {
  /**
   * Host-provided business calendar. When omitted, BPM falls back to a
   * Monday–Friday calendar with no holiday knowledge.
   */
  readonly businessCalendarProvider?: Provider<BPMBusinessCalendar>;
}

/**
 * Supplies SLA scheduling to every BPM module.
 *
 * Global because the workflow engine computes due dates while creating tasks
 * and hosts should not have to thread the calendar through each feature module.
 */
@Global()
@Module({})
export class CalendarModule {
  static forRoot(options: CalendarModuleOptions = {}): DynamicModule {
    return {
      exports: [BPMSlaScheduleService],
      module: CalendarModule,
      providers: [
        options.businessCalendarProvider ?? defaultBusinessCalendarProvider,
        BPMSlaScheduleService,
      ],
    };
  }
}
