import {
  buildDraftLaunchModeInput,
  DEFAULT_LAUNCH_MODE,
  LAUNCH_MODE_OPTIONS,
  readLaunchMode,
  readLaunchModeOption,
} from './launch-mode';

describe('launch-mode', () => {
  it('lists OPEN before HOST_ONLY with the labels shown in the designer', (): void => {
    expect(LAUNCH_MODE_OPTIONS.map((option) => option.id)).toEqual([
      'OPEN',
      'HOST_ONLY',
    ]);
    expect(readLaunchModeOption('OPEN').name).toBe('一般發起');
    expect(readLaunchModeOption('HOST_ONLY').name).toBe('僅限系統送件');
  });

  it('reads HOST_ONLY from a loaded version and falls back to OPEN otherwise', (): void => {
    expect(DEFAULT_LAUNCH_MODE).toBe('OPEN');
    expect(readLaunchMode('HOST_ONLY')).toBe('HOST_ONLY');
    expect(readLaunchMode('OPEN')).toBe('OPEN');
    expect(readLaunchMode(null)).toBe('OPEN');
    expect(readLaunchMode(undefined)).toBe('OPEN');
    expect(readLaunchMode('something-else')).toBe('OPEN');
  });

  it('builds a draft input that always carries the selected mode', (): void => {
    expect(buildDraftLaunchModeInput('HOST_ONLY')).toEqual({
      launchMode: 'HOST_ONLY',
    });
    expect(buildDraftLaunchModeInput('OPEN')).toEqual({ launchMode: 'OPEN' });
  });
});
