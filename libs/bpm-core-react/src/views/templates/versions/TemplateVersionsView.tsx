'use client';

import { ReactElement, useEffect, useMemo, useState } from 'react';
import {
  Button,
  PageHeader,
  Section,
  SectionGroup,
  Table,
  Typography,
} from '@mezzanine-ui/react';
import ContentHeader from '@mezzanine-ui/react/ContentHeader';
import type { TableActions, TableColumn } from '@mezzanine-ui/core/table';
import { AppLayout } from '../../../components/app-navigation';
import { useRouterAdapter } from '../../../lib/router-adapter';
import {
  readTemplateDesigner,
  rollbackApprovalTemplateVersion,
  TemplateDesignerRecord,
} from '@rytass/bpm-core-client/template';
import { formatDateTime } from '../../../lib/format-date-time';

type VersionRow = Readonly<
  Record<string, unknown> & {
    formVersion: string;
    key: string;
    publishedAt: string;
    status: string;
    updatedAt: string;
    version: string;
    versionId: string;
  }
>;

export interface TemplateVersionsViewProps {
  readonly templateId: string;
  readonly activeHref?: string;
}

export function TemplateVersionsView({
  templateId,
  activeHref = '/templates',
}: TemplateVersionsViewProps): ReactElement {
  const router = useRouterAdapter();
  const [record, setRecord] = useState<TemplateDesignerRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rollingBack, setRollingBack] = useState(false);

  useEffect((): void => {
    void refreshVersions();
  }, [templateId]);

  const rows = useMemo(
    (): VersionRow[] =>
      (record?.versions ?? []).map((version) => ({
        formVersion:
          record?.formVersions.find(
            (formVersion) => formVersion.id === version.formDefinitionVersionId,
          )?.label ?? '未綁定',
        key: version.id,
        publishedAt: formatDateTime(version.publishedAt),
        status: version.status,
        updatedAt: formatDateTime(version.updatedAt),
        version: `v${version.version}`,
        versionId: version.id,
      })),
    [record],
  );
  const columns = useMemo(
    (): TableColumn<VersionRow>[] => [
      { dataIndex: 'version', key: 'version', title: '版本', width: 100 },
      { dataIndex: 'status', key: 'status', title: '狀態', width: 140 },
      {
        dataIndex: 'formVersion',
        key: 'formVersion',
        title: '表單版本',
        width: 220,
      },
      {
        dataIndex: 'publishedAt',
        key: 'publishedAt',
        title: '發布時間',
        width: 200,
      },
      {
        dataIndex: 'updatedAt',
        key: 'updatedAt',
        title: '更新時間',
        width: 200,
      },
    ],
    [],
  );
  const actions = useMemo(
    (): TableActions<VersionRow> => ({
      render: (row): ReturnType<TableActions<VersionRow>['render']> => [
        {
          disabled: (): boolean => rollingBack || row.status === 'DRAFT',
          name: 'Rollback',
          onClick: (): void => void handleRollback(row.versionId),
        },
      ],
      variant: 'base-secondary',
      width: 104,
    }),
    [rollingBack],
  );

  async function refreshVersions(): Promise<void> {
    setLoading(true);
    setError(null);

    try {
      setRecord(await readTemplateDesigner(templateId));
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  async function handleRollback(versionId: string): Promise<void> {
    setRollingBack(true);
    setError(null);

    try {
      await rollbackApprovalTemplateVersion(versionId);
      await refreshVersions();
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setRollingBack(false);
    }
  }

  return (
    <AppLayout activeHref={activeHref}>
        <PageHeader>
          <ContentHeader
            description="查看發布、歸檔與 rollback 狀態。"
            title={record?.template.name ?? '模板版本'}
          >
            <Button
              onClick={(): void =>
                router.push(`/templates/${templateId}/designer`)
              }
              variant="base-secondary"
            >
              回設計器
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
              actions={actions}
              columns={columns}
              dataSource={rows}
              fullWidth
              loading={loading}
            />
          </Section>
        </SectionGroup>
      </AppLayout>
  );
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '發生未知錯誤';
}
