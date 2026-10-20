import { createHash } from 'crypto';

// Code-unit order, never `localeCompare`: the order must not depend on the
// host's locale, or two servers would disagree about the same form data.
const compareCodeUnits = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (typeof value === 'object' && value !== null) {
    const record = value as Readonly<Record<string, unknown>>;

    return `{${Object.keys(record)
      .sort(compareCodeUnits)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
};

/**
 * A hash of a JSON value that does not depend on key order. The value is
 * round-tripped through JSON first, so what is hashed is what the database
 * would hand back: `undefined` members vanish and a `Date` becomes its string.
 * A top-level value JSON cannot express (`undefined`) reads as `null`.
 *
 * Deliberately separate from the signature chain's `hashStableJson`: that
 * output is a contract older signatures verify against and must not move.
 */
export const computeStableValueFingerprint = (value: unknown): string =>
  createHash('sha256')
    .update(
      stableStringify(JSON.parse(JSON.stringify(value) ?? 'null') as unknown),
    )
    .digest('hex');

export const computeFormDataFingerprint = (
  formData: Readonly<Record<string, unknown>>,
): string => computeStableValueFingerprint(formData);
