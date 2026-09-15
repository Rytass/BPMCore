'use client';

import {
  ChangeEvent,
  CSSProperties,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  Badge,
  Button,
  Input,
  Modal,
  PageHeader,
  Section,
  SectionGroup,
  Select,
  Table,
  Textarea,
  Toggle,
  Typography,
} from '@mezzanine-ui/react';
import ContentHeader from '@mezzanine-ui/react/ContentHeader';
import { PlusIcon, TrashIcon } from '@mezzanine-ui/icons';
import type { TableActions, TableColumn } from '@mezzanine-ui/core/table';
import { NotifyWebhookParameterType } from '@rytass/bpm-core-shared/workflow';
import {
  WorkflowWebhookEndpointAuditRecord,
  WorkflowWebhookEndpointManagementRecord,
  WorkflowWebhookEndpointTestResultRecord,
  WorkflowWebhookManagedEndpointRecord,
  createWorkflowWebhookEndpoint,
  listWorkflowWebhookEndpointAudits,
  listWorkflowWebhookManagedEndpoints,
  readWorkflowWebhookEndpointManagement,
  rotateWorkflowWebhookEndpointSecret,
  setWorkflowWebhookEndpointActive,
  testWorkflowWebhookEndpoint,
  updateWorkflowWebhookEndpoint,
} from '@rytass/bpm-core-client/template';
import { BPMFormField } from '../../../components/bpm-form-field';
import { formatDateTime } from '../../../lib/format-date-time';

type SelectOption = Readonly<{ id: string; name: string }>;

type EndpointRow = Readonly<
  Record<string, unknown> & {
    endpoint: WorkflowWebhookManagedEndpointRecord;
    key: string;
  }
>;

type AuditRow = Readonly<
  Record<string, unknown> & {
    audit: WorkflowWebhookEndpointAuditRecord;
    key: string;
  }
>;

type ParameterDraft = Readonly<{
  description: string;
  key: string;
  label: string;
  required: boolean;
  type: NotifyWebhookParameterType;
}>;

type HeaderDraft = Readonly<{ name: string; value: string }>;

/**
 * `mode` decides what can change: a new endpoint (or a new version of one)
 * sets everything; editing keeps the parameter contract and only replaces
 * headers when asked to.
 */
type EndpointDraft = Readonly<{
  deprecated: boolean;
  description: string;
  endpointId: string | null;
  headers: readonly HeaderDraft[];
  key: string;
  label: string;
  method: string;
  mode: 'create' | 'edit' | 'version';
  /** The stored URL when editing, to spot a move to another host. */
  originalUrl: string;
  parameters: readonly ParameterDraft[];
  replaceHeaders: boolean;
  signingSecret: string;
  timeoutMs: string;
  url: string;
  version: string;
}>;

const STACK_STYLE: CSSProperties = {
  display: 'grid',
  gap: 'var(--mzn-spacing-gap-base)',
};

const ROW_STYLE: CSSProperties = {
  alignItems: 'center',
  display: 'grid',
  gap: 'var(--mzn-spacing-gap-base)',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) auto auto',
};

const HEADER_ROW_STYLE: CSSProperties = {
  alignItems: 'center',
  display: 'grid',
  gap: 'var(--mzn-spacing-gap-base)',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr) auto',
};

const METHOD_OPTIONS: readonly SelectOption[] = [
  { id: 'POST', name: 'POST' },
  { id: 'PUT', name: 'PUT' },
  { id: 'PATCH', name: 'PATCH' },
];

const PARAMETER_TYPE_OPTIONS: readonly SelectOption[] = [
  { id: 'string', name: '文字' },
  { id: 'number', name: '數字' },
  { id: 'boolean', name: '是／否' },
  { id: 'stringArray', name: '文字清單' },
  { id: 'json', name: 'JSON' },
];

const AUDIT_ACTION_LABELS: Readonly<
  Record<WorkflowWebhookEndpointAuditRecord['action'], string>
> = {
  CREATED: '建立',
  DISABLED: '停用',
  ENABLED: '啟用',
  SECRET_ROTATED: '輪替金鑰',
  TEST_SENT: '測試送出',
  UPDATED: '更新',
};

