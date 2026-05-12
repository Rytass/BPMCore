'use client';

import { ReactElement, useMemo, useState } from 'react';
import { AutoComplete, Select } from '@mezzanine-ui/react';
import styles from './admin-pickers.module.scss';
import { searchMembers } from '../_lib/member-api';
import {
  OrgUnitRecord,
  PositionRecord,
} from '../_lib/organization-api';

export type MemberOption = Readonly<{
  email: string;
  id: string;
  name: string;
}>;

export type OrgUnitOption = Readonly<{
  id: string;
  name: string;
}>;

export type PositionOption = Readonly<{
  id: string;
  name: string;
}>;

interface MemberPickerProps {
  readonly disabled?: boolean;
  readonly name: string;
  readonly onChange: (option: MemberOption | null) => void;
  readonly placeholder?: string;
  readonly size?: 'main' | 'sub';
  readonly value: MemberOption | null;
}

interface OrgUnitPickerProps {
  readonly disabled?: boolean;
  readonly name: string;
  readonly onChange: (option: OrgUnitOption | null) => void;
  readonly orgUnits: readonly OrgUnitRecord[];
  readonly placeholder?: string;
  readonly size?: 'main' | 'sub';
  readonly value: OrgUnitOption | null;
}

interface PositionPickerProps {
  readonly disabled?: boolean;
  readonly name: string;
  readonly onChange: (option: PositionOption | null) => void;
  readonly placeholder?: string;
  readonly positions: readonly PositionRecord[];
  readonly size?: 'main' | 'sub';
  readonly value: PositionOption | null;
}

export function MemberPicker({
  disabled = false,
  name,
  onChange,
  placeholder = '搜尋姓名、信箱或 member_id',
  size,
  value,
}: MemberPickerProps): ReactElement {
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<readonly MemberOption[]>(
    value ? [value] : [],
  );

  async function handleSearch(searchText: string): Promise<void> {
    setLoading(true);

    try {
      setOptions((await searchMembers(searchText)).map(readMemberOption));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.pickerHost}>
      <AutoComplete
        asyncData
        disabled={disabled}
        disabledOptionsFilter
        emptyText="沒有符合的會員"
        inputProps={{
          autoCapitalize: 'none',
          autoCorrect: 'off',
          name,
          spellCheck: false,
        }}
        loading={loading}
        loadingText="搜尋會員中..."
        mode="single"
        onChange={(option): void => onChange(readMemberOptionFromValue(option))}
        onSearch={handleSearch}
        onSearchTextChange={(searchText): void =>
          onChange(readUniqueOption(searchText, options))
        }
        onVisibilityChange={(open): void => {
          if (open) {
            void handleSearch('');
          }
        }}
        options={[...mergeMemberOptions(value ? [value] : [], options)]}
        placeholder={placeholder}
        searchDebounceTime={300}
        size={size}
        value={value}
      />
    </div>
  );
}

export function OrgUnitPicker({
  disabled = false,
  onChange,
  orgUnits,
  placeholder = '選擇組織',
  size,
  value,
}: OrgUnitPickerProps): ReactElement {
  const options = useMemo(
    (): readonly OrgUnitOption[] => orgUnits.map(readOrgUnitOption),
    [orgUnits],
  );

  return (
    <div className={styles.pickerHost}>
      <Select
        clearable
        disabled={disabled}
        fullWidth
        onChange={(option): void => onChange(readOrgUnitOptionFromValue(option))}
        options={[...options]}
        placeholder={placeholder}
        size={size}
        value={value}
      />
    </div>
  );
}

export function PositionPicker({
  disabled = false,
  onChange,
  placeholder = '選擇職位',
  positions,
  size,
  value,
}: PositionPickerProps): ReactElement {
  const options = useMemo(
    (): readonly PositionOption[] => positions.map(readPositionOption),
    [positions],
  );

  return (
    <div className={styles.pickerHost}>
      <Select
        clearable
        disabled={disabled}
        fullWidth
        onChange={(option): void => onChange(readPositionOptionFromValue(option))}
        options={[...options]}
        placeholder={placeholder}
        size={size}
        value={value}
      />
    </div>
  );
}

export function readMemberOption(member: {
  readonly email: string;
  readonly memberId: string;
  readonly name: string;
}): MemberOption {
  return {
    email: member.email,
    id: member.memberId,
    name: `${member.name} · ${member.email}`,
  };
}

export function readOrgUnitOption(orgUnit: OrgUnitRecord): OrgUnitOption {
  return {
    id: orgUnit.id,
    name: `${orgUnit.name} · ${orgUnit.code}`,
  };
}

export function readPositionOption(position: PositionRecord): PositionOption {
  return {
    id: position.id,
    name: `${position.name} · ${position.code}`,
  };
}

function readMemberOptionFromValue(value: unknown): MemberOption | null {
  if (!isRecord(value)) {
    return null;
  }

  const email = value.email;
  const id = value.id;
  const name = value.name;

  return typeof email === 'string' &&
    typeof id === 'string' &&
    typeof name === 'string'
    ? { email, id, name }
    : null;
}

function readOrgUnitOptionFromValue(value: unknown): OrgUnitOption | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = value.id;
  const name = value.name;

  return typeof id === 'string' && typeof name === 'string'
    ? { id, name }
    : null;
}

function readPositionOptionFromValue(value: unknown): PositionOption | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = value.id;
  const name = value.name;

  return typeof id === 'string' && typeof name === 'string'
    ? { id, name }
    : null;
}

function readUniqueOption(
  searchText: string,
  options: readonly MemberOption[],
): MemberOption | null {
  const normalizedSearchText = searchText.trim().toLocaleLowerCase();

  if (!normalizedSearchText) {
    return null;
  }

  const matched = options.filter(
    (option) =>
      option.id.toLocaleLowerCase() === normalizedSearchText ||
      option.email.toLocaleLowerCase() === normalizedSearchText ||
      option.name.toLocaleLowerCase() === normalizedSearchText,
  );

  return matched.length === 1 ? matched[0] : null;
}

function mergeMemberOptions(
  selectedOptions: readonly MemberOption[],
  options: readonly MemberOption[],
): readonly MemberOption[] {
  const byId = new Map(
    [...selectedOptions, ...options].map(
      (option): readonly [string, MemberOption] => [option.id, option],
    ),
  );

  return [...byId.values()];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
