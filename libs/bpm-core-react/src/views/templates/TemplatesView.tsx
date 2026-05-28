'use client';

import type { ChangeEvent, Key, ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Filter,
  FilterArea,
  FilterLine,
  FormField,
  Input,
  PageHeader,
  Section,
  SectionGroup,
  Select,
  Tab,
  TabItem,
  Table,
  Typography,
} from '@mezzanine-ui/react';
import ContentHeader from '@mezzanine-ui/react/ContentHeader';
import { PlusIcon } from '@mezzanine-ui/icons';
import { FormFieldLayout } from '@mezzanine-ui/core/form';
import type { TableActions, TableColumn } from '@mezzanine-ui/core/table';
import styles from './templates.module.scss';
import { formatDateTime } from '../../lib/format-date-time';
import { useRouterAdapter } from '../../lib/router-adapter';
import { useBPMRoutes } from '../../lib/routes-config';
import {
  TemplateCategoryOption,
  TemplateNameModal,
  UNCATEGORIZED_TEMPLATE_CATEGORY_OPTION,
} from './template-name-modal';
import {
  ApprovalTemplateListStatus,
  ApprovalTemplateRecord,
  ApprovalTemplateCategoryRecord,
  createApprovalTemplate,
  listApprovalTemplateCategoriesPage,
  listApprovalTemplatesPage,
} from '@rytass/bpm-core-client/template';
import { listLaunchableTemplates } from '@rytass/bpm-core-client/workflow';

const TEMPLATE_PAGE_SIZE_OPTIONS = [10, 20, 50];
const TEMPLATE_STATUS_TABS: readonly {
  readonly key: TemplateStatusTabKey;
  readonly label: string;
}[] = [
  { key: 'ALL', label: '全部' },
  { key: 'PUBLISHED', label: '已發布' },
  { key: 'DRAFT', label: '草稿' },
];

const TEMPLATE_CATEGORY_PAGE_SIZE = 100;

type TemplateStatusTabKey = 'ALL' | ApprovalTemplateListStatus;

type TemplateRow = Readonly<
  Record<string, unknown> &
    ApprovalTemplateRecord & {
      categoryLabel: string;
      key: string;
      status: ApprovalTemplateListStatus;
    }
>;


