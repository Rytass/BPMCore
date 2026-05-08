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
import {
  createFormDefinition,
  FormDefinitionRecord,
  listFormDefinitions,
} from './_lib/form-api';
import { FormNameModal } from './_components/form-name-modal';

type FormDefinitionRow = Readonly<
  Record<string, unknown> &
    FormDefinitionRecord & {
      key: string;
      status: string;
    }
>;

export default function FormsPage(): ReactElement {
  const router = useRouter();
  const [forms, setForms] = useState<readonly FormDefinitionRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect((): void => {
    void refreshForms();
  }, []);

  const rows = useMemo(
    (): FormDefinitionRow[] =>
      forms.map((form) => ({
        ...form,
        key: form.id,
        status: form.currentVersionId ? '已發布' : '草稿',
        updatedAt: formatDateTime(form.updatedAt),
      })),
    [forms],
  );
  const columns = useMemo(
    (): TableColumn<FormDefinitionRow>[] => [
      { dataIndex: 'name', key: 'name', title: '表單名稱', width: 220 },
      { dataIndex: 'status', key: 'status', title: '狀態', width: 120 },
      {
        key: 'currentVersionId',
        render: (record: FormDefinitionRow): ReactElement => (
          <Typography variant="body">
            {record.currentVersionId ?? '尚未發布'}
          </Typography>
        ),
        title: '目前版本',
        width: 260,
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
    (): TableActions<FormDefinitionRow> => ({
      render: (
        record,
      ): ReturnType<TableActions<FormDefinitionRow>['render']> => [
        {
          name: '編輯',
          onClick: (): void => router.push(`/forms/${record.id}/builder`),
        },
      ],
      variant: 'base-secondary',
      width: 88,
    }),
    [router],
  );

  async function refreshForms(): Promise<void> {
    setLoading(true);
    setError(null);

    try {
      setForms(await listFormDefinitions());
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateForm(name: string): Promise<void> {
    setCreating(true);
    setError(null);

    try {
      const formId = await createFormDefinition(name);
      setCreateModalOpen(false);
      router.push(`/forms/${formId}/builder`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <Layout>
        {renderAppNavigation('/forms')}

        <Layout.Main>
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
            <Section>
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
              />
            </Section>
          </SectionGroup>
        </Layout.Main>
      </Layout>

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
