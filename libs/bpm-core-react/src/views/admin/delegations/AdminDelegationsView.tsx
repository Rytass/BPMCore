'use client';

import {
  ChangeEvent,
  Key,
  ReactElement,
  RefCallback,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  AutoComplete,
  Badge,
  Button,
  DateTimePicker,
  Filter,
  FilterArea,
  FilterLine,
  FormField,
  Input,
  Modal,
  PageHeader,
  Section,
  SectionGroup,
  Select,
  Tab,
  TabItem,
  Table,
  Tooltip,
  Typography,
} from '@mezzanine-ui/react';
import ContentHeader from '@mezzanine-ui/react/ContentHeader';
import { PlusIcon } from '@mezzanine-ui/icons';
import type { TableActions, TableColumn } from '@mezzanine-ui/core/table';
import { FormFieldLayout } from '@mezzanine-ui/core/form';
import { BPMFormField } from '../../../components/bpm-form-field';
import styles from './delegations.module.scss';
import { formatDateTime } from '../../../lib/format-date-time';
import { useAuth } from '../../../lib/auth-provider';
import { useBPMRoutes } from '../../../lib/routes-config';
import { AppLayout } from '../../../components/app-navigation';
import {
  DelegationRuleRecord,
  DelegationRuleStatus,
  DelegationScopeType,
  MemberProfileRecord,
  createDelegationRule,
  listDelegationRulesPage,
  revokeDelegationRule,
  searchMembers,
} from '@rytass/bpm-core-client/workflow';
import {
  ApprovalTemplateRecord,
  listApprovalTemplates,
} from '@rytass/bpm-core-client/template';

type MemberOption = Readonly<{
  displayName: string;
  email: string | null;
  id: string;
  name: string;
}>;

type TemplateOption = Readonly<{
  id: string;
  name: string;
}>;

type ScopeOption = Readonly<{
  id: DelegationScopeType;
  name: string;
}>;

type ScopeFilterOption = Readonly<{
  id: 'ALL_SCOPES' | DelegationScopeType;
  name: string;
  scopeType: DelegationScopeType | null;
}>;

type DelegationRuleRow = Readonly<
  Record<string, unknown> &
    DelegationRuleRecord & {
      agentEmail: string | null;
      agentName: string;
      key: string;
      principalEmail: string | null;
      principalName: string;
      scopeLabel: string;
    }
>;

const DELEGATION_MODAL_FIELD_LAYOUT = FormFieldLayout.HORIZONTAL;
const DELEGATION_PAGE_SIZE_OPTIONS = [10, 20, 50];
const DELEGATION_STATUS_TABS: readonly {
  readonly key: DelegationStatusTabKey;
  readonly label: string;
}[] = [
  { key: 'ALL', label: '全部' },
  { key: 'ACTIVE', label: '啟用中' },
  { key: 'REVOKED', label: '已撤銷' },
  { key: 'EXPIRED', label: '已過期' },
];

type DelegationStatusTabKey = 'ALL' | DelegationRuleStatus;

const SCOPE_OPTIONS: readonly ScopeOption[] = [
  { id: 'ALL', name: '全部簽核' },
  { id: 'TEMPLATE_LIST', name: '指定模板' },
];

const SCOPE_FILTER_OPTIONS: readonly ScopeFilterOption[] = [
  { id: 'ALL_SCOPES', name: '全部範圍', scopeType: null },
  { id: 'ALL', name: '全部簽核', scopeType: 'ALL' },
  { id: 'TEMPLATE_LIST', name: '指定模板', scopeType: 'TEMPLATE_LIST' },
];

export interface AdminDelegationsViewProps {
  readonly activeHref?: string;
}

