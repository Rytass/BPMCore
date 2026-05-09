'use client';

import { ChangeEvent, ReactElement, useEffect, useMemo, useState } from 'react';
import {
  AutoComplete,
  Button,
  FormField,
  Input,
  Layout,
  Modal,
  PageHeader,
  Section,
  SectionGroup,
  Select,
  Table,
  Textarea,
  Typography,
} from '@mezzanine-ui/react';
import ContentHeader from '@mezzanine-ui/react/ContentHeader';
import { PlusIcon } from '@mezzanine-ui/icons';
import type { TableActions, TableColumn } from '@mezzanine-ui/core/table';
import { FormFieldDensity, FormFieldLayout } from '@mezzanine-ui/core/form';
import { formatDateTime } from '../../_lib/date-time';
import { renderAppNavigation } from '../../app-navigation';
import {
  CURRENT_MEMBER_ID,
  DelegationRuleRecord,
  DelegationScopeType,
  MemberProfileRecord,
  createDelegationRule,
  listDelegationRules,
  revokeDelegationRule,
  searchMembers,
} from '../../instances/_lib/workflow-api';

type MemberOption = Readonly<{
  email: string | null;
  id: string;
  name: string;
}>;

type ScopeOption = Readonly<{
  id: DelegationScopeType;
  name: string;
}>;

type DelegationRuleRow = Readonly<
  Record<string, unknown> &
    DelegationRuleRecord & {
      agentLabel: string;
      key: string;
      principalLabel: string;
      scopeLabel: string;
      statusLabel: string;
    }
>;

const FORM_STACK_STYLE = {
  display: 'grid',
  gap: 12,
  width: '100%',
};

const SCOPE_OPTIONS: readonly ScopeOption[] = [
  { id: 'ALL', name: '全部簽核' },
  { id: 'TEMPLATE_LIST', name: '指定模板' },
  { id: 'CONDITION_BASED', name: '條件式' },
];

