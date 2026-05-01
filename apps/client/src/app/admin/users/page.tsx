'use client';

import { ReactElement } from 'react';
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
import { SearchIcon } from '@mezzanine-ui/icons';
import type { TableColumn } from '@mezzanine-ui/core/table';
import { renderAppNavigation } from '../../app-navigation';

type MemberRow = Readonly<
  Record<string, unknown> & {
    email: string;
    key: string;
    memberId: string;
    name: string;
    orgUnit: string;
    position: string;
  }
>;

const members: MemberRow[] = [
  {
    email: 'lin.ceo@example.internal',
    key: 'member-001',
    memberId: 'member-001',
    name: '林執行長',
    orgUnit: 'BPM-HQ',
    position: '未綁定',
  },
  {
    email: 'chen.manager@example.internal',
    key: 'member-101',
    memberId: 'member-101',
    name: '陳財務主管',
    orgUnit: 'FIN-TW',
    position: '未綁定',
  },
  {
    email: 'wu.staff@example.internal',
    key: 'member-102',
    memberId: 'member-102',
    name: '吳財務專員',
    orgUnit: 'FIN-TW',
    position: '未綁定',
  },
];

const memberColumns: TableColumn<MemberRow>[] = [
  { dataIndex: 'memberId', key: 'memberId', title: 'Member ID', width: 180 },
  { dataIndex: 'name', key: 'name', title: '姓名', width: 160 },
  { dataIndex: 'email', key: 'email', title: 'Email', width: 260 },
  { dataIndex: 'orgUnit', key: 'orgUnit', title: '主要組織', width: 160 },
  { dataIndex: 'position', key: 'position', title: '職位', width: 160 },
];

export default function AdminUsersPage(): ReactElement {
  return (
    <Layout>
      {renderAppNavigation('/admin/users')}

      <Layout.Main>
        <PageHeader>
          <ContentHeader
            description="會員資料由 MemberResolver 解析，系統只快取 metadata 與 member_id。"
            title="會員對照"
          >
            <Button
              icon={SearchIcon}
              iconType="leading"
              variant="base-secondary"
            >
              查詢 member_id
            </Button>
          </ContentHeader>
        </PageHeader>

        <SectionGroup>
          <Section>
            <Typography variant="h3" component="h2">
              Local mock resolver
            </Typography>
            <Typography variant="body" color="text-neutral">
              M1 W1 開發用名單，之後可替換成外部 SSO / HR resolver。
            </Typography>
            <Table columns={memberColumns} dataSource={members} fullWidth />
          </Section>
        </SectionGroup>
      </Layout.Main>
    </Layout>
  );
}
