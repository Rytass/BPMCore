'use client';

import { ReactElement } from 'react';
import {
  BaseCard,
  Button,
  CardGroup,
  Layout,
  PageHeader,
  Section,
  SectionGroup,
  Table,
  Typography,
} from '@mezzanine-ui/react';
import ContentHeader from '@mezzanine-ui/react/ContentHeader';
import { PlusIcon } from '@mezzanine-ui/icons';
import type { TableColumn } from '@mezzanine-ui/core/table';
import { renderAppNavigation } from '../../app-navigation';

type OrgUnitRow = Readonly<
  Record<string, unknown> & {
    code: string;
    key: string;
    manager: string;
    name: string;
    path: string;
    type: string;
  }
>;

interface SummaryItem {
  readonly label: string;
  readonly value: string;
}

const orgUnits: OrgUnitRow[] = [
  {
    code: 'BPM-HQ',
    key: 'BPM-HQ',
    manager: 'member-001',
    name: '總管理處',
    path: 'org.n_root',
    type: 'company',
  },
  {
    code: 'FIN-TW',
    key: 'FIN-TW',
    manager: 'member-101',
    name: '財務部',
    path: 'org.n_root.n_fin',
    type: 'department',
  },
];

const orgUnitColumns: TableColumn<OrgUnitRow>[] = [
  { dataIndex: 'code', key: 'code', title: '代碼', width: 160 },
  { dataIndex: 'name', key: 'name', title: '名稱', width: 160 },
  { dataIndex: 'type', key: 'type', title: '類型', width: 160 },
  { dataIndex: 'path', key: 'path', title: 'Path', width: 220 },
  { dataIndex: 'manager', key: 'manager', title: '簽核主管', width: 180 },
];

const summaryItems: readonly SummaryItem[] = [
  { label: '組織節點', value: '2' },
  { label: '職位', value: '0' },
  { label: '主管規則', value: '2' },
];

export default function AdminOrgsPage(): ReactElement {
  return (
    <Layout>
      {renderAppNavigation('/admin/orgs')}

      <Layout.Main>
        <PageHeader>
          <ContentHeader
            description="M1 W1 基礎版：對齊 org_units、positions、memberships 與主管解析。"
            title="組織管理"
          >
            <Button icon={PlusIcon} iconType="leading" variant="base-primary">
              新增組織
            </Button>
          </ContentHeader>
        </PageHeader>

        <SectionGroup>
          <Section>
            <CardGroup>
              {summaryItems.map((item) => (
                <BaseCard
                  description={item.value}
                  key={item.label}
                  title={item.label}
                >
                  <Typography variant="caption" color="text-neutral">
                    組織摘要
                  </Typography>
                </BaseCard>
              ))}
            </CardGroup>
          </Section>

          <Section>
            <Typography variant="h3" component="h2">
              組織樹
            </Typography>
            <Typography variant="body" color="text-neutral">
              後端 GraphQL CRUD 已提供，前端下一步接入查詢與表單。
            </Typography>
            <Table columns={orgUnitColumns} dataSource={orgUnits} fullWidth />
          </Section>
        </SectionGroup>
      </Layout.Main>
    </Layout>
  );
}
