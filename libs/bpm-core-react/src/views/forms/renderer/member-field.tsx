'use client';

import { ReactElement, useEffect, useRef, useState } from 'react';
import { AutoComplete } from '@mezzanine-ui/react';
import { resolveMembers, searchMembers } from '@rytass/bpm-core-client';
import type { FormFieldValue } from '@rytass/bpm-core-shared/form';
import {
  mergeMemberFieldOptions,
  readMemberFieldOption,
  readMemberFieldValue,
  readSelectedMemberFieldOptions,
  readUnresolvedMemberFieldOption,
  readUnresolvedMemberIds,
  type MemberFieldOption,
} from './member-field-options';

export interface MemberFieldControlProps {
  readonly multiple: boolean;
  readonly name: string;
  readonly onChange: (value: FormFieldValue | undefined) => void;
  readonly placeholder?: string;
  readonly readonly: boolean;
  readonly size?: 'main' | 'sub';
  readonly value: FormFieldValue | undefined;
}

/**
 * 人員選擇 picker. Searching and name lookup reuse the directory queries the
 * admin member picker and the workflow designer already call
 * (`searchMembers` / `resolveMembers`); nothing new is added server side.
 *
 * Stored values are member ids. The names shown here are resolved on mount and
 * whenever a stored id has no profile yet, so a read-only view of a submitted
 * form (instance detail) shows names, not ids.
 */
export function MemberFieldControl({
  multiple,
  name,
  onChange,
  placeholder,
  readonly,
  size,
  value,
}: MemberFieldControlProps): ReactElement {
  const [knownOptions, setKnownOptions] = useState<
    readonly MemberFieldOption[]
  >([]);
  const [searchResults, setSearchResults] = useState<
    readonly MemberFieldOption[]
  >([]);
  const [loading, setLoading] = useState(false);
  const latestSearchRef = useRef(0);
  const unresolvedKey = readUnresolvedMemberIds(value, knownOptions).join('\n');

  useEffect((): (() => void) => {
    const memberIds = unresolvedKey ? unresolvedKey.split('\n') : [];
    let cancelled = false;

    if (memberIds.length === 0) {
      return (): void => undefined;
    }

    void resolveMembers(memberIds)
      .then((members): readonly MemberFieldOption[] =>
        members.map(readMemberFieldOption),
      )
      .catch((): readonly MemberFieldOption[] => [])
      .then((resolved): void => {
        if (cancelled) {
          return;
        }

        // Ids the directory did not return stay visible as placeholders; they
        // count as known for the merge, so a failed lookup is not retried in a
        // loop.
        const placeholders = memberIds
          .filter(
            (memberId) => !resolved.some((option) => option.id === memberId),
          )
          .map(readUnresolvedMemberFieldOption);

        setKnownOptions((current) =>
          mergeMemberFieldOptions(current, [...resolved, ...placeholders]),
        );
      });

    return (): void => {
      cancelled = true;
    };
  }, [unresolvedKey]);

  async function handleSearch(searchText: string): Promise<void> {
    const requestId = latestSearchRef.current + 1;

    latestSearchRef.current = requestId;
    setLoading(true);

    try {
      const options = (await searchMembers(searchText)).map(
        readMemberFieldOption,
      );

      if (latestSearchRef.current === requestId) {
        setSearchResults(options);
        setKnownOptions((current) => mergeMemberFieldOptions(current, options));
      }
    } catch {
      if (latestSearchRef.current === requestId) {
        setSearchResults([]);
      }
    } finally {
      if (latestSearchRef.current === requestId) {
        setLoading(false);
      }
    }
  }

  const selected = readSelectedMemberFieldOptions(value, knownOptions);
  // Selected members stay in the option list so a picked member can be
  // un-ticked from the dropdown, not only through its tag.
  const options = [...mergeMemberFieldOptions(selected, searchResults)];
  const commonProps = {
    asyncData: true,
    clearSearchText: true,
    disabled: readonly,
    disabledOptionsFilter: true,
    emptyText: '沒有符合的成員',
    globalPortal: true,
    inputProps: {
      autoCapitalize: 'none',
      autoCorrect: 'off',
      name,
      spellCheck: false,
    },
    loading,
    loadingText: '搜尋成員中...',
    onSearch: handleSearch,
    onVisibilityChange: (open: boolean): void => {
      if (open) {
        setSearchResults([]);
        void handleSearch('');
      }
    },
    options,
    placeholder: placeholder ?? '搜尋姓名或信箱',
    readOnly: readonly,
    searchDebounceTime: 300,
    size,
  } as const;

  return multiple ? (
    <AutoComplete
      {...commonProps}
      mode="multiple"
      onChange={(nextOptions): void =>
        onChange(readMemberFieldValue(nextOptions, true))
      }
      value={[...selected]}
    />
  ) : (
    <AutoComplete
      {...commonProps}
      mode="single"
      onChange={(nextOption): void =>
        onChange(readMemberFieldValue(nextOption ? [nextOption] : [], false))
      }
      value={selected[0] ?? null}
    />
  );
}
