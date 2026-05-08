'use client';

import { ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import {
  BaseCard,
  Button,
  CardGroup,
  Layout,
  PageHeader,
  QuickActionCard,
  Section,
  SectionGroup,
  Typography,
} from '@mezzanine-ui/react';
import ContentHeader from '@mezzanine-ui/react/ContentHeader';
import {
  CalendarTimeIcon,
  FileIcon,
  FolderIcon,
  PlusIcon,
  SettingIcon,
} from '@mezzanine-ui/icons';
import { renderAppNavigation } from './app-navigation';

interface Metric {
  readonly label: string;
  readonly value: string;
}

const metrics: readonly Metric[] = [
  { label: '今日待簽', value: '0' },
  { label: '進行中流程', value: '0' },
  { label: '模板版本', value: 'M0' },
];

export default function Page(): ReactElement {
  const router = useRouter();

  return (
    <Layout>
      {renderAppNavigation('/')}

      <Layout.Main>
        <PageHeader>
          <ContentHeader
            description="查看待簽任務、發起新的簽核案件，並追蹤流程運作狀態。"
            title="工作台"
          >
            <Button
              icon={PlusIcon}
              iconType="leading"
              onClick={(): void => router.push('/instances/new')}
              variant="base-primary"
            >
              發起簽核
            </Button>
          </ContentHeader>
        </PageHeader>

        <SectionGroup>
          <Section>
            <CardGroup>
              {metrics.map((metric) => (
                <BaseCard
                  description={metric.value}
                  key={metric.label}
                  title={metric.label}
                >
                  <Typography variant="caption" color="text-neutral">
                    系統摘要
                  </Typography>
                </BaseCard>
              ))}
            </CardGroup>
          </Section>

          <Section>
            <Typography variant="h3" component="h2">
              M0 Workspace
            </Typography>
            <Typography variant="body" color="text-neutral">
              後續 M1 可從 Identity、Organization、Form、Template
              四個模組往下展開。
            </Typography>

            <CardGroup>
              <QuickActionCard
                icon={CalendarTimeIcon}
                readOnly
                subtitle="NestJS Code-First endpoint"
                title="GraphQL API"
              />
              <QuickActionCard
                icon={FolderIcon}
                readOnly
                subtitle="PostgreSQL migration source"
                title="TypeORM Migrations"
              />
              <QuickActionCard
                icon={FileIcon}
                readOnly
                subtitle="Workflow and form contracts"
                title="Workflow Types"
              />
              <QuickActionCard
                icon={SettingIcon}
                readOnly
                subtitle="Backoffice design system"
                title="Mezzanine Shell"
              />
            </CardGroup>
          </Section>
        </SectionGroup>
      </Layout.Main>
    </Layout>
  );
}
