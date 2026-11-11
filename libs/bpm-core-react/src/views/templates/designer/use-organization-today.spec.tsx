import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { MembershipRecord } from '@rytass/bpm-core-client/organization';
import { BPMOrganizationTimeZoneProvider } from '../../../lib/organization-time-zone-provider';
import {
  readActivePositionIds,
  useOrganizationTodayDateOnlyString,
} from './position-scope';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

// 03:00 UTC on 11-12: 11:00 on 11-12 in Taipei, 22:00 on 11-11 in New York.
const NOW = new Date('2026-11-12T03:00:00Z');

let latestToday = '';

function Probe(): ReactElement {
  latestToday = useOrganizationTodayDateOnlyString();

  return <div />;
}

async function readToday(timeZone?: string | null): Promise<string> {
  const container = document.createElement('div');
  const root = createRoot(container);

  await act(async (): Promise<void> => {
    root.render(
      timeZone === null ? (
        <Probe />
      ) : (
        <BPMOrganizationTimeZoneProvider timeZone={timeZone}>
          <Probe />
        </BPMOrganizationTimeZoneProvider>
      ),
    );
  });
  await act(async (): Promise<void> => {
    root.unmount();
  });

  return latestToday;
}

describe('useOrganizationTodayDateOnlyString', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach((): void => {
    latestToday = '';
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation((): void => {
      // Silenced: the warning is asserted, not printed.
    });
  });

  afterEach((): void => {
    jest.useRealTimers();
    warnSpy.mockRestore();
  });

  it('reads today in the host organization zone', async (): Promise<void> => {
    expect(await readToday('America/New_York')).toBe('2026-11-11');
    expect(await readToday('Asia/Taipei')).toBe('2026-11-12');
  });

  it('decides which positions are active on the host zone day', async (): Promise<void> => {
    const startsInTaipeiToday = [
      {
        effectiveFrom: '2026-11-12',
        effectiveTo: null,
        isPrimary: false,
        memberId: 'member_a',
        orgUnitId: 'org_hq',
        positionId: 'pos_starts_today',
      } as MembershipRecord,
    ];

    expect([
      ...readActivePositionIds(
        startsInTaipeiToday,
        await readToday('America/New_York'),
      ),
    ]).toEqual([]);
    expect([
      ...readActivePositionIds(
        startsInTaipeiToday,
        await readToday('Asia/Taipei'),
      ),
    ]).toEqual(['pos_starts_today']);
  });

  it('uses the default zone without a provider or without a value', async (): Promise<void> => {
    expect(await readToday(null)).toBe('2026-11-12');
    expect(await readToday(undefined)).toBe('2026-11-12');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('falls back to the default zone on an unknown zone, with a warning', async (): Promise<void> => {
    expect(await readToday('Invalid/Designer_Zone')).toBe('2026-11-12');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
