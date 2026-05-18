'use client';

import {
  CSSProperties,
  ReactElement,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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
import { CheckedIcon } from '@mezzanine-ui/icons';
import type { TableActions, TableColumn } from '@mezzanine-ui/core/table';
import { FormFieldDefinition } from '@rytass/bpm-core-shared/form';
import { formatDateTime } from '../../_lib/date-time';
import { useAuth } from '../../auth-provider';
import { renderAppNavigation } from '../../app-navigation';
import { FormRenderer } from '../../forms/_components/form-renderer';
import {
  focusFormRendererField,
  FormRendererValues,
  validateFormRendererValues,
} from '../../forms/_lib/form-rendering';
import {
  LaunchContext,
  LaunchableTemplateRecord,
  listLaunchableTemplates,
  readFormDataCaseTitle,
  readLaunchContext,
  submitApprovalInstance,
  uploadAttachment,
} from '../_lib/workflow-api';

const FORM_SECTION_STYLE: CSSProperties = {
  display: 'grid',
  gap: 16,
};

type LaunchableTemplateRow = Readonly<
  Record<string, unknown> &
    LaunchableTemplateRecord & {
      key: string;
      versionLabel: string;
    }
>;

export default function NewApprovalInstancePage(): ReactElement {
  return (
    <Suspense fallback={<NewApprovalInstanceLoading />}>
      <NewApprovalInstanceContent />
    </Suspense>
  );
}

function NewApprovalInstanceContent(): ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { member } = useAuth();
  const currentMemberId = member?.memberId ?? null;
  const templateId = searchParams.get('templateId');
  const [context, setContext] = useState<LaunchContext | null>(null);
  const [formValues, setFormValues] = useState<FormRendererValues>({});
  const [templates, setTemplates] = useState<
    readonly LaunchableTemplateRecord[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<
    Readonly<Record<string, string>>
  >({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect((): void => {
    if (!templateId) {
      void refreshTemplates();

      return;
    }

    void refreshContext(templateId);
  }, [templateId]);

  const rows = useMemo(
    (): LaunchableTemplateRow[] =>
      templates.map((template) => ({
        ...template,
        key: template.id,
        updatedAt: formatDateTime(template.updatedAt),
        versionLabel: `v${template.version}`,
      })),
    [templates],
  );
  const columns = useMemo(
    (): TableColumn<LaunchableTemplateRow>[] => [
      { dataIndex: 'name', key: 'name', title: '模板名稱', width: 240 },
      {
        dataIndex: 'versionLabel',
        key: 'versionLabel',
        title: '發布版本',
        width: 120,
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
    (): TableActions<LaunchableTemplateRow> => ({
      render: (
        record,
      ): ReturnType<TableActions<LaunchableTemplateRow>['render']> => [
        {
          name: '發起',
          onClick: (): void =>
            router.push(`/instances/new?templateId=${record.id}`),
          variant: 'base-primary',
        },
      ],
      variant: 'base-secondary',
      width: 88,
    }),
    [router],
  );

  async function refreshTemplates(): Promise<void> {
    setLoading(true);
    setError(null);
    setContext(null);

    try {
      setTemplates(await listLaunchableTemplates());
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  async function refreshContext(nextTemplateId: string): Promise<void> {
    setLoading(true);
    setError(null);
    setTemplates([]);

    try {
      setContext(await readLaunchContext(nextTemplateId));
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(): Promise<void> {
    if (!context || !currentMemberId) {
      return;
    }

    setSubmitting(true);
    setError(null);
    setFormErrors({});

    const validation = validateFormRendererValues({
      schema: context.formVersion.schema,
      uiSchema: context.formVersion.uiSchema,
      values: formValues,
    });

    if (!validation.valid) {
      setFormErrors(validation.errors);
      setError('請先補齊必填欄位。');

      if (validation.firstInvalidFieldKey) {
        focusFormRendererField(validation.firstInvalidFieldKey);
      }

      setSubmitting(false);

      return;
    }

    try {
      const instanceId = await submitApprovalInstance({
        formData: formValues,
        initiatorMemberId: currentMemberId,
        templateId: context.template.id,
        title: readFormDataCaseTitle({
          fallbackTitle: context.template.name,
          formData: formValues,
          schema: context.formVersion.schema,
          uiSchema: context.formVersion.uiSchema,
        }),
      });

      router.push(`/instances/${instanceId}`);
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUploadAttachment(
    field: FormFieldDefinition,
    file: File,
  ): Promise<{ readonly id: string }> {
    if (!currentMemberId) {
      throw new Error('尚未登入，無法上傳附件');
    }

    const attachment = await uploadAttachment({
      file,
      formFieldPath: `form.${field.fieldKey}`,
    });

    return { id: attachment.id };
  }

  return (
    <Layout>
      {renderAppNavigation('/')}

      <Layout.Main>
        <PageHeader>
          <ContentHeader
            description={
              context
                ? `${context.template.name} · 表單 v${context.formVersion.version}`
                : '選擇可發起的已發布模板後填寫表單內容。'
            }
            title="發起簽核"
          >
            {context ? (
              <Button
                disabled={loading || submitting}
                icon={CheckedIcon}
                iconType="leading"
                onClick={handleSubmit}
                variant="base-primary"
              >
                送出
              </Button>
            ) : null}
          </ContentHeader>
        </PageHeader>

        <SectionGroup>
          <Section>
            <div style={FORM_SECTION_STYLE}>
              {error ? (
                <Typography color="text-error" variant="body">
                  {error}
                </Typography>
              ) : null}

              {loading ? (
                <Typography color="text-neutral" variant="body">
                  載入中...
                </Typography>
              ) : null}

              {context ? (
                <FormRenderer
                  errors={formErrors}
                  maxWidth={480}
                  onChange={(values): void => {
                    setFormValues(values);
                    setFormErrors({});
                  }}
                  onUploadAttachment={handleUploadAttachment}
                  schema={context.formVersion.schema}
                  singleColumn
                  uiSchema={context.formVersion.uiSchema}
                  value={formValues}
                />
              ) : null}

              {!templateId && !loading ? (
                rows.length > 0 ? (
                  <Table
                    actions={tableActions}
                    columns={columns}
                    dataSource={rows}
                    fullWidth
                  />
                ) : (
                  <Typography color="text-neutral" variant="body">
                    目前沒有可發起的已發布模板。
                  </Typography>
                )
              ) : null}
            </div>
          </Section>
        </SectionGroup>
      </Layout.Main>
    </Layout>
  );
}

function NewApprovalInstanceLoading(): ReactElement {
  return (
    <Layout>
      {renderAppNavigation('/')}

      <Layout.Main>
        <PageHeader>
          <ContentHeader
            description="選擇可發起的已發布模板後填寫表單內容。"
            title="發起簽核"
          />
        </PageHeader>

        <SectionGroup>
          <Section>
            <Typography color="text-neutral" variant="body">
              載入中...
            </Typography>
          </Section>
        </SectionGroup>
      </Layout.Main>
    </Layout>
  );
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '發生未知錯誤';
}
