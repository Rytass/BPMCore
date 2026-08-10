import { UserTaskNode } from '@rytass/bpm-core-shared/workflow';
import { BPMBusinessCalendar } from './business-calendar.token';
import { BPMSlaScheduleService } from './sla-schedule.service';
import { BPMWeekdayBusinessCalendar } from './weekday-business-calendar';

/**
 * Stand-in for a host calendar such as Argus'. Weekends are non-working unless
 * listed as a make-up working day, and listed holidays are non-working even on
 * a weekday — exactly the two cases BPM cannot infer on its own.
 */
class TaiwanTestCalendar implements BPMBusinessCalendar {
  readonly timeZone = 'Asia/Taipei';

  constructor(
    private readonly holidays: ReadonlySet<string> = new Set(),
    private readonly makeUpWorkdays: ReadonlySet<string> = new Set(),
  ) {}

  isBusinessDay(localDate: string): boolean {
    if (this.makeUpWorkdays.has(localDate)) {
      return true;
    }

    if (this.holidays.has(localDate)) {
      return false;
    }

    const weekday = new Date(`${localDate}T00:00:00.000Z`).getUTCDay();

    return weekday !== 0 && weekday !== 6;
  }
}

function createUserTaskNode(
  sla: UserTaskNode['data']['sla'],
  id = 'userTask_1',
): UserTaskNode {
  return {
    data: {
      allowAddSigner: false,
      allowReject: true,
      allowTransfer: true,
      approverResolver: { memberIds: ['member-001'], type: 'DIRECT' },
      decisionPolicy: { type: 'SINGLE' },
      label: '主管簽核',
      returnBehavior: { allowReturn: true, allowedTargets: 'INITIATOR' },
      ...(sla ? { sla } : {}),
    },
    id,
    position: { x: 0, y: 0 },
    type: 'userTask',
  };
}

function createService(calendar: BPMBusinessCalendar): BPMSlaScheduleService {
  return new BPMSlaScheduleService(calendar);
}

