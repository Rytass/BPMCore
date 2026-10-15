const KNOWN_APPROVER_FALLBACK_TYPES: ReadonlySet<string> = new Set([
  'NONE',
  'DIRECT',
]);

/**
 * The fallback's type when this build does not know it (a definition saved by
 * a newer engine), or `null` when it does. The designer keeps such a fallback
 * untouched and only shows it as read-only; it never rewrites it to `NONE`.
 */
export function readUnsupportedApproverFallbackType(fallback: {
  readonly type: string;
}): string | null {
  return KNOWN_APPROVER_FALLBACK_TYPES.has(fallback.type)
    ? null
    : fallback.type;
}
