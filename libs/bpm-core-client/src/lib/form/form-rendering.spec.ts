import {
  formatDatePickerValue,
  formatDateTimePickerValue,
} from './form-rendering';

// Every expectation below is written for UTC+8, because the off-by-one-day bug
// these tests guard against only appears when the local calendar day differs
// from the UTC one. The zone is pinned in `jest.preset.js`, which the CLI loads
// before forking its workers — setting `process.env.TZ` from a `beforeAll` here
// looks like it works but does nothing, since the worker has already resolved
// its timezone by then.
//
// Assert the zone up front so removing that pin fails with the reason instead
// of an inscrutable one-day-off date mismatch.
describe('timezone assumption', () => {
  it('runs in UTC+8', (): void => {
    expect(new Date('2026-08-20T00:00:00Z').getTimezoneOffset()).toBe(-480);
  });
});

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
