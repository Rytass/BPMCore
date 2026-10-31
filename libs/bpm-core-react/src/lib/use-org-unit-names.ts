'use client';

import { useEffect, useMemo, useState } from 'react';
import { resolveOrgUnitOptions } from '@rytass/bpm-core-client/organization';
import { readOrgUnitFieldOption } from '../views/forms/renderer/org-unit-field-options';

/**
 * Display names for stored organization unit ids (a deleted unit gets
 * 「（已刪除）」 after its name). An id whose lookup has not finished maps to
 * itself; an id the server does not know, or whose lookup failed, is left out
 * of the map so the caller can show 「未知組織」. An id is asked for once.
 */
export function useOrgUnitNames(
  ids: readonly string[],
): ReadonlyMap<string, string> {
  // `null` = settled without a name.
  const [settled, setSettled] = useState<ReadonlyMap<string, string | null>>(
    new Map(),
  );
  const key = ids.join('\n');

  useEffect((): (() => void) => {
    const missingIds = key
      ? [...new Set(key.split('\n'))].filter((id) => !settled.has(id))
      : [];
    let cancelled = false;

    if (missingIds.length === 0) {
      return (): void => undefined;
    }

    void resolveOrgUnitOptions(missingIds)
      .then((records) => records.map(readOrgUnitFieldOption))
      .catch(() => [])
      .then((options): void => {
        if (cancelled) {
          return;
        }

        setSettled(
          (current) =>
            new Map([
              ...current,
              ...missingIds.map(
                (id) =>
                  [
                    id,
                    options.find(
                      (option) => option.id.toLowerCase() === id.toLowerCase(),
                    )?.name ?? null,
                  ] as const,
              ),
            ]),
        );
      });

    return (): void => {
      cancelled = true;
    };
  }, [key, settled]);

  return useMemo(
    (): ReadonlyMap<string, string> =>
      new Map(
        (key ? [...new Set(key.split('\n'))] : []).flatMap(
          (id): readonly (readonly [string, string])[] => {
            const name = settled.get(id);

            if (name === null) {
              return [];
            }

            return [[id, name ?? id]];
          },
        ),
      ),
    [key, settled],
  );
}