export default function AdminDelegationsPage(): ReactElement {
  const [agentMember, setAgentMember] = useState<MemberOption | null>(null);
  const [conditionCel, setConditionCel] = useState('');
  const [endAt, setEndAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [memberLoading, setMemberLoading] = useState(false);
  const [memberOptions, setMemberOptions] = useState<readonly MemberOption[]>(
    [],
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [principalMember, setPrincipalMember] = useState<MemberOption | null>(
    null,
  );
  const [priority, setPriority] = useState('100');
  const [rules, setRules] = useState<readonly DelegationRuleRecord[]>([]);
  const [saving, setSaving] = useState(false);
  const [scopeTemplateIds, setScopeTemplateIds] = useState('');
  const [scopeType, setScopeType] = useState<ScopeOption>(SCOPE_OPTIONS[0]);

  useEffect((): void => {
    void refreshRules();
  }, []);

  const memberLabelsById = useMemo(
    (): ReadonlyMap<string, string> =>
      new Map(
        memberOptions.map((option) => [
          option.id,
          `${option.name}（${option.id}）`,
        ]),
      ),
    [memberOptions],
  );
  const rows = useMemo(
    (): DelegationRuleRow[] =>
      rules.map((rule) => ({
        ...rule,
        agentLabel:
          memberLabelsById.get(rule.agentMemberId) ?? rule.agentMemberId,
        key: rule.id,
        principalLabel:
          memberLabelsById.get(rule.principalMemberId) ??
          rule.principalMemberId,
        scopeLabel: readScopeLabel(rule),
        statusLabel: readDelegationStatusLabel(rule.status),
      })),
    [memberLabelsById, rules],
  );
  const selectedScopeType =
    SCOPE_OPTIONS.find((option) => option.id === scopeType.id) ??
    SCOPE_OPTIONS[0];
  const columns = useMemo(
    (): TableColumn<DelegationRuleRow>[] => [
      {
        dataIndex: 'principalLabel',
        key: 'principal',
        title: '原簽核人',
        width: 220,
      },
      { dataIndex: 'agentLabel', key: 'agent', title: '代理人', width: 220 },
      { dataIndex: 'scopeLabel', key: 'scope', title: '代理範圍', width: 220 },
      { dataIndex: 'statusLabel', key: 'status', title: '狀態', width: 120 },
      { dataIndex: 'priority', key: 'priority', title: '優先序', width: 100 },
      {
        key: 'startAt',
        render: (record: DelegationRuleRow): ReactElement => (
          <Typography component="span" variant="body">
            {formatDateTime(record.startAt)}
          </Typography>
        ),
        title: '開始時間',
        width: 220,
      },
      {
        key: 'endAt',
        render: (record: DelegationRuleRow): ReactElement => (
          <Typography component="span" variant="body">
            {record.endAt ? formatDateTime(record.endAt) : '-'}
          </Typography>
        ),
        title: '結束時間',
        width: 220,
      },
    ],
    [],
  );
  const tableActions = useMemo(
    (): TableActions<DelegationRuleRow> => ({
      render: (
        record,
      ): ReturnType<TableActions<DelegationRuleRow>['render']> =>
        record.status === 'ACTIVE'
          ? [
              {
                name: '撤銷',
                onClick: (): void => void handleRevoke(record.id),
              },
            ]
          : [],
      variant: 'destructive-secondary',
      width: 88,
    }),
    [],
  );

  async function refreshRules(): Promise<void> {
    setLoading(true);
    setError(null);

    try {
      const [nextRules, members] = await Promise.all([
        listDelegationRules({ includeInactive: true }),
        searchMembers(''),
      ]);

      setRules(nextRules);
      setMemberOptions(members.map(readMemberOption));
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  async function handleSearchMembers(searchText: string): Promise<void> {
    setMemberLoading(true);

    try {
      setMemberOptions((await searchMembers(searchText)).map(readMemberOption));
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setMemberLoading(false);
    }
  }

  function openCreateModal(): void {
    setAgentMember(null);
    setConditionCel('');
    setEndAt('');
    setPrincipalMember(null);
    setPriority('100');
    setScopeTemplateIds('');
    setScopeType(SCOPE_OPTIONS[0]);
    setModalOpen(true);
  }

  function closeCreateModal(): void {
    if (saving) {
      return;
    }

    setModalOpen(false);
  }

  async function handleCreate(): Promise<void> {
    if (!principalMember || !agentMember) {
      setError('請選擇原簽核人與代理人');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await createDelegationRule({
        agentMemberId: agentMember.id,
        createdByMemberId: CURRENT_MEMBER_ID,
        endAt: endAt.trim() || null,
        principalMemberId: principalMember.id,
        priority: Number(priority) || 100,
        requiresConfirmation: false,
        scopeConditionCel:
          selectedScopeType.id === 'CONDITION_BASED'
            ? conditionCel.trim()
            : null,
        scopeTemplateIds:
          selectedScopeType.id === 'TEMPLATE_LIST'
            ? readTemplateIds(scopeTemplateIds)
            : [],
        scopeType: selectedScopeType.id,
        startAt: null,
      });
      setModalOpen(false);
      await refreshRules();
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function handleRevoke(id: string): Promise<void> {
    setError(null);

    try {
      await revokeDelegationRule({
        id,
        revokedByMemberId: CURRENT_MEMBER_ID,
      });
      await refreshRules();
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    }
  }

  return (
    <Layout>
      {renderAppNavigation('/admin/delegations')}

      <Layout.Main>
        <PageHeader>
          <ContentHeader
            description="設定簽核代理規則，讓符合範圍的待簽任務自動改派給代理人。"
            title="代理設定"
          >
            <Button
              icon={PlusIcon}
              iconType="leading"
              onClick={openCreateModal}
              variant="base-primary"
            >
              建立代理
            </Button>
          </ContentHeader>
        </PageHeader>

        <SectionGroup>
          <Section>
            {error ? (
              <Typography color="text-error" variant="body">
                {error}
              </Typography>
            ) : null}
            <Table
              actions={tableActions}
              columns={columns}
              dataSource={rows}
              fullWidth
              loading={loading}
            />
          </Section>
        </SectionGroup>

        <Modal
          cancelText="取消"
          confirmButtonProps={{
            disabled: !principalMember || !agentMember,
          }}
          confirmText="建立代理"
          loading={saving}
          modalType="standard"
          onCancel={closeCreateModal}
          onClose={closeCreateModal}
          onConfirm={(): void => void handleCreate()}
          open={modalOpen}
          showModalFooter
          showModalHeader
          size="regular"
          supportingText="代理生效後，後續建立的待簽任務會依範圍自動指派。"
          title="建立代理"
        >
          <div style={FORM_STACK_STYLE}>
            <MemberAutoCompleteField
              label="原簽核人"
              loading={memberLoading}
              name="principalMemberId"
              onChange={setPrincipalMember}
              onSearch={handleSearchMembers}
              options={memberOptions}
              value={principalMember}
            />
            <MemberAutoCompleteField
              label="代理人"
              loading={memberLoading}
              name="agentMemberId"
              onChange={setAgentMember}
              onSearch={handleSearchMembers}
              options={memberOptions}
              value={agentMember}
            />
            <FormField
              density={FormFieldDensity.WIDE}
              fullWidth
              label="代理範圍"
              layout={FormFieldLayout.STRETCH}
              name="scopeType"
              required
            >
              <Select
                clearable={false}
                fullWidth
                onChange={(option): void =>
                  setScopeType(readScopeOptionFromValue(option))
                }
                options={[...SCOPE_OPTIONS]}
                value={selectedScopeType}
              />
            </FormField>
            {selectedScopeType.id === 'TEMPLATE_LIST' ? (
              <FormField
                density={FormFieldDensity.WIDE}
                fullWidth
                label="模板 ID"
                layout={FormFieldLayout.STRETCH}
                name="scopeTemplateIds"
                required
              >
                <Textarea
                  onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
                    setScopeTemplateIds(event.target.value)
                  }
                  placeholder="多個模板 ID 可用逗號或換行分隔"
                  resize="vertical"
                  rows={3}
                  value={scopeTemplateIds}
                />
              </FormField>
            ) : null}
            {selectedScopeType.id === 'CONDITION_BASED' ? (
              <FormField
                density={FormFieldDensity.WIDE}
                fullWidth
                label="CEL 條件"
                layout={FormFieldLayout.STRETCH}
                name="conditionCel"
                required
              >
                <Textarea
                  onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
                    setConditionCel(event.target.value)
                  }
                  placeholder="例如 form.amount > 10000"
                  resize="vertical"
                  rows={3}
                  value={conditionCel}
                />
              </FormField>
            ) : null}
            <FormField
              density={FormFieldDensity.WIDE}
              fullWidth
              label="優先序"
              layout={FormFieldLayout.STRETCH}
              name="priority"
            >
              <Input
                fullWidth
                onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                  setPriority(event.target.value)
                }
                value={priority}
                variant="base"
              />
            </FormField>
            <FormField
              density={FormFieldDensity.WIDE}
              fullWidth
              label="結束時間"
              layout={FormFieldLayout.STRETCH}
              name="endAt"
            >
              <Input
                onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                  setEndAt(event.target.value)
                }
                placeholder="YYYY-MM-DD HH:mm:ss，可留空"
                value={endAt}
                variant="base"
              />
            </FormField>
          </div>
        </Modal>
      </Layout.Main>
    </Layout>
  );
}

function MemberAutoCompleteField({
  label,
  loading,
  name,
  onChange,
  onSearch,
  options,
  value,
}: {
  readonly label: string;
  readonly loading: boolean;
  readonly name: string;
  readonly onChange: (option: MemberOption | null) => void;
  readonly onSearch: (searchText: string) => Promise<void>;
  readonly options: readonly MemberOption[];
  readonly value: MemberOption | null;
}): ReactElement {
  return (
    <FormField
      density={FormFieldDensity.WIDE}
      fullWidth
      label={label}
      layout={FormFieldLayout.STRETCH}
      name={name}
      required
    >
      <AutoComplete
        asyncData
        disabledOptionsFilter
        emptyText="沒有符合的成員"
        inputProps={{
          autoCapitalize: 'none',
          autoCorrect: 'off',
          name,
          spellCheck: false,
        }}
        loading={loading}
        loadingText="搜尋成員中..."
        mode="single"
        onChange={(option): void => onChange(readMemberOptionFromValue(option))}
        onSearch={onSearch}
        onSearchTextChange={(searchText): void =>
          onChange(readUniqueMemberOption(searchText, options))
        }
        onVisibilityChange={(open): void => {
          if (open) {
            void onSearch('');
          }
        }}
        options={[...options]}
        placeholder="搜尋姓名、信箱或 member_id"
        searchDebounceTime={300}
        value={value}
      />
    </FormField>
  );
}

function readMemberOption(member: MemberProfileRecord): MemberOption {
  return {
    email: member.email,
    id: member.memberId,
    name: `${member.name} · ${member.email}`,
  };
}

function readMemberOptionFromValue(value: unknown): MemberOption | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = value.id;
  const name = value.name;
  const email = value.email;

  return typeof id === 'string' && typeof name === 'string'
    ? { email: typeof email === 'string' ? email : null, id, name }
    : null;
}

function readUniqueMemberOption(
  searchText: string,
  options: readonly MemberOption[],
): MemberOption | null {
  const normalizedSearchText = searchText.trim().toLocaleLowerCase();

  if (!normalizedSearchText) {
    return null;
  }

  const matches = options.filter((option) =>
    [option.id, option.name, option.email ?? ''].some((value) =>
      value.toLocaleLowerCase().includes(normalizedSearchText),
    ),
  );

  return matches.length === 1 ? (matches[0] ?? null) : null;
}

function readScopeOptionFromValue(value: unknown): ScopeOption {
  if (!isRecord(value) || !isDelegationScopeType(value.id)) {
    return SCOPE_OPTIONS[0];
  }

  return (
    SCOPE_OPTIONS.find((option) => option.id === value.id) ?? SCOPE_OPTIONS[0]
  );
}

function isDelegationScopeType(value: unknown): value is DelegationScopeType {
  return (
    value === 'ALL' || value === 'TEMPLATE_LIST' || value === 'CONDITION_BASED'
  );
}

function readTemplateIds(value: string): readonly string[] {
  return value
    .split(/[\s,]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function readScopeLabel(rule: DelegationRuleRecord): string {
  if (rule.scopeType === 'ALL') {
    return '全部簽核';
  }

  if (rule.scopeType === 'TEMPLATE_LIST') {
    return `指定模板：${rule.scopeTemplateIds.length}`;
  }

  return rule.scopeConditionCel ? `條件：${rule.scopeConditionCel}` : '條件式';
}

function readDelegationStatusLabel(
  status: DelegationRuleRecord['status'],
): string {
  if (status === 'ACTIVE') {
    return '啟用中';
  }

  if (status === 'REVOKED') {
    return '已撤銷';
  }

  if (status === 'EXPIRED') {
    return '已過期';
  }

  return status;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '發生未知錯誤';
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
