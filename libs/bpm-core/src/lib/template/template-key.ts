import { BadRequestException, ConflictException } from '@nestjs/common';

/**
 * Format of `approval_templates.key` (ADR 27 §6). Internal to the template
 * module: deliberately not re-exported from the package index.
 */
export const TEMPLATE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Partial unique index on live rows; see migration 0000000032000. */
export const TEMPLATE_KEY_UNIQUE_INDEX = 'UQ_approval_templates_key_live';

export const TEMPLATE_KEY_CONFLICT_MESSAGE =
  'A live approval template already uses this key';

/**
 * Empty string clears the key, the same as `null`. Anything else must match
 * {@link TEMPLATE_KEY_PATTERN}; a host calling the service directly gets the
 * same 400 the GraphQL input validator gives.
 */
export function normalizeTemplateKey(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (!TEMPLATE_KEY_PATTERN.test(value)) {
    throw new BadRequestException(
      'Template key must start with a letter or digit and contain only letters, digits, ".", "_" or "-" (at most 128 characters)',
    );
  }

  return value;
}

/**
 * True when a driver error is the unique violation raised by the live-key
 * index. TypeORM wraps the Postgres error in `driverError`; both shapes are
 * checked so the translation does not depend on the wrapper.
 */
export function isTemplateKeyUniqueViolation(error: unknown): boolean {
  return [error, readDriverError(error)].some(
    (candidate): boolean =>
      readStringField(candidate, 'code') === '23505' &&
      readStringField(candidate, 'constraint') === TEMPLATE_KEY_UNIQUE_INDEX,
  );
}

/**
 * Maps the live-key unique violation to a 409. Any other error passes through
 * unchanged. Apply it outside the transaction callback, after the transaction
 * has rolled back.
 */
export async function translateTemplateKeyConflict<TResult>(
  operation: Promise<TResult>,
): Promise<TResult> {
  try {
    return await operation;
  } catch (error: unknown) {
    if (isTemplateKeyUniqueViolation(error)) {
      throw new ConflictException(TEMPLATE_KEY_CONFLICT_MESSAGE);
    }

    throw error;
  }
}

function readDriverError(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'driverError' in error
    ? (error as { readonly driverError: unknown }).driverError
    : undefined;
}

function readStringField(source: unknown, field: string): string | undefined {
  if (typeof source !== 'object' || source === null || !(field in source)) {
    return undefined;
  }

  const value = (source as Readonly<Record<string, unknown>>)[field];

  return typeof value === 'string' ? value : undefined;
}
