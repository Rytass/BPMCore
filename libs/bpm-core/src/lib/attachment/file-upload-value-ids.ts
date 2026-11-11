/**
 * The attachment ids a `file_upload` value names: each non-empty string of an
 * array, or a single non-empty string. The attachment binding and the
 * `maxFiles` count both read a value through this, so they agree on what the
 * value holds. Repeats are kept; each reader collapses them the way it needs.
 * Not re-exported from the package index.
 */
export function readFileUploadValueIds(value: unknown): readonly string[] {
  const entries: readonly unknown[] = Array.isArray(value) ? value : [value];

  return entries.filter(
    (entry): entry is string => typeof entry === 'string' && entry !== '',
  );
}
