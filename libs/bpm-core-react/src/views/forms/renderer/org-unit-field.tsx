'use client';

import { ReactElement, useEffect, useRef, useState } from 'react';
import { AutoComplete, Typography } from '@mezzanine-ui/react';
import {
  resolveOrgUnitOptions,
  searchOrgUnitOptions,
} from '@rytass/bpm-core-client/organization';
import type { FormFieldValue } from '@rytass/bpm-core-shared/form';
import {
  mergeOrgUnitFieldOptions,
  readOrgUnitFieldOption,
  readOrgUnitFieldValue,
  readSelectedOrgUnitFieldOption,
  readUnknownOrgUnitFieldOption,
  readUnresolvedOrgUnitId,
  type OrgUnitFieldOption,
} from './org-unit-field-options';

export interface OrgUnitFieldControlProps {
  readonly name: string;
  readonly onChange: (value: FormFieldValue | undefined) => void;
  readonly placeholder?: string;
  readonly readonly: boolean;
  readonly size?: 'main' | 'sub';
  readonly value: FormFieldValue | undefined;
}

export const ORG_UNIT_SEARCH_FAILED_TEXT = '搜尋組織失敗，請稍後再試。';

/**
 * 組織選擇 picker. The stored value is one organization unit id. Searching and
 * name lookup use the picker queries open to any signed-in member
 * (`searchOrgUnitOptions` / `resolveOrgUnitOptions`), not the designer-only
 * organization directory.
 *
 * A stored id shows as itself until its name comes back, then as the name
 * (「（已刪除）」 after it for a retired unit). An id the server cannot name
 * — unknown, or the lookup failed — shows as 「未知組織」 and is not asked for
 * again unless a later search returns the unit.
 */
export function OrgUnitFieldControl({
  name,
  onChange,
  placeholder,
  readonly,
  size,
  value,
}: OrgUnitFieldControlProps): ReactElement {
  const [knownOptions, setKnownOptions] = useState<
    readonly OrgUnitFieldOption[]
  >([]);
  const [searchResults, setSearchResults] = useState<
    readonly OrgUnitFieldOption[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const latestSearchRef = useRef(0);
  const unresolvedId = readUnresolvedOrgUnitId(value, knownOptions);

  useEffect((): (() => void) => {
    let cancelled = false;

    if (unresolvedId === null) {
      return (): void => undefined;
    }

    void resolveOrgUnitOptions([unresolvedId])
      .then((records): readonly OrgUnitFieldOption[] => {
        const resolved = records.map(readOrgUnitFieldOption);

        // The id came back without a unit: it stays 「未知組織」 and is not
        // asked for again.
        return resolved.some(
          (option) => option.id.toLowerCase() === unresolvedId.toLowerCase(),
        )
          ? resolved
          : [...resolved, readUnknownOrgUnitFieldOption(unresolvedId)];
      })
      .catch((): readonly OrgUnitFieldOption[] => [
        readUnknownOrgUnitFieldOption(unresolvedId),
      ])
      .then((options): void => {
        if (!cancelled) {
          setKnownOptions((current) =>
            mergeOrgUnitFieldOptions(current, options),
          );
        }
      });

    return (): void => {
      cancelled = true;
    };
  }, [unresolvedId]);

  async function handleSearch(searchText: string): Promise<void> {
    const requestId = latestSearchRef.current + 1;

    latestSearchRef.current = requestId;
    setLoading(true);

    try {
      const options = (await searchOrgUnitOptions(searchText)).map(
        readOrgUnitFieldOption,
      );

      if (latestSearchRef.current === requestId) {
        setSearchResults(options);
        setSearchFailed(false);
        setKnownOptions((current) =>
          mergeOrgUnitFieldOptions(current, options),
        );
      }
    } catch {
      // The picked unit is untouched: only the list of hits is emptied.
      if (latestSearchRef.current === requestId) {
        setSearchResults([]);
        setSearchFailed(true);
      }
    } finally {
      if (latestSearchRef.current === requestId) {
        setLoading(false);
      }
    }
  }

  const selected = readSelectedOrgUnitFieldOption(value, knownOptions);
  // The picked unit stays in the option list so it can be un-ticked from the
  // dropdown, not only through its tag.
  const options = [
    ...mergeOrgUnitFieldOptions(selected ? [selected] : [], searchResults),
  ];

  return (
    <div>
      <AutoComplete
        asyncData
        clearSearchText
        disabled={readonly}
        disabledOptionsFilter
        emptyText="沒有符合的組織"
        globalPortal
        inputProps={{
          autoCapitalize: 'none',
          autoCorrect: 'off',
          name,
          spellCheck: false,
        }}
        loading={loading}
        loadingText="搜尋組織中..."
        mode="single"
        onChange={(nextOption): void =>
          onChange(readOrgUnitFieldValue(nextOption ?? null))
        }
        onSearch={handleSearch}
        onVisibilityChange={(open: boolean): void => {
          if (open) {
            setSearchResults([]);
            void handleSearch('');
          }
        }}
        options={options}
        placeholder={placeholder ?? '搜尋組織名稱'}
        readOnly={readonly}
        searchDebounceTime={300}
        size={size}
        value={selected}
      />
      {searchFailed ? (
        <Typography color="text-error" variant="caption">
          {ORG_UNIT_SEARCH_FAILED_TEXT}
        </Typography>
      ) : null}
    </div>
  );
}
