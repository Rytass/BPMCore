import { DEFAULT_BPM_ORGANIZATION_TIME_ZONE } from '@rytass/bpm-core-shared';
import { resolveOrganizationTimeZone } from './organization-time-zone';

describe('resolveOrganizationTimeZone', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach((): void => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation((): void => {
      // Silenced: the warning is asserted, not printed.
    });
  });

  afterEach((): void => {
    warnSpy.mockRestore();
  });

  it('keeps a valid zone, trimmed', (): void => {
    expect(resolveOrganizationTimeZone(' America/New_York ')).toBe(
      'America/New_York',
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('answers the shared default for a missing or blank zone without warning', (): void => {
    expect(DEFAULT_BPM_ORGANIZATION_TIME_ZONE).toBe('Asia/Taipei');
    expect(resolveOrganizationTimeZone(undefined)).toBe('Asia/Taipei');
    expect(resolveOrganizationTimeZone(null)).toBe('Asia/Taipei');
    expect(resolveOrganizationTimeZone('   ')).toBe('Asia/Taipei');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('falls back to the default on an unknown zone and warns once per value', (): void => {
    expect(resolveOrganizationTimeZone('Mars/Olympus_Mons')).toBe(
      'Asia/Taipei',
    );
    expect(resolveOrganizationTimeZone('Mars/Olympus_Mons')).toBe(
      'Asia/Taipei',
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain('Mars/Olympus_Mons');

    expect(resolveOrganizationTimeZone('Not/A_Zone')).toBe('Asia/Taipei');
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });
});
