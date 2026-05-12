export function parseMetadataJson(
  value: string | null | undefined,
): Readonly<Record<string, unknown>> {
  if (!value) {
    return {};
  }

  const parsed: unknown = JSON.parse(value);

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('metadataJson must be a JSON object');
  }

  return parsed as Readonly<Record<string, unknown>>;
}
