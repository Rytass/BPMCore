'use client';

import type { Key, ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
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
import type { TableActions, TableColumn } from '@mezzanine-ui/core/table';
import { formatDateTime } from '../../lib/format-date-time';
import {
  createFormDefinition,
  FormDefinitionListStatus,
  FormDefinitionRecord,
  listFormDefinitionsPage,
} from '@rytass/bpm-core-client/form';
import { useRouterAdapter } from '../../lib/router-adapter';
import { useBPMRoutes } from '../../lib/routes-config';
import { FormNameModal } from './form-name-modal';

const FORM_PAGE_SIZE_OPTIONS = [10, 20, 50];
const FORM_STATUS_TABS: readonly {
  readonly key: FormStatusTabKey;
  readonly label: string;
}[] = [
  { key: 'ALL', label: '全部' },
  { key: 'PUBLISHED', label: '已發布' },
  { key: 'DRAFT', label: '草稿' },
];

type FormDefinitionRow = Readonly<
  Record<string, unknown> &
    FormDefinitionRecord & {
      key: string;
      status: FormDefinitionListStatus;
    }
>;

type FormStatusTabKey = 'ALL' | FormDefinitionListStatus;


export function FormsView(): ReactElement {
  const router = useRouterAdapter();
  const routes = useBPMRoutes();
  const [forms, setForms] = useState<readonly FormDefinitionRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formPage, setFormPage] = useState(1);
  const [formPageSize, setFormPageSize] = useState(10);
  const [formStatus, setFormStatus] = useState<FormStatusTabKey>('ALL');
  const [formTotalCount, setFormTotalCount] = useState(0);

  const refreshForms = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const result = await listFormDefinitionsPage({
        page: formPage,
        pageSize: formPageSize,
        status: formStatus === 'ALL' ? null : formStatus,
      });

      setForms(result.forms);
      setFormTotalCount(result.totalCount);
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [formPage, formPageSize, formStatus]);

  useEffect((): void => {
    void refreshForms();
  }, [refreshForms]);

  const rows = useMemo(
    (): FormDefinitionRow[] =>
      forms.map((form) => ({
        ...form,
        key: form.id,
        status: form.currentVersionId ? 'PUBLISHED' : 'DRAFT',
        updatedAt: formatDateTime(form.updatedAt),
      })),
    [forms],
  );
  const columns = useMemo(
    (): TableColumn<FormDefinitionRow>[] => [
      { dataIndex: 'name', key: 'name', title: '表單名稱', width: 220 },
      {
        key: 'status',
        render: (record: FormDefinitionRow): ReactElement => (
          <FormStatusBadge status={record.status} />
        ),
        title: '狀態',
        width: 120,
      },
      {
        key: 'currentVersionId',
        render: (record: FormDefinitionRow): ReactElement => (
          <CurrentVersionLabel record={record} />
        ),
        title: '目前版本',
        width: 220,
      },
    ],
    [],
  );
  const tableActions = useMemo(
    (): TableActions<FormDefinitionRow> => ({
      render: (
        record,
      ): ReturnType<TableActions<FormDefinitionRow>['render']> => [
        {
          name: '編輯',
          onClick: (): void => router.push(routes.formBuilder(record.id)),
        },
      ],
      variant: 'base-secondary',
      width: 88,
    }),
    [router],
  );

  async function handleCreateForm(name: string): Promise<void> {
    setCreating(true);
    setError(null);

    try {
      const formId = await createFormDefinition(name);
      setCreateModalOpen(false);
      router.push(routes.formBuilder(formId));
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <>
          <PageHeader>
            <ContentHeader
              description="建立表單定義、管理草稿與已發布版本，提供流程模板綁定使用。"
              title="表單設計"
            >
              <Button
                disabled={creating}
                icon={PlusIcon}
                iconType="leading"
                onClick={(): void => setCreateModalOpen(true)}
                variant="base-primary"
              >
                建立表單
              </Button>
            </ContentHeader>
          </PageHeader>

          <SectionGroup>
            <Section
              tab={
                <Tab
                  activeKey={formStatus}
                  onChange={(activeKey): void => {
                    setFormStatus(readFormStatusTabKey(activeKey));
                    setFormPage(1);
                  }}
                >
                  {FORM_STATUS_TABS.map((statusTab) => (
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
                columns={columns}
                actions={tableActions}
                dataSource={rows}
                fullWidth
                loading={loading}
                pagination={{
                  current: formPage,
                  onChange: (page): void => {
                    setFormPage(page);
                  },
                  onChangePageSize: (pageSize): void => {
                    setFormPage(1);
                    setFormPageSize(pageSize);
                  },
                  pageSize: formPageSize,
                  pageSizeLabel: '每頁筆數',
                  pageSizeOptions: FORM_PAGE_SIZE_OPTIONS,
                  renderResultSummary: (from, to, total): string =>
                    `顯示 ${from}-${to} 筆，共 ${total} 筆`,
                  showPageSizeOptions: true,
                  total: formTotalCount,
                }}
              />
            </Section>
          </SectionGroup>
        </>

      <FormNameModal
        confirmText="建立"
        initialName=""
        loading={creating}
        onClose={(): void => setCreateModalOpen(false)}
        onSubmit={handleCreateForm}
        open={createModalOpen}
        title="建立表單"
      />
    </>
  );
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '發生未知錯誤';
}

function FormStatusBadge({
  status,
}: {
  readonly status: FormDefinitionListStatus;
}): ReactElement {
  if (status === 'PUBLISHED') {
    return <Badge size="sub" text="已發布" variant="dot-success" />;
  }

  return <Badge size="sub" text="草稿" variant="dot-warning" />;
}

function readFormStatusTabKey(activeKey: Key): FormStatusTabKey {
  if (activeKey === 'PUBLISHED' || activeKey === 'DRAFT') {
    return activeKey;
  }

  return 'ALL';
}

function CurrentVersionLabel({
  record,
}: {
  readonly record: FormDefinitionRow;
}): ReactElement {
  if (!record.currentVersionId || !record.currentVersionNumber) {
    return <Typography variant="body">尚未發布</Typography>;
  }

  const versionTime =
    record.currentVersionPublishedAt ?? record.currentVersionCreatedAt;

  return (
    <Typography variant="body">
      v{record.currentVersionNumber}
      {versionTime ? ` · ${formatDateTime(versionTime)}` : ''}
    </Typography>
  );
}
