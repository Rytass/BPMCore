import {
  formatDatePickerValue,
  formatDateTimePickerValue,
} from './form-rendering';

// The bug this file guards against only shows up east of UTC, so the suite
// needs a non-UTC zone pinned. That pin lives in jest.global-setup.ts (wired
// via globalSetup in jest.config.cts) rather than here: Jest sandboxes
// `process.env` inside the test environment, so assigning `process.env.TZ`
// in a beforeAll here would silently no-op instead of changing the timezone
// dates/`Intl` actually resolve against.
describe('formatDatePickerValue', () => {
  it('keeps the local calendar day for UTC values', (): void => {
    // 2026-08-19T16:00:00Z is 2026-08-20 00:00 in Asia/Taipei, which is what
    // the calendar adapter emits when the user picks the 20th.
    expect(formatDatePickerValue('2026-08-19T16:00:00.000Z')).toBe(
      '2026-08-20',
    );
  });

  it('keeps the local calendar day for offset-qualified values', (): void => {
    expect(formatDatePickerValue('2026-08-20T00:00:00+08:00')).toBe(
      '2026-08-20',
    );
    expect(formatDatePickerValue('2026-08-19T12:00:00-05:00')).toBe(
      '2026-08-20',
    );
  });

  it('treats zone-less values as local time', (): void => {
    expect(formatDatePickerValue('2026-08-20')).toBe('2026-08-20');
    expect(formatDatePickerValue('2026-08-20T09:30')).toBe('2026-08-20');
  });

  it('returns undefined for empty or unparsable values', (): void => {
    expect(formatDatePickerValue(undefined)).toBeUndefined();
    expect(formatDatePickerValue('')).toBeUndefined();
    expect(formatDatePickerValue('not-a-date')).toBeUndefined();
  });
});

describe('formatDateTimePickerValue', () => {
  it('preserves the instant for UTC values', (): void => {
    expect(formatDateTimePickerValue('2026-08-19T16:00:00.000Z')).toBe(
      '2026-08-19T16:00:00.000Z',
    );
  });

  it('preserves the instant for offset-qualified values', (): void => {
    expect(formatDateTimePickerValue('2026-08-20T00:00:00+08:00')).toBe(
      '2026-08-19T16:00:00.000Z',
    );
  });

  it('treats zone-less values as local time', (): void => {
    expect(formatDateTimePickerValue('2026-08-20T00:00')).toBe(
      '2026-08-19T16:00:00.000Z',
    );
  });

  it('returns undefined for empty or unparsable values', (): void => {
    expect(formatDateTimePickerValue(undefined)).toBeUndefined();
    expect(formatDateTimePickerValue('not-a-date')).toBeUndefined();
  });
});
