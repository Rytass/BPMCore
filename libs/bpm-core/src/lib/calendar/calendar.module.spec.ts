import { Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  BPM_BUSINESS_CALENDAR,
  BPMBusinessCalendar,
} from './business-calendar.token';
import { CalendarModule } from './calendar.module';
import { BPMSlaScheduleService } from './sla-schedule.service';

/**
 * Stand-in for the repository, config service or HTTP client a realistic host
 * calendar reads its holiday list from — the dependency that made a plain
 * `useClass` provider unresolvable before `CalendarModule` accepted `imports`.
 */
@Injectable()
class HostCalendarRepository {
  isWorkingDay(localDate: string): boolean {
    return localDate !== '2026-01-01';
  }
}

@Module({
  providers: [HostCalendarRepository],
  exports: [HostCalendarRepository],
})
class HostCalendarModule {}

@Injectable()
class HostBusinessCalendar implements BPMBusinessCalendar {
  readonly timeZone = 'Asia/Taipei';

  constructor(private readonly calendarRepository: HostCalendarRepository) {}

  isBusinessDay(localDate: string): boolean {
    return this.calendarRepository.isWorkingDay(localDate);
  }
}

describe('CalendarModule', () => {
  it('resolves a host business calendar that depends on an imported module', async (): Promise<void> => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        CalendarModule.forRoot({
          businessCalendarProvider: {
            provide: BPM_BUSINESS_CALENDAR,
            useClass: HostBusinessCalendar,
          },
          imports: [HostCalendarModule],
        }),
      ],
    }).compile();

    try {
      const calendar = moduleRef.get<BPMBusinessCalendar>(
        BPM_BUSINESS_CALENDAR,
      );

      expect(calendar).toBeInstanceOf(HostBusinessCalendar);
      expect(calendar.isBusinessDay('2026-01-01')).toBe(false);
      expect(calendar.isBusinessDay('2026-01-02')).toBe(true);
    } finally {
      await moduleRef.close();
    }
  });

  it('resolves a useFactory calendar injecting a provider from an imported module', async (): Promise<void> => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        CalendarModule.forRoot({
          businessCalendarProvider: {
            inject: [HostCalendarRepository],
            provide: BPM_BUSINESS_CALENDAR,
            useFactory: (
              calendarRepository: HostCalendarRepository,
            ): BPMBusinessCalendar =>
              new HostBusinessCalendar(calendarRepository),
          },
          imports: [HostCalendarModule],
        }),
      ],
    }).compile();

    try {
      const calendar = moduleRef.get<BPMBusinessCalendar>(
        BPM_BUSINESS_CALENDAR,
      );

      expect(calendar.isBusinessDay('2026-01-01')).toBe(false);
    } finally {
      await moduleRef.close();
    }
  });

  it('exports the SLA schedule service backed by the host calendar', async (): Promise<void> => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        CalendarModule.forRoot({
          businessCalendarProvider: {
            provide: BPM_BUSINESS_CALENDAR,
            useClass: HostBusinessCalendar,
          },
          imports: [HostCalendarModule],
        }),
      ],
    }).compile();

    try {
      expect(moduleRef.get(BPMSlaScheduleService)).toBeInstanceOf(
        BPMSlaScheduleService,
      );
    } finally {
      await moduleRef.close();
    }
  });
});