const EMPTY_DRAFT: EndpointDraft = {
  deprecated: false,
  description: '',
  endpointId: null,
  headers: [],
  key: '',
  label: '',
  method: 'POST',
  mode: 'create',
  originalUrl: '',
  parameters: [],
  replaceHeaders: true,
  signingSecret: '',
  timeoutMs: '',
  url: '',
  version: '1',
};

/**
 * Back-office management of database webhook endpoints (ADR 18 §3.13):
 * create, edit, disable, rotate the signing secret, test-send and read the
 * change history. Header values and secrets are entered here and never shown
 * again. Administrator-only on the server.
 */
export function AdminWebhookEndpointsView(): ReactElement {
  const [management, setManagement] =
    useState<WorkflowWebhookEndpointManagementRecord | null>(null);
  const [endpoints, setEndpoints] = useState<
    readonly WorkflowWebhookManagedEndpointRecord[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<EndpointDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [rotating, setRotating] =
    useState<WorkflowWebhookManagedEndpointRecord | null>(null);
  const [nextSecret, setNextSecret] = useState('');
  const [removeSecret, setRemoveSecret] = useState(false);
  const [audits, setAudits] = useState<{
    readonly endpoint: WorkflowWebhookManagedEndpointRecord;
    readonly records: readonly WorkflowWebhookEndpointAuditRecord[];
  } | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);

    try {
      const nextManagement = await readWorkflowWebhookEndpointManagement();

      setManagement(nextManagement);
      setEndpoints(
        nextManagement.enabled
          ? await listWorkflowWebhookManagedEndpoints()
          : [],
      );
      setError(null);
    } catch (requestError: unknown) {
      setError(readErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect((): void => {
    void refresh();
  }, [refresh]);

  const run = useCallback(
    async (work: () => Promise<string | null>): Promise<boolean> => {
      setError(null);
      setNotice(null);

      try {
        setNotice(await work());
        await refresh();

        return true;
      } catch (requestError: unknown) {
        setError(readErrorMessage(requestError));

        return false;
      }
    },
    [refresh],
  );

  const rows = useMemo(
    (): EndpointRow[] =>
      endpoints.map((endpoint) => ({ endpoint, key: endpoint.id })),
    [endpoints],
  );

  const columns = useMemo(
    (): TableColumn<EndpointRow>[] => [
      {
        key: 'label',
        render: ({ endpoint }: EndpointRow): ReactElement => (
          <div style={STACK_STYLE}>
            <Typography component="span" variant="body">
              {endpoint.label}
            </Typography>
            <Typography color="text-neutral" component="span" variant="caption">
              {endpoint.key}@{endpoint.version} · 參數{' '}
              {endpoint.parameters.length} 個
            </Typography>
          </div>
        ),
        title: '端點',
        width: 240,
      },
      {
        key: 'url',
        render: ({ endpoint }: EndpointRow): ReactElement => (
          <Typography component="span" variant="body">
            {endpoint.method} {endpoint.url}
          </Typography>
        ),
        title: 'URL',
        width: 320,
      },
      {
        key: 'status',
        render: ({ endpoint }: EndpointRow): ReactElement =>
          !endpoint.active ? (
            <Badge size="sub" text="已停用" variant="dot-inactive" />
          ) : endpoint.deprecated ? (
            <Badge size="sub" text="不建議使用" variant="dot-warning" />
          ) : (
            <Badge size="sub" text="啟用中" variant="dot-success" />
          ),
        title: '狀態',
        width: 120,
      },
      {
        key: 'credentials',
        render: ({ endpoint }: EndpointRow): ReactElement => (
          <div style={STACK_STYLE}>
            <Typography component="span" variant="body">
              {endpoint.hasSigningSecret ? '已設定簽章金鑰' : '未簽章'}
            </Typography>
            <Typography color="text-neutral" component="span" variant="caption">
              {endpoint.headerNames.length
                ? `Header：${endpoint.headerNames.join('、')}`
                : '沒有自訂 header'}
            </Typography>
          </div>
        ),
        title: '憑證',
        width: 200,
      },
      {
        key: 'updatedAt',
        render: ({ endpoint }: EndpointRow): ReactElement => (
          <Typography component="span" variant="body">
            {formatDateTime(endpoint.updatedAt)}
          </Typography>
        ),
        title: '更新時間',
        width: 180,
      },
    ],
    [],
  );

  const actions = useMemo(
    (): TableActions<EndpointRow> => ({
      render: ({
        endpoint,
      }): ReturnType<TableActions<EndpointRow>['render']> => [
        {
          name: '編輯',
          onClick: (): void => setDraft(readEditDraft(endpoint, 'edit')),
        },
        {
          name: '建立新版本',
          onClick: (): void => setDraft(readEditDraft(endpoint, 'version')),
        },
        {
          name: '測試送出',
          onClick: (): void => {
            void run(async () =>
              readTestNotice(
                endpoint,
                await testWorkflowWebhookEndpoint(endpoint.id),
              ),
            );
          },
        },
        {
          name: '輪替金鑰',
          onClick: (): void => {
            setNextSecret('');
            setRemoveSecret(false);
            setRotating(endpoint);
          },
        },
        {
          name: endpoint.active ? '停用' : '啟用',
          onClick: (): void => {
            void run(async () => {
              await setWorkflowWebhookEndpointActive(
                endpoint.id,
                !endpoint.active,
              );

              return `已${endpoint.active ? '停用' : '啟用'}「${endpoint.label}」。`;
            });
          },
        },
        {
          name: '異動紀錄',
          onClick: (): void => {
            void listWorkflowWebhookEndpointAudits(endpoint.id)
              .then((records): void => setAudits({ endpoint, records }))
              .catch((requestError: unknown): void =>
                setError(readErrorMessage(requestError)),
              );
          },
        },
      ],
      variant: 'base-secondary',
      width: 180,
    }),
    [run],
  );

  async function handleSaveDraft(): Promise<void> {
    if (!draft) {
      return;
    }

    setSaving(true);

    const saved = await run(async () => {
      const parameters = draft.parameters.map((parameter) => ({
        description: parameter.description.trim() || null,
        key: parameter.key.trim(),
        label: parameter.label.trim(),
        required: parameter.required,
        type: parameter.type,
      }));
      const headers = draft.headers
        .filter((header) => header.name.trim())
        .map((header) => ({ name: header.name.trim(), value: header.value }));
      const timeoutMs = draft.timeoutMs.trim() ? Number(draft.timeoutMs) : null;

      if (draft.mode === 'edit' && draft.endpointId) {
        await updateWorkflowWebhookEndpoint({
          deprecated: draft.deprecated,
          description: draft.description,
          headers:
            draft.replaceHeaders || isOriginChanged(draft) ? headers : null,
          id: draft.endpointId,
          label: draft.label,
          method: draft.method,
          parameters,
          timeoutMs,
          url: draft.url,
        });

        return `已更新「${draft.label}」。`;
      }

      await createWorkflowWebhookEndpoint({
        deprecated: draft.deprecated,
        description: draft.description,
        headers,
        key: draft.key,
        label: draft.label,
        method: draft.method,
        parameters,
        signingSecret: draft.signingSecret || null,
        timeoutMs,
        url: draft.url,
        version: Number(draft.version),
      });

      return `已建立「${draft.label}」v${draft.version}，設計器現在可以選用。`;
    });

    setSaving(false);

    if (saved) {
      setDraft(null);
    }
  }

  async function handleRotate(): Promise<void> {
    if (!rotating) {
      return;
    }

    const endpoint = rotating;
    const done = await run(async () => {
      await rotateWorkflowWebhookEndpointSecret(
        endpoint.id,
        removeSecret ? null : nextSecret,
      );

      return removeSecret
        ? `已移除「${endpoint.label}」的簽章金鑰，之後的請求不再簽章。`
        : `已輪替「${endpoint.label}」的簽章金鑰，接收端需改用新金鑰驗簽。`;
    });

    if (done) {
      setRotating(null);
      setNextSecret('');
    }
  }

  const enabled = Boolean(management?.enabled);

  return (
    <>
      <PageHeader>
        <ContentHeader
          description="維護知會節點可呼叫的外部系統端點。Header 值與簽章金鑰加密保存，儲存後不會再顯示。"
          title="Webhook 端點"
        >
          <Button
            disabled={!enabled}
            icon={PlusIcon}
            iconType="leading"
            onClick={(): void => setDraft(EMPTY_DRAFT)}
            variant="base-primary"
          >
            新增端點
          </Button>
        </ContentHeader>
      </PageHeader>

      <SectionGroup>
        <Section>
          <div style={STACK_STYLE}>
            {error ? (
              <Typography color="text-error" variant="body">
                {error}
              </Typography>
            ) : null}
            {notice ? (
              <Typography color="text-success" variant="body">
                {notice}
              </Typography>
            ) : null}
            {management && !enabled ? (
              <Typography color="text-warning" variant="body">
                此伺服器未啟用後台維護的 Webhook 端點：需要設定
                workflowWebhookTargetSources 含 DATABASE、URL
                白名單與加密金鑰。程式註冊的端點不受影響。
              </Typography>
            ) : null}
            {enabled ? (
              <Typography color="text-neutral" variant="caption">
                允許的 URL：{management?.allowedUrlPatterns.join('、')}
              </Typography>
            ) : null}
            <Table
              actions={actions}
              columns={columns}
              dataSource={rows}
              fullWidth
              loading={loading}
            />
          </div>
        </Section>
      </SectionGroup>

      {draft ? (
        <EndpointDraftModal
          draft={draft}
          onCancel={(): void => setDraft(null)}
          onChange={setDraft}
          onConfirm={(): void => void handleSaveDraft()}
          saving={saving}
        />
      ) : null}

      <Modal
        cancelText="取消"
        confirmButtonProps={{ disabled: !removeSecret && !nextSecret }}
        confirmText={removeSecret ? '移除金鑰' : '輪替金鑰'}
        modalType="standard"
        onCancel={(): void => setRotating(null)}
        onClose={(): void => setRotating(null)}
        onConfirm={(): void => void handleRotate()}
        open={Boolean(rotating)}
        showModalFooter
        showModalHeader
        supportingText="新金鑰會加密保存，不會再顯示；請同時更新接收端的驗簽金鑰。"
        title={`輪替簽章金鑰：${rotating?.label ?? ''}`}
      >
        <div style={STACK_STYLE}>
          <BPMFormField label="移除金鑰" name="removeSigningSecret">
            <Toggle
              checked={removeSecret}
              onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                setRemoveSecret(event.target.checked)
              }
            />
          </BPMFormField>
          {removeSecret ? null : (
            <BPMFormField label="新金鑰" name="nextSigningSecret" required>
              <Input
                onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                  setNextSecret(event.target.value)
                }
                value={nextSecret}
                inputProps={{ autoComplete: 'new-password' }}
                variant="password"
              />
            </BPMFormField>
          )}
        </div>
      </Modal>

      <Modal
        confirmText="關閉"
        modalType="standard"
        onClose={(): void => setAudits(null)}
        onConfirm={(): void => setAudits(null)}
        open={Boolean(audits)}
        showModalFooter
        showModalHeader
        size="wide"
        supportingText="只記錄誰在何時變更了哪些欄位，不記錄任何值。"
        title={`異動紀錄：${audits?.endpoint.label ?? ''}`}
      >
        <Table
          columns={AUDIT_COLUMNS}
          dataSource={(audits?.records ?? []).map((audit): AuditRow => ({
            audit,
            key: audit.id,
          }))}
          fullWidth
        />
      </Modal>
    </>
  );
}

