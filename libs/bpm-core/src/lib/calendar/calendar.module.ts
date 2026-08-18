import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import { ModuleMetadata } from '@nestjs/common/interfaces';
import { BPMBusinessCalendar } from './business-calendar.token';
import { defaultBusinessCalendarProvider } from './business-calendar.provider';
import { BPMSlaScheduleService } from './sla-schedule.service';

export interface CalendarModuleOptions extends Pick<ModuleMetadata, 'imports'> {
  /**
   * Host-provided business calendar. When omitted, BPM falls back to a
   * Monday–Friday calendar with no holiday knowledge.
   *
   * A `useClass` or `useFactory` provider may depend on host services, so the
   * modules exporting them have to be listed in `imports`.
   *
   * **The calendar is constructed inside BPM, so its dependency chain must
   * not lead back into BPM.** `BPMRootModule` passes its own `imports` down
   * to this module, which makes it easy to reach a host service that depends
   * on `TemplateService` (or any other BPM provider) without noticing. Nest
   * cannot resolve the resulting cycle and does not report one: the process
   * never finishes bootstrapping, `listen()` is never reached, nothing is
   * thrown for `bootstrap().catch()` to see, and the process exits with code
   * `0`. Diagnosing it means dumping unsettled promises at `beforeExit` and
   * recognising `@nestjs/core/helpers/barrier.js` in the stacks.
   *
   * Keep the calendar's dependencies to host-owned, BPM-free services.
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
      imports: options.imports ? [...options.imports] : [],
      module: CalendarModule,
      providers: [
        options.businessCalendarProvider ?? defaultBusinessCalendarProvider,
        BPMSlaScheduleService,
      ],
    };
  }
}
