'use client';

import {
  CSSProperties,
  ReactElement,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  Button,
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
import {
  focusFormRendererField,
  FormRendererValues,
  validateFormRendererValues,
} from '@rytass/bpm-core-client/form';
import {
  LaunchContext,
  LaunchableTemplateRecord,
  listLaunchableTemplates,
  readFormDataCaseTitle,
  readLaunchContext,
  submitApprovalInstance,
  uploadAttachment,
} from '@rytass/bpm-core-client/workflow';
import { formatDateTime } from '../../../lib/format-date-time';
import { useAuth } from '../../../lib/auth-provider';
import { useRouterAdapter } from '../../../lib/router-adapter';
import { useBPMRoutes } from '../../../lib/routes-config';
import { FormRenderer } from '../../forms/renderer/FormRendererView';
import {
  isFormDataSourceFieldSubmissionBlocked,
  type FormDataSourceFieldState,
} from '../../forms/renderer/form-data-source-field';

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

export interface InstanceNewViewProps {
  /**
   * Optional template id pre-selected by the host. The Server Component
   * page should read `?templateId=` from its `searchParams` and pass the
   * value through this prop.
   */
  readonly templateId?: string | null;
}

/**
 * Framework-agnostic view for the BPM "發起簽核" launch page. Mechanical port
 * of `apps/client/src/app/instances/new/page.tsx` — picks a launchable
 * template and submits the launch form.
 */
export function InstanceNewView(
  props: InstanceNewViewProps = {},
): ReactElement {
  return (
    <Suspense fallback={<NewApprovalInstanceLoading />}>
      <NewApprovalInstanceContent templateId={props.templateId ?? undefined} />
    </Suspense>
  );
}

function NewApprovalInstanceContent({
  templateId: templateIdProp,
}: {
  readonly templateId?: string;
}): ReactElement {
  const router = useRouterAdapter();
  const routes = useBPMRoutes();
  const { member } = useAuth();
  const currentMemberId = member?.memberId ?? null;
  const templateId = templateIdProp ?? null;
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
  const [dataSourceStates, setDataSourceStates] = useState<
    Readonly<
      Record<string, Pick<FormDataSourceFieldState, 'hasValue' | 'status'>>
    >
  >({});

  const handleDataSourceStateChange = useCallback(
    (
      fieldKey: string,
      state: Pick<
        FormDataSourceFieldState,
        'hasValue' | 'invalidValues' | 'status'
      >,
    ): void => {
      setDataSourceStates((currentStates) => {
        const currentState = currentStates[fieldKey];

        if (
          currentState?.hasValue === state.hasValue &&
          currentState.status === state.status
        ) {
          return currentStates;
        }

        return {
          ...currentStates,
          [fieldKey]: {
            hasValue: state.hasValue,
            status: state.status,
          },
        };
      });
    },
    [],
  );

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
            router.push(routes.caseNew(record.id)),
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
    setDataSourceStates({});

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
    setDataSourceStates({});

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

    if (
      Object.values(dataSourceStates).some(
        isFormDataSourceFieldSubmissionBlocked,
      )
    ) {
      setError('請先完成動態選項驗證。');
      setSubmitting(false);

      return;
    }

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

      router.push(routes.caseDetail(instanceId));
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
    <>
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
                  dataSourceContext={{
                    kind: 'runtime',
                    templateId: context.template.id,
                  }}
                  errors={formErrors}
                  maxWidth={480}
                  onChange={(values): void => {
                    setFormValues(values);
                    setFormErrors({});
                  }}
                  onDataSourceStateChange={handleDataSourceStateChange}
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
      </>
  );
}

function NewApprovalInstanceLoading(): ReactElement {
  return (
    <>
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
      </>
  );
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '發生未知錯誤';
}