export function TemplatesView(): ReactElement {
  const router = useRouterAdapter();
  const routes = useBPMRoutes();
  const [templates, setTemplates] = useState<readonly ApprovalTemplateRecord[]>(
    [],
  );
  const [categoryFilter, setCategoryFilter] = useState<TemplateCategoryOption>(
    UNCATEGORIZED_TEMPLATE_FILTER_OPTION,
  );
  const [categoryOptions, setCategoryOptions] = useState<
    readonly TemplateCategoryOption[]
  >([]);
  const [launchableTemplateIds, setLaunchableTemplateIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [templatePage, setTemplatePage] = useState(1);
  const [templatePageSize, setTemplatePageSize] = useState(10);
  const [templateSearchText, setTemplateSearchText] = useState('');
  const [templateStatus, setTemplateStatus] =
    useState<TemplateStatusTabKey>('ALL');
  const [templateTotalCount, setTemplateTotalCount] = useState(0);

  const refreshTemplates = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const [
        templatePageResult,
        nextLaunchableTemplates,
        activeCategoryPageResult,
      ] = await Promise.all([
        listApprovalTemplatesPage({
          categoryId: categoryFilter.categoryId,
          page: templatePage,
          pageSize: templatePageSize,
          searchText: templateSearchText,
          status: templateStatus === 'ALL' ? null : templateStatus,
        }),
        listLaunchableTemplates(),
        listApprovalTemplateCategoriesPage({
          page: 1,
          pageSize: TEMPLATE_CATEGORY_PAGE_SIZE,
          searchText: '',
          status: 'ACTIVE',
        }),
      ]);

      setCategoryOptions([
        ...activeCategoryPageResult.categories.map(readCategoryOption),
      ]);
      setTemplates(templatePageResult.templates);
      setTemplateTotalCount(templatePageResult.totalCount);
      setLaunchableTemplateIds(
        new Set(nextLaunchableTemplates.map((template) => template.id)),
      );
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [
    categoryFilter,
    templatePage,
    templatePageSize,
    templateSearchText,
    templateStatus,
  ]);

  useEffect((): void => {
    void refreshTemplates();
  }, [refreshTemplates]);

  const rows = useMemo(
    (): TemplateRow[] =>
      templates.map((template) => ({
        ...template,
        categoryLabel: readTemplateCategoryLabel(template),
        key: template.id,
        status: template.currentVersionId ? 'PUBLISHED' : 'DRAFT',
        updatedAt: formatDateTime(template.updatedAt),
      })),
    [templates],
  );
  const columns = useMemo(
    (): TableColumn<TemplateRow>[] => [
      { dataIndex: 'name', key: 'name', title: '模板名稱', width: 220 },
      {
        key: 'status',
        render: (record: TemplateRow): ReactElement => (
          <TemplateStatusBadge status={record.status} />
        ),
        title: '狀態',
        width: 120,
      },
      {
        key: 'category',
        render: (record: TemplateRow): ReactElement => (
          <TemplateCategoryLabel record={record} />
        ),
        title: '分類',
        width: 160,
      },
      {
        dataIndex: 'updatedAt',
        key: 'updatedAt',
        title: '更新時間',
        width: 220,
      },
    ],
    [],
  );
  const tableActions = useMemo(
    (): TableActions<TemplateRow> => ({
      render: (record): ReturnType<TableActions<TemplateRow>['render']> => [
        {
          disabled: (template): boolean =>
            !launchableTemplateIds.has(template.id),
          name: '發起',
          onClick: (): void =>
            router.push(routes.caseNew(record.id)),
          variant: 'base-primary',
        },
        {
          name: '設計',
          onClick: (): void => router.push(routes.templateDesigner(record.id)),
        },
        {
          name: '版本',
          onClick: (): void => router.push(routes.templateVersions(record.id)),
        },
      ],
      variant: 'base-secondary',
      width: 192,
    }),
    [launchableTemplateIds, router],
  );

  async function handleCreateTemplate({
    categoryId,
    name,
  }: {
    readonly categoryId: string | null;
    readonly name: string;
  }): Promise<void> {
    setCreating(true);
    setError(null);

    try {
      const templateId = await createApprovalTemplate({ categoryId, name });
      setCreateModalOpen(false);
      router.push(routes.templateDesigner(templateId));
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <>
          <PageHeader>
            <ContentHeader
              description="建立流程模板、維護草稿與發布版本。"
              title="簽核模板"
            >
              <Button
                disabled={creating}
                icon={PlusIcon}
                iconType="leading"
                onClick={(): void => setCreateModalOpen(true)}
                variant="base-primary"
              >
                建立模板
              </Button>
            </ContentHeader>
          </PageHeader>

          <SectionGroup>
            <Section
              filterArea={
                <FilterArea className={styles.templateFilterArea} size="sub">
                  <FilterLine>
                    <Filter span={3}>
                      <FormField
                        fullWidth
                        layout={FormFieldLayout.VERTICAL}
                        name="templateSearchText"
                      >
                        <Input
                          fullWidth
                          onChange={(
                            event: ChangeEvent<HTMLInputElement>,
                          ): void => {
                            setTemplateSearchText(event.target.value);
                            setTemplatePage(1);
                          }}
                          placeholder="關鍵字：搜尋模板名稱、分類或描述"
                          size="sub"
                          value={templateSearchText}
                          variant="base"
                        />
                      </FormField>
                    </Filter>
                    <Filter span={2}>
                      <FormField
                        fullWidth
                        layout={FormFieldLayout.VERTICAL}
                        name="templateCategoryFilter"
                      >
                        <Select
                          clearable={false}
                          fullWidth
                          onChange={(option): void => {
                            setCategoryFilter(
                              readCategoryFilterOption(option, categoryOptions),
                            );
                            setTemplatePage(1);
                          }}
                          options={[
                            UNCATEGORIZED_TEMPLATE_FILTER_OPTION,
                            ...categoryOptions,
                          ]}
                          placeholder="分類"
                          renderValue={(value): string =>
                            `分類：${readTemplateCategoryFilterLabel(value)}`
                          }
                          size="sub"
                          value={categoryFilter}
                        />
                      </FormField>
                    </Filter>
                  </FilterLine>
                </FilterArea>
              }
              tab={
                <Tab
                  activeKey={templateStatus}
                  onChange={(activeKey): void => {
                    setTemplateStatus(readTemplateStatusTabKey(activeKey));
                    setTemplatePage(1);
                  }}
                >
                  {TEMPLATE_STATUS_TABS.map((statusTab) => (
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
                  current: templatePage,
                  onChange: (page): void => {
                    setTemplatePage(page);
                  },
                  onChangePageSize: (pageSize): void => {
                    setTemplatePage(1);
                    setTemplatePageSize(pageSize);
                  },
                  pageSize: templatePageSize,
                  pageSizeLabel: '每頁筆數',
                  pageSizeOptions: TEMPLATE_PAGE_SIZE_OPTIONS,
                  renderResultSummary: (from, to, total): string =>
                    `顯示 ${from}-${to} 筆，共 ${total} 筆`,
                  showPageSizeOptions: true,
                  total: templateTotalCount,
                }}
              />
            </Section>
          </SectionGroup>
        </>

      <TemplateNameModal
        categoryOptions={[
          UNCATEGORIZED_TEMPLATE_CATEGORY_OPTION,
          ...categoryOptions,
        ]}
        confirmText="建立"
        initialName=""
        loading={creating}
        onClose={(): void => setCreateModalOpen(false)}
        onSubmit={handleCreateTemplate}
        open={createModalOpen}
        title="建立簽核模板"
      />
    </>
  );
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '發生未知錯誤';
}

function readTemplateStatusTabKey(activeKey: Key): TemplateStatusTabKey {
  if (activeKey === 'PUBLISHED' || activeKey === 'DRAFT') {
    return activeKey;
  }

  return 'ALL';
}

function TemplateStatusBadge({
  status,
}: {
  readonly status: ApprovalTemplateListStatus;
}): ReactElement {
  if (status === 'PUBLISHED') {
    return <Badge size="sub" text="已發布" variant="dot-success" />;
  }

  return <Badge size="sub" text="草稿" variant="dot-inactive" />;
}

function TemplateCategoryLabel({
  record,
}: {
  readonly record: TemplateRow;
}): ReactElement {
  if (record.categoryDetail?.isActive === false) {
    return (
      <Badge
        size="sub"
        text={`${record.categoryLabel}（停用）`}
        variant="dot-inactive"
      />
    );
  }

  return (
    <Typography component="span" variant="body">
      {record.categoryLabel}
    </Typography>
  );
}

const UNCATEGORIZED_TEMPLATE_FILTER_OPTION: TemplateCategoryOption = {
  categoryId: null,
  id: 'ALL_CATEGORIES',
  name: '全部分類',
};

function readCategoryOption(
  category: ApprovalTemplateCategoryRecord,
): TemplateCategoryOption {
  return {
    categoryId: category.id,
    id: category.id,
    name: category.name,
  };
}

function readCategoryFilterOption(
  value: unknown,
  options: readonly TemplateCategoryOption[],
): TemplateCategoryOption {
  if (!isRecord(value)) {
    return UNCATEGORIZED_TEMPLATE_FILTER_OPTION;
  }

  const id = typeof value.id === 'string' ? value.id : null;

  if (id === UNCATEGORIZED_TEMPLATE_FILTER_OPTION.id) {
    return UNCATEGORIZED_TEMPLATE_FILTER_OPTION;
  }

  return (
    options.find((option) => option.id === id) ??
    UNCATEGORIZED_TEMPLATE_FILTER_OPTION
  );
}

function readTemplateCategoryFilterLabel(value: unknown): string {
  if (Array.isArray(value)) {
    return UNCATEGORIZED_TEMPLATE_FILTER_OPTION.name;
  }

  if (!isRecord(value)) {
    return UNCATEGORIZED_TEMPLATE_FILTER_OPTION.name;
  }

  return typeof value.name === 'string'
    ? value.name
    : UNCATEGORIZED_TEMPLATE_FILTER_OPTION.name;
}

function readTemplateCategoryLabel(template: ApprovalTemplateRecord): string {
  return template.categoryDetail?.name ?? template.category ?? '未分類';
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