describe('BPMSlaScheduleService', () => {
  it('returns null when the node has no SLA', async (): Promise<void> => {
    const service = createService(new BPMWeekdayBusinessCalendar());

    await expect(
      service.resolveTaskSlaDueAt({
        node: createUserTaskNode(undefined),
        now: new Date('2026-08-07T09:00:00.000Z'),
      }),
    ).resolves.toBeNull();
  });

  it('returns null for a duration it cannot parse', async (): Promise<void> => {
    const service = createService(new BPMWeekdayBusinessCalendar());

    await expect(
      service.resolveTaskSlaDueAt({
        node: createUserTaskNode({ duration: '2 days', onTimeout: 'REMIND' }),
        now: new Date('2026-08-07T09:00:00.000Z'),
      }),
    ).resolves.toBeNull();
  });

  it('adds elapsed time when the SLA has no calendar mode', async (): Promise<void> => {
    const service = createService(new TaiwanTestCalendar());

    // 2026-08-07 is a Friday: plain calendar time lands on the Sunday.
    await expect(
      service.resolveTaskSlaDueAt({
        node: createUserTaskNode({ duration: 'P2D', onTimeout: 'REMIND' }),
        now: new Date('2026-08-07T09:00:00.000Z'),
      }),
    ).resolves.toEqual(new Date('2026-08-09T09:00:00.000Z'));
  });

  it('keeps CALENDAR mode identical to the pre-0.7.0 behaviour', async (): Promise<void> => {
    const service = createService(new TaiwanTestCalendar());

    await expect(
      service.resolveTaskSlaDueAt({
        node: createUserTaskNode({
          calendar: 'CALENDAR',
          duration: 'P2D',
          onTimeout: 'REMIND',
        }),
        now: new Date('2026-08-07T09:00:00.000Z'),
      }),
    ).resolves.toEqual(new Date('2026-08-09T09:00:00.000Z'));
  });

  it('skips weekends in BUSINESS_DAY mode', async (): Promise<void> => {
    const service = createService(new TaiwanTestCalendar());

    // Friday 17:00 Taipei + 2 business days → Tuesday 17:00 Taipei.
    await expect(
      service.resolveTaskSlaDueAt({
        node: createUserTaskNode({
          calendar: 'BUSINESS_DAY',
          duration: 'P2D',
          onTimeout: 'REMIND',
        }),
        now: new Date('2026-08-07T09:00:00.000Z'),
      }),
    ).resolves.toEqual(new Date('2026-08-11T09:00:00.000Z'));
  });

  it('skips host-declared holidays in BUSINESS_DAY mode', async (): Promise<void> => {
    const service = createService(
      new TaiwanTestCalendar(new Set(['2026-09-28'])),
    );

    // Friday 2026-09-25 + 2 business days, with Monday 09-28 a holiday:
    // 09-26 Sat, 09-27 Sun and 09-28 are skipped → 09-29 Tue, 09-30 Wed.
    await expect(
      service.resolveTaskSlaDueAt({
        node: createUserTaskNode({
          calendar: 'BUSINESS_DAY',
          duration: 'P2D',
          onTimeout: 'REMIND',
        }),
        now: new Date('2026-09-25T09:00:00.000Z'),
      }),
    ).resolves.toEqual(new Date('2026-09-30T09:00:00.000Z'));
  });

  it('counts a make-up working Saturday as a business day', async (): Promise<void> => {
    const service = createService(
      new TaiwanTestCalendar(new Set(['2026-09-28']), new Set(['2026-09-26'])),
    );

    // 09-26 Sat now counts as the first business day, 09-27 Sun and the 09-28
    // holiday are skipped, so the second lands on 09-29 Tue.
    await expect(
      service.resolveTaskSlaDueAt({
        node: createUserTaskNode({
          calendar: 'BUSINESS_DAY',
          duration: 'P2D',
          onTimeout: 'REMIND',
        }),
        now: new Date('2026-09-25T09:00:00.000Z'),
      }),
    ).resolves.toEqual(new Date('2026-09-29T09:00:00.000Z'));
  });

  it('never counts the starting day, even when raised on a weekend', async (): Promise<void> => {
    const service = createService(new TaiwanTestCalendar());

    // Saturday 2026-08-08 + 1 business day → Monday 2026-08-10.
    await expect(
      service.resolveTaskSlaDueAt({
        node: createUserTaskNode({
          calendar: 'BUSINESS_DAY',
          duration: 'P1D',
          onTimeout: 'REMIND',
        }),
        now: new Date('2026-08-08T02:00:00.000Z'),
      }),
    ).resolves.toEqual(new Date('2026-08-10T02:00:00.000Z'));
  });

  it('adds an hour component as plain elapsed time on top of the business day', async (): Promise<void> => {
    const service = createService(new TaiwanTestCalendar());

    // P1DT4H on a Friday: one business day lands on Monday, then +4h.
    await expect(
      service.resolveTaskSlaDueAt({
        node: createUserTaskNode({
          calendar: 'BUSINESS_DAY',
          duration: 'P1DT4H',
          onTimeout: 'REMIND',
        }),
        now: new Date('2026-08-07T09:00:00.000Z'),
      }),
    ).resolves.toEqual(new Date('2026-08-10T13:00:00.000Z'));
  });

  it('treats an hour-only BUSINESS_DAY duration as calendar time', async (): Promise<void> => {
    const service = createService(new TaiwanTestCalendar());

    await expect(
      service.resolveTaskSlaDueAt({
        node: createUserTaskNode({
          calendar: 'BUSINESS_DAY',
          duration: 'PT4H',
          onTimeout: 'REMIND',
        }),
        now: new Date('2026-08-07T09:00:00.000Z'),
      }),
    ).resolves.toEqual(new Date('2026-08-07T13:00:00.000Z'));
  });

  it('resolves business days against the calendar time zone, not UTC', async (): Promise<void> => {
    const calendar = new TaiwanTestCalendar();
    const isBusinessDay = jest.spyOn(calendar, 'isBusinessDay');
    const service = createService(calendar);

    // 2026-08-07T17:00Z is already Saturday 2026-08-08 in Taipei (UTC+8), so
    // the first candidate date the calendar sees must be the Sunday.
    await service.resolveTaskSlaDueAt({
      node: createUserTaskNode({
        calendar: 'BUSINESS_DAY',
        duration: 'P1D',
        onTimeout: 'REMIND',
      }),
      now: new Date('2026-08-07T17:00:00.000Z'),
    });

    expect(isBusinessDay.mock.calls.map(([date]) => date)).toEqual([
      '2026-08-09',
      '2026-08-10',
    ]);
  });

  it('falls back to calendar time when the host calendar reports no working day', async (): Promise<void> => {
    const neverWorking: BPMBusinessCalendar = {
      isBusinessDay: (): boolean => false,
      timeZone: 'Asia/Taipei',
    };
    const service = createService(neverWorking);

    await expect(
      service.resolveTaskSlaDueAt({
        node: createUserTaskNode({
          calendar: 'BUSINESS_DAY',
          duration: 'P2D',
          onTimeout: 'REMIND',
        }),
        now: new Date('2026-08-07T09:00:00.000Z'),
      }),
    ).resolves.toEqual(new Date('2026-08-09T09:00:00.000Z'));
  });

  it('awaits an async host calendar', async (): Promise<void> => {
    const asyncCalendar: BPMBusinessCalendar = {
      isBusinessDay: (localDate: string): Promise<boolean> =>
        Promise.resolve(localDate !== '2026-08-11'),
      timeZone: 'UTC',
    };
    const service = createService(asyncCalendar);

    await expect(
      service.resolveTaskSlaDueAt({
        node: createUserTaskNode({
          calendar: 'BUSINESS_DAY',
          duration: 'P2D',
          onTimeout: 'REMIND',
        }),
        now: new Date('2026-08-09T09:00:00.000Z'),
      }),
    ).resolves.toEqual(new Date('2026-08-12T09:00:00.000Z'));
  });
});

describe('BPMWeekdayBusinessCalendar', () => {
  it('treats Monday to Friday as working days', (): void => {
    const calendar = new BPMWeekdayBusinessCalendar();

    expect(calendar.isBusinessDay('2026-08-07')).toBe(true);
    expect(calendar.isBusinessDay('2026-08-08')).toBe(false);
    expect(calendar.isBusinessDay('2026-08-09')).toBe(false);
    expect(calendar.isBusinessDay('2026-08-10')).toBe(true);
  });

  it('defaults to UTC and accepts an explicit zone', (): void => {
    expect(new BPMWeekdayBusinessCalendar().timeZone).toBe('UTC');
    expect(new BPMWeekdayBusinessCalendar('Asia/Taipei').timeZone).toBe(
      'Asia/Taipei',
    );
  });
});
