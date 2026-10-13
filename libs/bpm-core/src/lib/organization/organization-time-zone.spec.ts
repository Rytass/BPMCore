import {
  formatDateOnlyInTimeZone,
  resolveBPMOrganizationTimeZone,
} from './organization-time-zone';

describe('formatDateOnlyInTimeZone', (): void => {
  // 07:30 on 2026-10-14 in Asia/Taipei.
  const instant = new Date('2026-10-13T23:30:00.000Z');

  it('reads the calendar date of the instant in the given zone', (): void => {
    expect(formatDateOnlyInTimeZone(instant, 'Asia/Taipei')).toBe('2026-10-14');
    expect(formatDateOnlyInTimeZone(instant, 'UTC')).toBe('2026-10-13');
  });

  it('follows daylight saving time', (): void => {
    // New York is UTC-4 on 2026-07-01 (EDT) and UTC-5 on 2026-01-01 (EST).
    expect(
      formatDateOnlyInTimeZone(
        new Date('2026-07-01T03:59:00.000Z'),
        'America/New_York',
      ),
    ).toBe('2026-06-30');
    expect(
      formatDateOnlyInTimeZone(
        new Date('2026-07-01T04:00:00.000Z'),
        'America/New_York',
      ),
    ).toBe('2026-07-01');
    expect(
      formatDateOnlyInTimeZone(
        new Date('2026-01-01T04:59:00.000Z'),
        'America/New_York',
      ),
    ).toBe('2025-12-31');
    expect(
      formatDateOnlyInTimeZone(
        new Date('2026-01-01T05:00:00.000Z'),
        'America/New_York',
      ),
    ).toBe('2026-01-01');
  });
});

describe('resolveBPMOrganizationTimeZone', (): void => {
  it('defaults to UTC when the host sets nothing', (): void => {
    expect(resolveBPMOrganizationTimeZone(undefined)).toBe('UTC');
    expect(resolveBPMOrganizationTimeZone(null)).toBe('UTC');
    expect(resolveBPMOrganizationTimeZone('  ')).toBe('UTC');
  });

  it('keeps a valid IANA zone, trimmed', (): void => {
    expect(resolveBPMOrganizationTimeZone(' Asia/Taipei ')).toBe('Asia/Taipei');
  });

  it('throws on a zone Intl does not know, naming the value', (): void => {
    expect(() => resolveBPMOrganizationTimeZone('Mars/Olympus_Mons')).toThrow(
      'BPM option organizationTimeZone must be a valid IANA time zone, received "Mars/Olympus_Mons"',
    );
  });
});
