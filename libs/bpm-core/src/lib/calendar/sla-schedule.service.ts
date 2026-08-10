import { Inject, Injectable, Logger } from '@nestjs/common';
import { UserTaskNode } from '@rytass/bpm-core-shared/workflow';
import {
  MS_PER_DAY,
  parseIsoDurationParts,
} from '../common/iso-duration';
import {
  BPM_BUSINESS_CALENDAR,
  BPMBusinessCalendar,
} from './business-calendar.token';

/**
 * Upper bound on how far the business-day search may walk before giving up.
 *
 * A host calendar that reports every date as a non-business day would
 * otherwise loop forever (and, when the calendar is database-backed, issue one
 * query per step). The allowance is generous enough for weekends plus a long
 * holiday season, and capped so a misconfigured calendar degrades quickly.
 */
const MAX_BUSINESS_DAY_SCAN_STEPS = 400;

function readBusinessDayScanLimit(days: number): number {
  return Math.min(days * 7 + 60, MAX_BUSINESS_DAY_SCAN_STEPS);
}

/**
 * Resolves task SLA due dates, honouring {@link SlaConfig.calendar}.
 *
 * `CALENDAR` (the default) adds the ISO duration as elapsed wall time —
 * identical to BPM's pre-0.7.0 behaviour. `BUSINESS_DAY` advances the duration's
 * day component across business days only, asking the host-provided
 * {@link BPMBusinessCalendar} about each candidate date; any sub-day component
 * is then added as plain elapsed time on top of the resolved business day.
 */
@Injectable()
export class BPMSlaScheduleService {
  private readonly logger = new Logger(BPMSlaScheduleService.name);
  private readonly dateFormatter: Intl.DateTimeFormat;

  constructor(
    @Inject(BPM_BUSINESS_CALENDAR)
    private readonly businessCalendar: BPMBusinessCalendar,
  ) {
    this.dateFormatter = new Intl.DateTimeFormat('en-CA', {
      day: '2-digit',
      month: '2-digit',
      timeZone: businessCalendar.timeZone,
      year: 'numeric',
    });
  }

  async resolveTaskSlaDueAt({
    node,
    now,
  }: {
    readonly node: UserTaskNode;
    readonly now: Date;
  }): Promise<Date | null> {
    const sla = node.data.sla;

    if (!sla?.duration) {
      return null;
    }

    const parts = parseIsoDurationParts(sla.duration);

    if (!parts) {
      return null;
    }

    if (sla.calendar !== 'BUSINESS_DAY' || parts.days === 0) {
      return new Date(now.getTime() + parts.days * MS_PER_DAY + parts.timeMs);
    }

    const advancedDays = await this.countCalendarDaysForBusinessDays(
      now,
      parts.days,
      node.id,
    );

    return new Date(now.getTime() + advancedDays * MS_PER_DAY + parts.timeMs);
  }

  /**
   * Walks forward one calendar day at a time from `now`, consuming one unit of
   * `businessDays` for each date the host calendar reports as a working day,
   * and returns how many calendar days were stepped.
   *
   * The starting date is never counted: an SLA of "1 business day" always lands
   * on the *next* working day, whether the task was raised on a Monday or on a
   * Saturday.
   */
  private async countCalendarDaysForBusinessDays(
    now: Date,
    businessDays: number,
    nodeId: string,
  ): Promise<number> {
    const scanLimit = readBusinessDayScanLimit(businessDays);
    let remainingBusinessDays = businessDays;
    let steps = 0;

    while (remainingBusinessDays > 0 && steps < scanLimit) {
      steps += 1;

      const candidate = new Date(now.getTime() + steps * MS_PER_DAY);

      if (await this.businessCalendar.isBusinessDay(this.readLocalDate(candidate))) {
        remainingBusinessDays -= 1;
      }
    }

    if (remainingBusinessDays > 0) {
      this.logger.warn(
        `Business calendar reported no working day within ${scanLimit} days for node ${nodeId}; falling back to calendar time.`,
      );

      return businessDays;
    }

    return steps;
  }

  /** Formats an instant as a `YYYY-MM-DD` date in the calendar's time zone. */
  private readLocalDate(value: Date): string {
    // `en-CA` renders ISO-ordered dates, so no part reassembly is needed.
    return this.dateFormatter.format(value);
  }
}
