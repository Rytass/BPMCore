'use client';

import { ReactElement, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  Layout,
  PageHeader,
  Section,
  SectionGroup,
  Table,
  Typography,
} from '@mezzanine-ui/react';
import ContentHeader from '@mezzanine-ui/react/ContentHeader';
import { PlusIcon } from '@mezzanine-ui/icons';
import type { TableActions, TableColumn } from '@mezzanine-ui/core/table';
import { formatDateTime } from '../_lib/date-time';
import { renderAppNavigation } from '../app-navigation';
import { TemplateNameModal } from './_components/template-name-modal';
import {
  ApprovalTemplateRecord,
  createApprovalTemplate,
  listApprovalTemplates,
} from './_lib/template-api';
import { listLaunchableTemplates } from '../instances/_lib/workflow-api';

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

  useEffect((): void => {
    void refreshTemplates();
  }, []);

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

  async function refreshTemplates(): Promise<void> {
    setLoading(true);
    setError(null);

    try {
      const [nextTemplates, nextLaunchableTemplates] = await Promise.all([
        listApprovalTemplates(),
        listLaunchableTemplates(),
      ]);

      setTemplates(nextTemplates);
      setLaunchableTemplateIds(
        new Set(nextLaunchableTemplates.map((template) => template.id)),
      );
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

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