const AUDIT_COLUMNS: TableColumn<AuditRow>[] = [
  {
    key: 'createdAt',
    render: ({ audit }: AuditRow): ReactElement => (
      <Typography component="span" variant="body">
        {formatDateTime(audit.createdAt)}
      </Typography>
    ),
    title: '時間',
    width: 180,
  },
  {
    key: 'action',
    render: ({ audit }: AuditRow): ReactElement => (
      <Typography component="span" variant="body">
        {AUDIT_ACTION_LABELS[audit.action]}
      </Typography>
    ),
    title: '動作',
    width: 120,
  },
  {
    key: 'changedFields',
    render: ({ audit }: AuditRow): ReactElement => (
      <Typography component="span" variant="body">
        {audit.changedFields.join('、') || '—'}
      </Typography>
    ),
    title: '欄位',
    width: 280,
  },
  {
    key: 'actor',
    render: ({ audit }: AuditRow): ReactElement => (
      <Typography component="span" variant="body">
        {audit.actorMemberId ?? '系統'}
      </Typography>
    ),
    title: '操作者',
    width: 160,
  },
];

function EndpointDraftModal({
  draft,
  onCancel,
  onChange,
  onConfirm,
  saving,
}: {
  readonly draft: EndpointDraft;
  readonly onCancel: () => void;
  readonly onChange: (draft: EndpointDraft) => void;
  readonly onConfirm: () => void;
  readonly saving: boolean;
}): ReactElement {
  const editing = draft.mode === 'edit';
  // Stored header values must not follow the URL to another host, so a new
  // host always means entering the headers again.
  const originChanged = isOriginChanged(draft);
  const replaceHeaders = draft.replaceHeaders || originChanged;
  const update = (patch: Partial<EndpointDraft>): void =>
    onChange({ ...draft, ...patch });
  const updateParameter = (
    index: number,
    patch: Partial<ParameterDraft>,
  ): void =>
    update({
      parameters: draft.parameters.map((parameter, current) =>
        current === index ? { ...parameter, ...patch } : parameter,
      ),
    });
  const updateHeader = (index: number, patch: Partial<HeaderDraft>): void =>
    update({
      headers: draft.headers.map((header, current) =>
        current === index ? { ...header, ...patch } : header,
      ),
    });
  const text =
    (field: keyof EndpointDraft) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void =>
      update({ [field]: event.target.value });

  return (
    <Modal
      cancelText="取消"
      confirmText={editing ? '儲存' : '建立'}
      loading={saving}
      modalType="standard"
      onCancel={onCancel}
      onClose={onCancel}
      onConfirm={onConfirm}
      open
      showModalFooter
      showModalHeader
      size="wide"
      supportingText={
        editing
          ? '參數的鍵、型別與必填是這個版本的契約，無法修改；需要變更請建立新版本。'
          : draft.mode === 'version'
            ? '新版本可調整參數；既有模板仍使用舊版本，直到設計者改選。'
            : 'URL 需符合伺服器設定的白名單。'
      }
      title={
        editing
          ? `編輯端點：${draft.label}`
          : draft.mode === 'version'
            ? `建立新版本：${draft.key}`
            : '新增 Webhook 端點'
      }
    >
      <div style={STACK_STYLE}>
        <BPMFormField label="Key" name="endpointKey" required>
          <Input
            {...(draft.mode === 'create' ? {} : { readonly: true as const })}
            onChange={text('key')}
            placeholder="例如 crm.lead-created"
            value={draft.key}
            inputProps={{ autoComplete: 'off' }}
            variant="base"
          />
        </BPMFormField>
        <BPMFormField label="版本" name="endpointVersion" required>
          <Input
            {...(editing ? { readonly: true as const } : {})}
            inputProps={{ autoComplete: 'off', inputMode: 'numeric' }}
            onChange={text('version')}
            value={draft.version}
            variant="base"
          />
        </BPMFormField>
        <BPMFormField label="名稱" name="endpointLabel" required>
          <Input
            onChange={text('label')}
            placeholder="例如 CRM 建立名單"
            value={draft.label}
            inputProps={{ autoComplete: 'off' }}
            variant="base"
          />
        </BPMFormField>
        <BPMFormField label="說明" name="endpointDescription">
          <Textarea
            onChange={text('description')}
            rows={2}
            value={draft.description}
          />
        </BPMFormField>
        <BPMFormField label="URL" name="endpointUrl" required>
          <Input
            onChange={text('url')}
            placeholder="https://"
            value={draft.url}
            inputProps={{ autoComplete: 'off' }}
            variant="base"
          />
        </BPMFormField>
        <BPMFormField label="Method" name="endpointMethod" required>
          <Select
            clearable={false}
            onChange={(option): void =>
              update({ method: option?.id ?? 'POST' })
            }
            options={[...METHOD_OPTIONS]}
            value={
              METHOD_OPTIONS.find((option) => option.id === draft.method) ??
              null
            }
          />
        </BPMFormField>
        <BPMFormField
          hintText="留空使用預設 10 秒，上限 30000 毫秒。"
          label="逾時（毫秒）"
          name="endpointTimeout"
        >
          <Input
            inputProps={{ autoComplete: 'off', inputMode: 'numeric' }}
            onChange={text('timeoutMs')}
            value={draft.timeoutMs}
            variant="base"
          />
        </BPMFormField>
        <BPMFormField label="不建議使用" name="endpointDeprecated">
          <Toggle
            checked={draft.deprecated}
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              update({ deprecated: event.target.checked })
            }
          />
        </BPMFormField>
        {editing ? null : (
          <BPMFormField
            hintText="選填；設定後 BPM 以 HMAC-SHA256 簽章，儲存後不會再顯示。"
            label="簽章金鑰"
            name="endpointSigningSecret"
          >
            <Input
              onChange={text('signingSecret')}
              placeholder="選填，儲存後不再顯示"
              value={draft.signingSecret}
              inputProps={{ autoComplete: 'new-password' }}
              variant="password"
            />
          </BPMFormField>
        )}

        <Typography variant="label-primary-highlight">Headers</Typography>
        {editing ? (
          <BPMFormField
            hintText={
              originChanged
                ? 'URL 已改到其他主機，必須重新輸入 header（留空代表不帶任何 header）。'
                : '現有 header 的值不會顯示；開啟後以下列內容取代全部 header。'
            }
            label="取代 headers"
            name="endpointReplaceHeaders"
          >
            <Toggle
              checked={replaceHeaders}
              disabled={originChanged}
              onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                update({ replaceHeaders: event.target.checked })
              }
            />
          </BPMFormField>
        ) : null}
        {replaceHeaders
          ? draft.headers.map((header, index): ReactElement => (
              <div key={index} style={HEADER_ROW_STYLE}>
                <Input
                  onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                    updateHeader(index, { name: event.target.value })
                  }
                  placeholder="名稱，例如 Authorization"
                  inputProps={{ autoComplete: 'off' }}
                  value={header.name}
                  variant="base"
                />
                <Input
                  onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                    updateHeader(index, { value: event.target.value })
                  }
                  placeholder="值"
                  value={header.value}
                  inputProps={{ autoComplete: 'new-password' }}
                  variant="password"
                />
                <Button
                  icon={TrashIcon}
                  iconType="icon-only"
                  onClick={(): void =>
                    update({
                      headers: draft.headers.filter(
                        (_header, current) => current !== index,
                      ),
                    })
                  }
                  variant="destructive-text-link"
                >
                  移除 header
                </Button>
              </div>
            ))
          : null}
        {replaceHeaders ? (
          <div>
            <Button
              icon={PlusIcon}
              iconType="leading"
              onClick={(): void =>
                update({ headers: [...draft.headers, { name: '', value: '' }] })
              }
              variant="base-dashed"
            >
              新增 header
            </Button>
          </div>
        ) : null}

        <Typography variant="label-primary-highlight">參數</Typography>
        {draft.parameters.map((parameter, index): ReactElement => (
          <div key={index} style={ROW_STYLE}>
            <Input
              {...(editing ? { readonly: true as const } : {})}
              onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                updateParameter(index, { key: event.target.value })
              }
              placeholder="參數鍵"
              inputProps={{ autoComplete: 'off' }}
              value={parameter.key}
              variant="base"
            />
            <Input
              onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                updateParameter(index, { label: event.target.value })
              }
              placeholder="顯示名稱"
              inputProps={{ autoComplete: 'off' }}
              value={parameter.label}
              variant="base"
            />
            <Select
              clearable={false}
              disabled={editing}
              onChange={(option): void =>
                updateParameter(index, {
                  type: readParameterType(option?.id ?? null),
                })
              }
              options={[...PARAMETER_TYPE_OPTIONS]}
              value={
                PARAMETER_TYPE_OPTIONS.find(
                  (option) => option.id === parameter.type,
                ) ?? null
              }
            />
            <Toggle
              checked={parameter.required}
              disabled={editing}
              label="必填"
              onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                updateParameter(index, { required: event.target.checked })
              }
            />
            <Button
              disabled={editing}
              icon={TrashIcon}
              iconType="icon-only"
              onClick={(): void =>
                update({
                  parameters: draft.parameters.filter(
                    (_parameter, current) => current !== index,
                  ),
                })
              }
              variant="destructive-text-link"
            >
              移除參數
            </Button>
          </div>
        ))}
        {editing ? null : (
          <div>
            <Button
              icon={PlusIcon}
              iconType="leading"
              onClick={(): void =>
                update({
                  parameters: [
                    ...draft.parameters,
                    {
                      description: '',
                      key: '',
                      label: '',
                      required: false,
                      type: 'string',
                    },
                  ],
                })
              }
              variant="base-dashed"
            >
              新增參數
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

function readEditDraft(
  endpoint: WorkflowWebhookManagedEndpointRecord,
  mode: 'edit' | 'version',
): EndpointDraft {
  return {
    deprecated: endpoint.deprecated,
    description: endpoint.description ?? '',
    endpointId: mode === 'edit' ? endpoint.id : null,
    headers: [],
    key: endpoint.key,
    label: endpoint.label,
    method: endpoint.method,
    mode,
    originalUrl: endpoint.url,
    parameters: endpoint.parameters.map((parameter) => ({
      description: parameter.description ?? '',
      key: parameter.key,
      label: parameter.label,
      required: parameter.required,
      type: parameter.type,
    })),
    // A new version starts without credentials: they are not readable.
    replaceHeaders: mode === 'version',
    signingSecret: '',
    timeoutMs: endpoint.timeoutMs ? String(endpoint.timeoutMs) : '',
    url: endpoint.url,
    version: String(
      mode === 'version' ? endpoint.version + 1 : endpoint.version,
    ),
  };
}

function readTestNotice(
  endpoint: WorkflowWebhookManagedEndpointRecord,
  result: WorkflowWebhookEndpointTestResultRecord,
): string {
  if (result.ok) {
    return `測試送出成功：「${endpoint.label}」回應 HTTP ${result.status ?? ''}。`;
  }

  throw new Error(
    `測試送出失敗：「${endpoint.label}」${result.status ? `回應 HTTP ${result.status}` : ''}（${result.errorCode ?? '未知錯誤'}）${result.errorDetail ? `：${result.errorDetail}` : ''}`,
  );
}

function isOriginChanged(draft: EndpointDraft): boolean {
  if (draft.mode !== 'edit') {
    return false;
  }

  const origin = (url: string): string => {
    try {
      return new URL(url.trim()).origin;
    } catch {
      return url.trim();
    }
  };

  return origin(draft.url) !== origin(draft.originalUrl);
}

function readParameterType(id: string | null): NotifyWebhookParameterType {
  return PARAMETER_TYPE_OPTIONS.some((option) => option.id === id)
    ? (id as NotifyWebhookParameterType)
    : 'string';
}

function readErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return '發生未知錯誤';
  }

  const message = error.message;

  if (message.includes('WORKFLOW_WEBHOOK_URL_NOT_ALLOWED')) {
    return 'URL 不在伺服器允許的白名單內。';
  }

  if (message.includes('WORKFLOW_WEBHOOK_ENDPOINT_KEY_CONFLICT')) {
    return '這個 Key 已由程式註冊的端點使用，請換一個。';
  }

  if (message.includes('WORKFLOW_WEBHOOK_ENDPOINT_CONTRACT_CHANGED')) {
    return '參數契約不能修改，請改用「建立新版本」。';
  }

  if (message.includes('WORKFLOW_WEBHOOK_TEST_RATE_LIMITED')) {
    return '測試送出太頻繁，請稍後再試（每 10 秒一次、10 分鐘最多 5 次）。';
  }

  return message;
}
