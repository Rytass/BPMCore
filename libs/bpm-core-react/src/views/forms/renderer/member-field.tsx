'use client';

import { ReactElement, useEffect, useRef, useState } from 'react';
import { AutoComplete } from '@mezzanine-ui/react';
import { resolveMembers, searchMembers } from '@rytass/bpm-core-client';
import type { FormFieldValue } from '@rytass/bpm-core-shared/form';
import {
  excludeFailedMemberIds,
  resolveMemberProfilesPerIdOnFailure,
} from '../../../lib/member-profile-resolution';
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
  // Ids the directory could not name; they stay 「未知會員」 and are not asked
  // for again when the other ids of the value resolve and the key changes.
  // That holds for the rest of the session, a transient failure included,
  // unless a later search returns the member (the merge then replaces the
  // placeholder). Ids skipped over the per-id cap were never asked, so they are
  // not given up on.
  const givenUpIdsRef = useRef<Set<string>>(new Set());
  const unresolvedKey = readUnresolvedMemberIds(value, knownOptions).join('\n');

  useEffect((): (() => void) => {
    const memberIds = excludeFailedMemberIds(
      unresolvedKey ? unresolvedKey.split('\n') : [],
      givenUpIdsRef.current,
    );
    let cancelled = false;

    if (memberIds.length === 0) {
      return (): void => undefined;
    }

    // One id the directory cannot handle fails the whole batch, so a failed
    // batch is retried per id: the other members keep their names.
    void resolveMemberProfilesPerIdOnFailure(memberIds, resolveMembers).then(
      ({ profiles, skippedIds }): void => {
        if (cancelled) {
          return;
        }

        const resolved = profiles.map(readMemberFieldOption);
        // Ids the directory did not return stay visible as placeholders.
        const placeholders = memberIds
          .filter(
            (memberId) => !resolved.some((option) => option.id === memberId),
          )
          .map(readUnresolvedMemberFieldOption);

        // Only the ids that were asked for and still came back without a
        // profile are given up on, so a failed lookup is not retried in a loop.
        // Ids skipped over the per-id cap were never asked: they keep a
        // placeholder but stay eligible for the next round, as the designer
        // does.
        placeholders
          .filter((placeholder) => !skippedIds.includes(placeholder.id))
          .forEach((placeholder) => givenUpIdsRef.current.add(placeholder.id));

        setKnownOptions((current) =>
          mergeMemberFieldOptions(current, [...resolved, ...placeholders]),
        );
      },
    );

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
