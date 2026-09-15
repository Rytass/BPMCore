/**
 * Helpers shared by the two outboxes BPM runs — notification delivery and
 * NOTIFY webhook delivery — so a claim quirk fixed in one cannot linger in the
 * other.
 */

/**
 * Reads the ids returned by the claiming `UPDATE ... RETURNING id`.
 *
 * TypeORM's Postgres driver returns `[rows, affectedCount]` for `UPDATE` and
 * `DELETE`, and a bare row array for everything else. Reading the two-element
 * form as a row array yields `[undefined, undefined]`, which matches no row —
 * the claim commits, the delivery pass finds nothing, and the row is re-claimed
 * on every stale window forever with `attempt_count` still at 0. Both shapes
 * are accepted here so the claim does not depend on driver-specific packaging.
 */
export function readClaimedIds(rawResult: unknown): readonly string[] {
  const rows =
    Array.isArray(rawResult) && Array.isArray(rawResult[0])
      ? rawResult[0]
      : rawResult;

  if (!Array.isArray(rows)) {
    return [];
  }

  return rows
    .map((row: unknown): unknown =>
      row && typeof row === 'object' && 'id' in row
        ? (row as { readonly id: unknown }).id
        : undefined,
    )
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

/**
 * Fails a dispatch that never settles.
 *
 * Delivery marks a row `DELIVERY_IN_PROGRESS` before dispatching, and only the
 * resolve and reject paths write back. A host dispatcher, member resolver or
 * SMTP call that hangs would therefore leave a permanently claimed row with an
 * empty `delivery_error` — nothing for the host to diagnose. A timeout turns
 * that into an ordinary recorded failure that retries.
 */
export async function withDispatchTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return operation;
  }

  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject): void => {
        timer = setTimeout((): void => {
          reject(new Error(`DELIVERY_TIMEOUT_${timeoutMs}MS`));
        }, timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