export function AdminDelegationsView({
  activeHref,
}: AdminDelegationsViewProps = {}): ReactElement {
  const routes = useBPMRoutes();
  const resolvedActiveHref = activeHref ?? routes.adminDelegations();
  const { member } = useAuth();
  const currentMemberId = member?.memberId ?? null;
  const [agentMember, setAgentMember] = useState<MemberOption | null>(null);
  const [endAt, setEndAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [memberLoading, setMemberLoading] = useState(false);
  const [memberOptions, setMemberOptions] = useState<readonly MemberOption[]>(
    [],
  );
  const [principalFilterMember, setPrincipalFilterMember] =
    useState<MemberOption | null>(null);
  const [agentFilterMember, setAgentFilterMember] =
    useState<MemberOption | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [principalMember, setPrincipalMember] = useState<MemberOption | null>(
    null,
  );
  const [priority, setPriority] = useState('100');
  const [rulePage, setRulePage] = useState(1);
  const [rulePageSize, setRulePageSize] = useState(10);
  const [ruleStatus, setRuleStatus] = useState<DelegationStatusTabKey>('ALL');
  const [ruleTotalCount, setRuleTotalCount] = useState(0);
  const [rules, setRules] = useState<readonly DelegationRuleRecord[]>([]);
  const [saving, setSaving] = useState(false);
  const [scopeTemplates, setScopeTemplates] = useState<
    readonly TemplateOption[]
  >([]);
  const [scopeFilterType, setScopeFilterType] = useState<ScopeFilterOption>(
    SCOPE_FILTER_OPTIONS[0],
  );
  const [scopeType, setScopeType] = useState<ScopeOption>(SCOPE_OPTIONS[0]);
  const [startAt, setStartAt] = useState('');
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateOptions, setTemplateOptions] = useState<
    readonly TemplateOption[]
  >([]);

  const refreshRules = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const [rulePageResult, members] = await Promise.all([
        listDelegationRulesPage({
          agentMemberId: agentFilterMember?.id ?? null,
          includeInactive: true,
          page: rulePage,
          pageSize: rulePageSize,
          principalMemberId: principalFilterMember?.id ?? null,
          scopeType: scopeFilterType.scopeType,
          status: ruleStatus === 'ALL' ? null : ruleStatus,
        }),
        searchMembers(''),
      ]);

      setRules(rulePageResult.rules);
      setRuleTotalCount(rulePageResult.totalCount);
      setMemberOptions(members.map(readMemberOption));
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [
    agentFilterMember,
    principalFilterMember,
    rulePage,
    rulePageSize,
    ruleStatus,
    scopeFilterType,
  ]);

  useEffect((): void => {
    void refreshRules();
  }, [refreshRules]);

  const membersById = useMemo(
    (): ReadonlyMap<string, MemberOption> =>
      new Map(memberOptions.map((option) => [option.id, option])),
    [memberOptions],
  );
  const rows = useMemo(
    (): DelegationRuleRow[] =>
      rules.map((rule) => ({
        ...rule,
        agentEmail: membersById.get(rule.agentMemberId)?.email ?? null,
        agentName:
          membersById.get(rule.agentMemberId)?.displayName ??
          rule.agentMemberId,
        key: rule.id,
        principalEmail: membersById.get(rule.principalMemberId)?.email ?? null,
        principalName:
          membersById.get(rule.principalMemberId)?.displayName ??
          rule.principalMemberId,
        scopeLabel: readScopeLabel(rule),
      })),
    [membersById, rules],
  );
  const selectedScopeType =
    SCOPE_OPTIONS.find((option) => option.id === scopeType.id) ??
    SCOPE_OPTIONS[0];
  const columns = useMemo(
    (): TableColumn<DelegationRuleRow>[] => [
      {
        key: 'principal',
        render: (record: DelegationRuleRow): ReactElement => (
          <MemberNameWithEmailTooltip
            email={record.principalEmail}
            name={record.principalName}
          />
        ),
        title: '原簽核人',
        width: 220,
      },
      {
        key: 'agent',
        render: (record: DelegationRuleRow): ReactElement => (
          <MemberNameWithEmailTooltip
            email={record.agentEmail}
            name={record.agentName}
          />
        ),
        title: '代理人',
        width: 220,
      },
      { dataIndex: 'scopeLabel', key: 'scope', title: '代理範圍', width: 220 },
      {
        key: 'status',
        render: (record: DelegationRuleRow): ReactElement => (
          <DelegationStatusBadge status={record.status} />
        ),
        title: '狀態',
        width: 120,
      },
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
  const handleRevoke = useCallback(
    async (id: string): Promise<void> => {
      if (!currentMemberId) {
        return;
      }

      setError(null);

      try {
        await revokeDelegationRule({
          id,
          revokedByMemberId: currentMemberId,
        });
        await refreshRules();
      } catch (requestError: unknown) {
        setError(readErrorMessage(requestError));
      }
    },
    [currentMemberId, refreshRules],
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
    [handleRevoke],
  );

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

  async function handleSearchTemplates(
    searchText: string,
    selectedOptions: readonly TemplateOption[] = scopeTemplates,
  ): Promise<void> {
    setTemplateLoading(true);

    try {
      const nextOptions = (await listApprovalTemplates()).map(
        readTemplateOption,
      );

      setTemplateOptions(
        mergeTemplateOptions(
          selectedOptions,
          filterTemplateOptions(nextOptions, searchText),
        ),
      );
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setTemplateLoading(false);
    }
  }

  function openCreateModal(): void {
    setAgentMember(null);
    setEndAt('');
    setPrincipalMember(null);
    setPriority('100');
    setScopeTemplates([]);
    setScopeType(SCOPE_OPTIONS[0]);
    setStartAt('');
    setTemplateOptions([]);
    void handleSearchTemplates('', []);
    setModalOpen(true);
  }

  function closeCreateModal(): void {
    if (saving) {
      return;
    }

    setModalOpen(false);
  }

  async function handleCreate(): Promise<void> {
    if (!currentMemberId) {
      return;
    }

    if (!principalMember || !agentMember) {
      setError('請選擇原簽核人與代理人');
      return;
    }

    if (selectedScopeType.id === 'TEMPLATE_LIST' && scopeTemplates.length < 1) {
      setError('請選擇至少一個簽核模板');
      return;
    }

    if (isInvalidDelegationDateRange(startAt, endAt)) {
      setError('結束時間必須晚於起始時間');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await createDelegationRule({
        agentMemberId: agentMember.id,
        createdByMemberId: currentMemberId,
        endAt: endAt || null,
        principalMemberId: principalMember.id,
        priority: Number(priority) || 100,
        requiresConfirmation: false,
        scopeConditionCel: null,
        scopeTemplateIds:
          selectedScopeType.id === 'TEMPLATE_LIST'
            ? scopeTemplates.map((template) => template.id)
            : [],
        scopeType: selectedScopeType.id,
        startAt: startAt || null,
      });
      setModalOpen(false);
      if (rulePage === 1) {
        await refreshRules();
      } else {
        setRulePage(1);
      }
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppLayout activeHref={resolvedActiveHref}>
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
          <Section
            filterArea={
              <FilterArea className={styles.delegationFilterArea}>
                <FilterLine>
                  <Filter span={2}>
                    <MemberAutoCompleteField
                      hideLabel
                      label="原簽核人"
                      loading={memberLoading}
                      name="principalFilterMemberId"
                      onChange={(option): void => {
                        setPrincipalFilterMember(option);
                        setRulePage(1);
                      }}
                      onSearch={handleSearchMembers}
                      options={memberOptions}
                      required={false}
                      layout={FormFieldLayout.VERTICAL}
                      size="sub"
                      value={principalFilterMember}
                    />
                  </Filter>
                  <Filter span={2}>
                    <MemberAutoCompleteField
                      hideLabel
                      label="代理人"
                      loading={memberLoading}
                      name="agentFilterMemberId"
                      onChange={(option): void => {
                        setAgentFilterMember(option);
                        setRulePage(1);
                      }}
                      onSearch={handleSearchMembers}
                      options={memberOptions}
                      required={false}
                      layout={FormFieldLayout.VERTICAL}
                      size="sub"
                      value={agentFilterMember}
                    />
                  </Filter>
                  <Filter span={2}>
                    <FormField
                      fullWidth
                      layout={FormFieldLayout.VERTICAL}
                      name="scopeFilterType"
                    >
                      <Select
                        clearable={false}
                        fullWidth
                        onChange={(option): void => {
                          setScopeFilterType(readScopeFilterOption(option));
                          setRulePage(1);
                        }}
                        options={[...SCOPE_FILTER_OPTIONS]}
                        placeholder="代理範圍"
                        size="sub"
                        value={scopeFilterType}
                      />
                    </FormField>
                  </Filter>
                </FilterLine>
              </FilterArea>
            }
            tab={
              <Tab
                activeKey={ruleStatus}
                onChange={(activeKey): void => {
                  setRuleStatus(readDelegationStatusTabKey(activeKey));
                  setRulePage(1);
                }}
              >
                {DELEGATION_STATUS_TABS.map((statusTab) => (
                  <TabItem key={statusTab.key}>{statusTab.label}</TabItem>
                ))}
              </Tab>
            }
          >
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
              pagination={{
                current: rulePage,
                onChange: (page): void => {
                  setRulePage(page);
                },
                onChangePageSize: (pageSize): void => {
                  setRulePage(1);
                  setRulePageSize(pageSize);
                },
                pageSize: rulePageSize,
                pageSizeLabel: '每頁筆數',
                pageSizeOptions: DELEGATION_PAGE_SIZE_OPTIONS,
                renderResultSummary: (from, to, total): string =>
                  `顯示 ${from}-${to} 筆，共 ${total} 筆`,
                showPageSizeOptions: true,
                total: ruleTotalCount,
              }}
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
          <div className={styles.delegationModalFields}>
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
            <BPMFormField label="代理範圍" name="scopeType" required>
              <Select
                clearable={false}
                fullWidth
                onChange={(option): void =>
                  setScopeType(readScopeOptionFromValue(option))
                }
                options={[...SCOPE_OPTIONS]}
                value={selectedScopeType}
              />
            </BPMFormField>
            {selectedScopeType.id === 'TEMPLATE_LIST' ? (
              <BPMFormField label="簽核模板" name="scopeTemplateIds" required>
                <AutoComplete
                  asyncData
                  disabledOptionsFilter
                  emptyText="沒有符合的模板"
                  inputProps={{
                    autoCapitalize: 'none',
                    autoCorrect: 'off',
                    name: 'scopeTemplateIds',
                    spellCheck: false,
                  }}
                  loading={templateLoading}
                  loadingText="搜尋模板中..."
                  mode="multiple"
                  onChange={(nextTemplates): void => {
                    const selectedTemplates =
                      readTemplateOptionsFromValue(nextTemplates);

                    setScopeTemplates(selectedTemplates);
                    setTemplateOptions((currentOptions) =>
                      mergeTemplateOptions(selectedTemplates, currentOptions),
                    );
                  }}
                  onSearch={handleSearchTemplates}
                  onVisibilityChange={(open): void => {
                    if (open) {
                      void handleSearchTemplates('');
                    }
                  }}
                  options={[...templateOptions]}
                  overflowStrategy="wrap"
                  placeholder="搜尋並選取簽核模板"
                  searchDebounceTime={300}
                  value={[...scopeTemplates]}
                />
              </BPMFormField>
            ) : null}
            <BPMFormField label="優先序" name="priority">
              <Input
                fullWidth
                onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                  setPriority(event.target.value)
                }
                value={priority}
                variant="base"
              />
            </BPMFormField>
            <BPMFormField label="起始時間" name="startAt">
              <DateTimePicker
                formatDate="YYYY-MM-DD"
                formatTime="HH:mm"
                fullWidth
                hideSecond
                onChange={(nextValue): void =>
                  setStartAt(formatDelegationDateTimePickerValue(nextValue))
                }
                placeholderLeft="留空立即生效"
                placeholderRight="選擇時間"
                value={readDelegationDateTimePickerValue(startAt)}
              />
            </BPMFormField>
            <BPMFormField label="結束時間" name="endAt">
              <DateTimePicker
                formatDate="YYYY-MM-DD"
                formatTime="HH:mm"
                fullWidth
                hideSecond
                onChange={(nextValue): void =>
                  setEndAt(formatDelegationDateTimePickerValue(nextValue))
                }
                placeholderLeft="可留空"
                placeholderRight="選擇時間"
                value={readDelegationDateTimePickerValue(endAt)}
              />
            </BPMFormField>
          </div>
        </Modal>
      </AppLayout>
  );
}

function MemberAutoCompleteField({
  hideLabel = false,
  label,
  layout = DELEGATION_MODAL_FIELD_LAYOUT,
  loading,
  name,
  onChange,
  onSearch,
  options,
  required = true,
  size,
  value,
}: {
  readonly hideLabel?: boolean;
  readonly label: string;
  readonly layout?: FormFieldLayout;
  readonly loading: boolean;
  readonly name: string;
  readonly onChange: (option: MemberOption | null) => void;
  readonly onSearch: (searchText: string) => Promise<void>;
  readonly options: readonly MemberOption[];
  readonly required?: boolean;
  readonly size?: 'main' | 'sub';
  readonly value: MemberOption | null;
}): ReactElement {
  const autoComplete = (
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
      placeholder={hideLabel ? label : '搜尋姓名或信箱'}
      searchDebounceTime={300}
      size={size}
      value={value}
    />
  );

  if (hideLabel) {
    return (
      <FormField fullWidth layout={layout} name={name}>
        {autoComplete}
      </FormField>
    );
  }

  return (
    <BPMFormField label={label} layout={layout} name={name} required={required}>
      {autoComplete}
    </BPMFormField>
  );
}

function readMemberOption(member: MemberProfileRecord): MemberOption {
  return {
    displayName: member.name,
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
  const displayName = value.displayName;

  return typeof id === 'string' && typeof name === 'string'
    ? {
        displayName: typeof displayName === 'string' ? displayName : name,
        email: typeof email === 'string' ? email : null,
        id,
        name,
      }
    : null;
}

function MemberNameWithEmailTooltip({
  email,
  name,
}: {
  readonly email: string | null;
  readonly name: string;
}): ReactElement {
  if (!email) {
    return <span>{name}</span>;
  }

  return (
    <Tooltip title={email}>
      {({ onMouseEnter, onMouseLeave, ref }): ReactElement => (
        <span
          className={styles.memberNameWithTooltip}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
          ref={ref as RefCallback<HTMLSpanElement>}
        >
          {name}
        </span>
      )}
    </Tooltip>
  );
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

function readTemplateOption(template: ApprovalTemplateRecord): TemplateOption {
  return {
    id: template.id,
    name: template.name,
  };
}

function readTemplateOptionsFromValue(
  value: readonly unknown[],
): readonly TemplateOption[] {
  return value.flatMap((item): readonly TemplateOption[] => {
    if (!isRecord(item)) {
      return [];
    }

    const id = item.id;
    const name = item.name;

    return typeof id === 'string' && typeof name === 'string'
      ? [{ id, name }]
      : [];
  });
}

function filterTemplateOptions(
  options: readonly TemplateOption[],
  searchText: string,
): readonly TemplateOption[] {
  const normalizedSearchText = searchText.trim().toLocaleLowerCase();

  if (!normalizedSearchText) {
    return options;
  }

  return options.filter((option) =>
    [option.id, option.name].some((value) =>
      value.toLocaleLowerCase().includes(normalizedSearchText),
    ),
  );
}

function mergeTemplateOptions(
  selectedOptions: readonly TemplateOption[],
  availableOptions: readonly TemplateOption[],
): readonly TemplateOption[] {
  return [...selectedOptions, ...availableOptions].reduce<TemplateOption[]>(
    (options, option) =>
      options.some((currentOption) => currentOption.id === option.id)
        ? options
        : [...options, option],
    [],
  );
}

function readScopeOptionFromValue(value: unknown): ScopeOption {
  if (!isRecord(value) || !isSelectableDelegationScopeType(value.id)) {
    return SCOPE_OPTIONS[0];
  }

  return (
    SCOPE_OPTIONS.find((option) => option.id === value.id) ?? SCOPE_OPTIONS[0]
  );
}

function readScopeFilterOption(value: unknown): ScopeFilterOption {
  if (!isRecord(value)) {
    return SCOPE_FILTER_OPTIONS[0];
  }

  const id = value.id;

  return (
    SCOPE_FILTER_OPTIONS.find((option) => option.id === id) ??
    SCOPE_FILTER_OPTIONS[0]
  );
}

function isSelectableDelegationScopeType(
  value: unknown,
): value is ScopeOption['id'] {
  return value === 'ALL' || value === 'TEMPLATE_LIST';
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

function DelegationStatusBadge({
  status,
}: {
  readonly status: DelegationRuleRecord['status'];
}): ReactElement {
  if (status === 'ACTIVE') {
    return <Badge size="sub" text="啟用中" variant="dot-success" />;
  }

  if (status === 'REVOKED') {
    return <Badge size="sub" text="已撤銷" variant="dot-inactive" />;
  }

  if (status === 'EXPIRED') {
    return <Badge size="sub" text="已過期" variant="dot-warning" />;
  }

  return <Badge size="sub" text={status} variant="dot-info" />;
}

function readDelegationStatusTabKey(activeKey: Key): DelegationStatusTabKey {
  if (
    activeKey === 'ACTIVE' ||
    activeKey === 'REVOKED' ||
    activeKey === 'EXPIRED'
  ) {
    return activeKey;
  }

  return 'ALL';
}

function readDelegationDateTimePickerValue(value: string): string | undefined {
  const date = value ? parseDelegationDateTimeValue(value) : null;

  return date
    ? `${formatDateParts(date)}T${padDatePart(date.getHours())}:${padDatePart(
        date.getMinutes(),
      )}`
    : undefined;
}

function formatDelegationDateTimePickerValue(
  value: string | undefined,
): string {
  const date = value ? parseDelegationDateTimeValue(value) : null;

  return date ? date.toISOString() : '';
}

function isInvalidDelegationDateRange(startAt: string, endAt: string): boolean {
  if (!startAt || !endAt) {
    return false;
  }

  const startDate = parseDelegationDateTimeValue(startAt);
  const endDate = parseDelegationDateTimeValue(endAt);

  return !!startDate && !!endDate && endDate.getTime() <= startDate.getTime();
}

function parseDelegationDateTimeValue(value: string): Date | null {
  if (value.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(value)) {
    const parsedDate = new Date(value);

    return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
  }

  const [datePart = '', timePart = '00:00'] = value.split('T');
  const [year = 0, month = 1, day = 1] = datePart.split('-').map(Number);
  const [hour = 0, minute = 0] = timePart.split(':').map(Number);
  const parsedDate = new Date(year, month - 1, day, hour, minute);

  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

function formatDateParts(date: Date): string {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(
    date.getDate(),
  )}`;
}

function padDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '發生未知錯誤';
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
