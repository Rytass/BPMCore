'use client';

import type { ChangeEvent, Key, ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  Filter,
  FilterArea,
  FilterLine,
  FormField,
  Input,
  Layout,
  PageHeader,
  Section,
  SectionGroup,
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
import { formatDateTime } from '../_lib/date-time';
import { renderAppNavigation } from '../app-navigation';
import { TemplateNameModal } from './_components/template-name-modal';
import {
  ApprovalTemplateListStatus,
  ApprovalTemplateRecord,
  createApprovalTemplate,
  listApprovalTemplatesPage,
} from './_lib/template-api';
import { listLaunchableTemplates } from '../instances/_lib/workflow-api';

const TEMPLATE_PAGE_SIZE_OPTIONS = [10, 20, 50];
const TEMPLATE_STATUS_TABS: readonly {
  readonly key: TemplateStatusTabKey;
  readonly label: string;
}[] = [
  { key: 'ALL', label: '全部' },
  { key: 'PUBLISHED', label: '已發布' },
  { key: 'DRAFT', label: '草稿' },
];

type TemplateStatusTabKey = 'ALL' | ApprovalTemplateListStatus;

type TemplateRow = Readonly<
  Record<string, unknown> &
    ApprovalTemplateRecord & {
      key: string;
      status: string;
    }
>;

export default function TemplatesPage(): ReactElement {
  const router = useRouter();
  const [templates, setTemplates] = useState<readonly ApprovalTemplateRecord[]>(
    [],
  );
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
      const [templatePageResult, nextLaunchableTemplates] = await Promise.all([
        listApprovalTemplatesPage({
          page: templatePage,
          pageSize: templatePageSize,
          searchText: templateSearchText,
          status: templateStatus === 'ALL' ? null : templateStatus,
        }),
        listLaunchableTemplates(),
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
  }, [templatePage, templatePageSize, templateSearchText, templateStatus]);

  useEffect((): void => {
    void refreshTemplates();
  }, [refreshTemplates]);

  const rows = useMemo(
    (): TemplateRow[] =>
      templates.map((template) => ({
        ...template,
        key: template.id,
        status: template.currentVersionId ? '已發布' : '草稿',
        updatedAt: formatDateTime(template.updatedAt),
      })),
    [templates],
  );
  const columns = useMemo(
    (): TableColumn<TemplateRow>[] => [
      { dataIndex: 'name', key: 'name', title: '模板名稱', width: 220 },
      { dataIndex: 'status', key: 'status', title: '狀態', width: 120 },
      {
        key: 'category',
        render: (record: TemplateRow): ReactElement => (
          <Typography variant="body">{record.category ?? '未分類'}</Typography>
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
            router.push(`/instances/new?templateId=${record.id}`),
          variant: 'base-primary',
        },
        {
          name: '設計',
          onClick: (): void => router.push(`/templates/${record.id}/designer`),
        },
        {
          name: '版本',
          onClick: (): void => router.push(`/templates/${record.id}/versions`),
        },
      ],
      variant: 'base-secondary',
      width: 192,
    }),
    [launchableTemplateIds, router],
  );

  async function handleCreateTemplate(name: string): Promise<void> {
    setCreating(true);
    setError(null);

    try {
      const templateId = await createApprovalTemplate(name);
      setCreateModalOpen(false);
      router.push(`/templates/${templateId}/designer`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <Layout>
        {renderAppNavigation('/templates')}

        <Layout.Main>
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
                        label="關鍵字"
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
                          placeholder="搜尋模板名稱、分類或描述"
                          size="sub"
                          value={templateSearchText}
                          variant="base"
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
        </Layout.Main>
      </Layout>

      <TemplateNameModal
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
