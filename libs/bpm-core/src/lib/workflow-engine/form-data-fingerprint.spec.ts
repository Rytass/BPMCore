import { createHash } from 'crypto';
import {
  computeFormDataFingerprint,
  computeStableValueFingerprint,
} from './form-data-fingerprint';

describe('form data fingerprint', () => {
  it('does not depend on key order', (): void => {
    expect(computeFormDataFingerprint({ a: 1, b: 2 })).toBe(
      computeFormDataFingerprint({ b: 2, a: 1 }),
    );
  });

  it('differs when a value differs', (): void => {
    expect(computeFormDataFingerprint({ a: 1 })).not.toBe(
      computeFormDataFingerprint({ a: 2 }),
    );
  });

  it('does not depend on key order inside objects nested in arrays', (): void => {
    expect(
      computeFormDataFingerprint({ rows: [{ a: 1, b: { c: 1, d: 2 } }] }),
    ).toBe(computeFormDataFingerprint({ rows: [{ b: { d: 2, c: 1 }, a: 1 }] }));
  });

  it('keeps array order significant', (): void => {
    expect(computeFormDataFingerprint({ rows: [1, 2] })).not.toBe(
      computeFormDataFingerprint({ rows: [2, 1] }),
    );
  });

  it('reads a member set to undefined like a missing member', (): void => {
    expect(computeFormDataFingerprint({ a: undefined })).toBe(
      computeFormDataFingerprint({}),
    );
  });

  it('reads a Date like the string a database round trip would give back', (): void => {
    const date = new Date('2026-05-04T09:00:00.000Z');

    expect(computeFormDataFingerprint({ at: date })).toBe(
      computeFormDataFingerprint({ at: date.toISOString() }),
    );
  });

  it('orders non-ASCII keys by code unit, whatever the locale', (): void => {
    // 稅額 starts at U+7A05, above every ASCII letter and above 'ä' (U+00E4);
    // `localeCompare` would place 'ä' next to 'a' and could reorder differently.
    const keys = ['稅額', 'ä', 'a', 'Z'];
    const forward = Object.fromEntries(keys.map((key) => [key, 1]));
    const backward = Object.fromEntries(
      [...keys].reverse().map((key) => [key, 1]),
    );

    expect(computeFormDataFingerprint(forward)).toBe(
      computeFormDataFingerprint(backward),
    );
    // Pinned to the canonical text itself: a different ordering rule would
    // silently invalidate every fingerprint a client is holding.
    expect(computeFormDataFingerprint(forward)).toBe(
      createHash('sha256').update('{"Z":1,"a":1,"ä":1,"稅額":1}').digest('hex'),
    );
  });

  it('reads a value JSON cannot express as null', (): void => {
    expect(computeStableValueFingerprint(undefined)).toBe(
      computeStableValueFingerprint(null),
    );
  });
});
