'use client';

import {
  ChangeEvent,
  CSSProperties,
  ReactElement,
  useEffect,
  useState,
} from 'react';
import { Button, Input, Select, Typography } from '@mezzanine-ui/react';
import { PlusIcon, TrashIcon } from '@mezzanine-ui/icons';
import { FormFieldDefinition } from '@rytass/bpm-core-shared/form';
import {
  NotifyWebhookBindingSource,
  NotifyWebhookTarget,
} from '@rytass/bpm-core-shared/workflow';
import {
  NOTIFY_WEBHOOK_CONTEXT_PATHS,
  NOTIFY_WEBHOOK_TARGET_LIMIT,
  createNotifyWebhookTarget,
  isNotifyWebhookContextPath,
} from '@rytass/bpm-core-shared/workflow-graph';
import { BPMFormField } from '../../../components/bpm-form-field';
import {
  NOTIFY_WEBHOOK_CONTEXT_PATH_LABELS,
  NOTIFY_WEBHOOK_PARAMETER_TYPE_LABELS,
  NotifyWebhookBindingKind,
  NotifyWebhookDesignerEndpoint,
  createNotifyWebhookBindingSource,
  findNotifyWebhookEndpoint,
  readCompatibleFormFields,
  readNotifyWebhookBindingKinds,
  readNotifyWebhookConstantValue,
  readNotifyWebhookEndpointOptionId,
  setNotifyWebhookBinding,
  switchNotifyWebhookEndpoint,
} from './notify-webhook-designer';

export type NotifyWebhookCatalogState = 'loading' | 'ready' | 'unavailable';

type SelectOption = Readonly<{ id: string; name: string }>;

const EDITOR_STYLE: CSSProperties = {
  display: 'grid',
  gap: 'var(--mzn-spacing-gap-base)',
};

const TARGET_STYLE: CSSProperties = {
  borderColor: 'var(--mzn-color-border-neutral)',
  borderRadius: 'var(--mzn-radius-base)',
  borderStyle: 'solid',
  borderWidth: 1,
  display: 'grid',
  gap: 'var(--mzn-spacing-gap-base)',
  padding: 'var(--mzn-spacing-padding-horizontal-base)',
};

const TARGET_HEADER_STYLE: CSSProperties = {
  alignItems: 'center',
  display: 'flex',
  gap: 'var(--mzn-spacing-gap-base)',
  justifyContent: 'space-between',
};

const BINDING_ROW_STYLE: CSSProperties = {
  display: 'grid',
  gap: 'var(--mzn-spacing-gap-base)',
  gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 3fr)',
};

const NONE_OPTION: SelectOption = { id: 'NONE', name: '不傳送' };

const BINDING_KIND_OPTIONS: Readonly<
  Record<NotifyWebhookBindingKind, SelectOption>
> = {
  CONSTANT: { id: 'CONSTANT', name: '固定值' },
  CONTEXT: { id: 'CONTEXT', name: '案件資訊' },
  FIELD: { id: 'FIELD', name: '表單欄位' },
};

const BOOLEAN_OPTIONS: readonly SelectOption[] = [
  { id: 'true', name: '是' },
  { id: 'false', name: '否' },
];

const CONTEXT_PATH_OPTIONS: readonly SelectOption[] =
  NOTIFY_WEBHOOK_CONTEXT_PATHS.map((path) => ({
    id: path,
    name: NOTIFY_WEBHOOK_CONTEXT_PATH_LABELS[path],
  }));

export interface NotifyWebhookTargetsEditorProps {
  /** Every endpoint the catalog lists, deprecated ones included. */
  readonly catalog: readonly NotifyWebhookDesignerEndpoint[];
  readonly catalogState: NotifyWebhookCatalogState;
  /** `null` when no form is bound yet, so fields cannot be picked. */
  readonly formFields: readonly FormFieldDefinition[] | null;
  readonly onChange: (targets: readonly NotifyWebhookTarget[]) => void;
  readonly targets: readonly NotifyWebhookTarget[];
}

/**
 * Edits a NOTIFY node's webhook targets (ADR 18 §3.3). Parameters come from
 * the endpoint catalog, so the author only picks an endpoint and binds each
 * parameter; a URL, header or secret is never shown or entered here.
 */
export function NotifyWebhookTargetsEditor({
  catalog,
  catalogState,
  formFields,
  onChange,
  targets,
}: NotifyWebhookTargetsEditorProps): ReactElement | null {
  const activeEndpoints = catalog.filter((endpoint) => !endpoint.deprecated);

  // A host without webhook endpoints never sees the section; a draft that
  // already has targets keeps it, so they can still be read and removed.
  if (
    !targets.length &&
    (catalogState === 'unavailable' ||
      (catalogState === 'ready' && !activeEndpoints.length))
  ) {
    return null;
  }

  function replaceTarget(index: number, next: NotifyWebhookTarget): void {
    onChange(
      targets.map((target, targetIndex) =>
        targetIndex === index ? next : target,
      ),
    );
  }

  function addTarget(): void {
    const [endpoint] = activeEndpoints;

    if (endpoint) {
      onChange([
        ...targets,
        createNotifyWebhookTarget({
          key: endpoint.key,
          version: endpoint.version,
        }),
      ]);
    }
  }

  return (
    <div style={EDITOR_STYLE}>
      <Typography variant="label-primary-highlight">Webhook</Typography>
      <Typography color="text-neutral" variant="caption">
        知會節點抵達時，將指定的表單欄位或案件資訊送到外部系統。
      </Typography>
      {catalogState === 'loading' ? (
        <Typography color="text-neutral" variant="body">
          正在載入可用的 Webhook 端點…
        </Typography>
      ) : null}
      {catalogState === 'unavailable' ? (
        <Typography color="text-error" variant="body">
          目前無法載入 Webhook 端點，已設定的內容會保留，請稍後重試。
        </Typography>
      ) : null}
      {targets.map((target, index): ReactElement => (
        <NotifyWebhookTargetEditor
          activeEndpoints={activeEndpoints}
          catalog={catalog}
          catalogState={catalogState}
          formFields={formFields}
          index={index}
          key={target.id}
          onChange={(next): void => replaceTarget(index, next)}
          onRemove={(): void =>
            onChange(
              targets.filter((_target, targetIndex) => targetIndex !== index),
            )
          }
          target={target}
        />
      ))}
      <div>
        <Button
          disabled={
            catalogState !== 'ready' ||
            !activeEndpoints.length ||
            targets.length >= NOTIFY_WEBHOOK_TARGET_LIMIT
          }
          icon={PlusIcon}
          iconType="leading"
          onClick={addTarget}
          variant="base-dashed"
        >
          新增 Webhook
        </Button>
      </div>
      {targets.length >= NOTIFY_WEBHOOK_TARGET_LIMIT ? (
        <Typography color="text-neutral" variant="caption">
          每個知會節點最多 {NOTIFY_WEBHOOK_TARGET_LIMIT} 個 Webhook。
        </Typography>
      ) : null}
    </div>
  );
}

function NotifyWebhookTargetEditor({
  activeEndpoints,
  catalog,
  catalogState,
  formFields,
  index,
  onChange,
  onRemove,
  target,
}: {
  readonly activeEndpoints: readonly NotifyWebhookDesignerEndpoint[];
  readonly catalog: readonly NotifyWebhookDesignerEndpoint[];
  readonly catalogState: NotifyWebhookCatalogState;
  readonly formFields: readonly FormFieldDefinition[] | null;
  readonly index: number;
  readonly onChange: (target: NotifyWebhookTarget) => void;
  readonly onRemove: () => void;
  readonly target: NotifyWebhookTarget;
}): ReactElement {
  const endpoint = findNotifyWebhookEndpoint(catalog, target.endpoint);
  const currentOptionId = readNotifyWebhookEndpointOptionId(target.endpoint);
  const endpointOptions: readonly SelectOption[] = [
    ...activeEndpoints.map((candidate) => ({
      id: readNotifyWebhookEndpointOptionId(candidate),
      name: readEndpointOptionName(candidate),
    })),
    // Kept selectable-as-shown so a deprecated, disabled or removed endpoint
    // is named rather than the Select silently looking empty.
    ...(endpoint && !endpoint.deprecated
      ? []
      : [
          {
            id: currentOptionId,
            name: endpoint
              ? readEndpointOptionName(endpoint)
              : `${currentOptionId}（找不到端點）`,
          },
        ]),
  ];
  const declaredKeys = new Set(
    (endpoint?.parameters ?? []).map((parameter) => parameter.key),
  );
  const undeclaredBindings = endpoint
    ? target.bindings.filter((binding) => !declaredKeys.has(binding.parameter))
    : [];

  return (
    <div style={TARGET_STYLE}>
      <div style={TARGET_HEADER_STYLE}>
        <Typography variant="label-primary">
          第 {index + 1} 個 Webhook
        </Typography>
        <Button
          icon={TrashIcon}
          iconType="leading"
          onClick={onRemove}
          variant="destructive-text-link"
        >
          移除
        </Button>
      </div>
      <BPMFormField label="端點" name={`webhookEndpoint-${target.id}`} required>
        <Select
          clearable={false}
          disabled={catalogState !== 'ready'}
          onChange={(option): void => {
            const next = activeEndpoints.find(
              (candidate) =>
                readNotifyWebhookEndpointOptionId(candidate) === option?.id,
            );

            if (next) {
              onChange(
                switchNotifyWebhookEndpoint(target, next, formFields ?? []),
              );
            }
          }}
          options={[...endpointOptions]}
          placeholder="選擇端點"
          value={
            endpointOptions.find((option) => option.id === currentOptionId) ??
            null
          }
        />
      </BPMFormField>
      {catalogState === 'ready' && !endpoint ? (
        <Typography color="text-warning" variant="body">
          找不到這個端點，設定會保留；請改選其他端點或移除，否則無法發布。
        </Typography>
      ) : null}
      {endpoint?.disabled ? (
        <Typography color="text-warning" variant="body">
          這個端點已被管理者停用，不會再送出；設定會保留，請改選其他端點，否則無法發布。
        </Typography>
      ) : endpoint?.deprecated ? (
        <Typography color="text-warning" variant="body">
          這個端點不建議再使用，設定會保留；請改選其他端點，否則無法發布。
        </Typography>
      ) : null}
      {endpoint?.description ? (
        <Typography color="text-neutral" variant="caption">
          {endpoint.description}
        </Typography>
      ) : null}
      {endpoint && !endpoint.parameters.length ? (
        <Typography color="text-neutral" variant="caption">
          這個端點不需要參數。
        </Typography>
      ) : null}
      {(endpoint?.parameters ?? []).map((parameter): ReactElement => (
        <NotifyWebhookBindingEditor
          formFields={formFields}
          key={parameter.key}
          onChange={(from): void =>
            onChange(setNotifyWebhookBinding(target, parameter.key, from))
          }
          parameter={parameter}
          source={
            target.bindings.find(
              (binding) => binding.parameter === parameter.key,
            )?.from ?? null
          }
          targetId={target.id}
        />
      ))}
      {undeclaredBindings.map((binding): ReactElement => (
        <div key={binding.parameter} style={TARGET_HEADER_STYLE}>
          <Typography color="text-warning" variant="body">
            參數「{binding.parameter}」已不在端點定義中。
          </Typography>
          <Button
            onClick={(): void =>
              onChange(setNotifyWebhookBinding(target, binding.parameter, null))
            }
            variant="base-text-link"
          >
            移除設定
          </Button>
        </div>
      ))}
    </div>
  );
}

function NotifyWebhookBindingEditor({
  formFields,
  onChange,
  parameter,
  source,
  targetId,
}: {
  readonly formFields: readonly FormFieldDefinition[] | null;
  readonly onChange: (from: NotifyWebhookBindingSource | null) => void;
  readonly parameter: NotifyWebhookDesignerEndpoint['parameters'][number];
  readonly source: NotifyWebhookBindingSource | null;
  readonly targetId: string;
}): ReactElement {
  // Picking a form field with none to pick would store an empty key, which
  // the structural check refuses even for a draft; so the source is only
  // offered when there is a field that fits (or it is already the source).
  const canBindField =
    source?.kind === 'FIELD' ||
    readCompatibleFormFields(formFields ?? [], parameter.type).length > 0;
  const kindOptions: readonly SelectOption[] = [
    ...(parameter.required ? [] : [NONE_OPTION]),
    ...readNotifyWebhookBindingKinds(parameter.type)
      .filter((kind) => kind !== 'FIELD' || canBindField)
      .map((kind) => BINDING_KIND_OPTIONS[kind]),
  ];
  const typeLabel = NOTIFY_WEBHOOK_PARAMETER_TYPE_LABELS[parameter.type];

  return (
    <BPMFormField
      hintText={[parameter.key, typeLabel, parameter.description]
        .filter(Boolean)
        .join(' · ')}
      label={parameter.label}
      name={`webhookBinding-${targetId}-${parameter.key}`}
      required={parameter.required}
    >
      <div style={BINDING_ROW_STYLE}>
        <Select
          clearable={false}
          onChange={(option): void => {
            const kind = readBindingKind(option?.id ?? null);

            onChange(
              kind
                ? createNotifyWebhookBindingSource(
                    kind,
                    parameter,
                    formFields ?? [],
                  )
                : null,
            );
          }}
          options={[...kindOptions]}
          placeholder="選擇來源"
          value={
            source
              ? BINDING_KIND_OPTIONS[source.kind]
              : parameter.required
                ? null
                : NONE_OPTION
          }
        />
        {source ? (
          <NotifyWebhookBindingValue
            formFields={formFields}
            onChange={onChange}
            parameter={parameter}
            source={source}
          />
        ) : null}
      </div>
    </BPMFormField>
  );
}

function NotifyWebhookBindingValue({
  formFields,
  onChange,
  parameter,
  source,
}: {
  readonly formFields: readonly FormFieldDefinition[] | null;
  readonly onChange: (from: NotifyWebhookBindingSource) => void;
  readonly parameter: NotifyWebhookDesignerEndpoint['parameters'][number];
  readonly source: NotifyWebhookBindingSource;
}): ReactElement {
  if (source.kind === 'FIELD') {
    if (!formFields) {
      return (
        <Typography color="text-neutral" variant="caption">
          請先綁定表單版本，才能選擇表單欄位。
        </Typography>
      );
    }

    const compatibleOptions: readonly SelectOption[] = readCompatibleFormFields(
      formFields,
      parameter.type,
    ).map((field) => ({
      id: field.fieldKey,
      name: `${field.label}（${field.fieldKey}）`,
    }));
    // A key the form no longer offers (removed, or retyped) stays visible
    // instead of the Select looking unset.
    const fieldOptions: readonly SelectOption[] =
      source.fieldKey &&
      !compatibleOptions.some((option) => option.id === source.fieldKey)
        ? [
            ...compatibleOptions,
            {
              id: source.fieldKey,
              name: `${source.fieldKey}（找不到相容欄位）`,
            },
          ]
        : compatibleOptions;

    return (
      <Select
        clearable={false}
        onChange={(option): void =>
          onChange({ fieldKey: option?.id ?? '', kind: 'FIELD' })
        }
        options={[...fieldOptions]}
        placeholder={
          fieldOptions.length ? '選擇表單欄位' : '沒有型別相容的欄位'
        }
        value={
          fieldOptions.find((option) => option.id === source.fieldKey) ?? null
        }
      />
    );
  }

  if (source.kind === 'CONTEXT') {
    return (
      <Select
        clearable={false}
        onChange={(option): void => {
          if (isNotifyWebhookContextPath(option?.id)) {
            onChange({ kind: 'CONTEXT', path: option.id });
          }
        }}
        options={[...CONTEXT_PATH_OPTIONS]}
        value={
          CONTEXT_PATH_OPTIONS.find((option) => option.id === source.path) ??
          null
        }
      />
    );
  }

  if (parameter.type === 'boolean') {
    return (
      <Select
        clearable={false}
        onChange={(option): void =>
          onChange({ kind: 'CONSTANT', value: option?.id === 'true' })
        }
        options={[...BOOLEAN_OPTIONS]}
        value={
          typeof source.value === 'boolean'
            ? (BOOLEAN_OPTIONS.find(
                (option) => option.id === String(source.value),
              ) ?? null)
            : null
        }
      />
    );
  }

  return (
    <NotifyWebhookConstantInput
      onChange={(value): void => onChange({ kind: 'CONSTANT', value })}
      type={parameter.type}
      value={source.value}
    />
  );
}

/**
 * Keeps what was typed, not what it parses to: Mezzanine's `Input` is
 * controlled, so writing `1.` back as `1` would eat the decimal point while
 * the author is still typing `1.5`.
 */
function NotifyWebhookConstantInput({
  onChange,
  type,
  value,
}: {
  readonly onChange: (value: boolean | number | string | null) => void;
  readonly type: NotifyWebhookDesignerEndpoint['parameters'][number]['type'];
  readonly value: boolean | number | string | null;
}): ReactElement {
  const [text, setText] = useState(value === null ? '' : String(value));

  // Follow a value changed from outside (another endpoint, the assistant),
  // but never overwrite text that already parses to the current value.
  useEffect((): void => {
    setText((current) =>
      readNotifyWebhookConstantValue(type, current) === value
        ? current
        : value === null
          ? ''
          : String(value),
    );
  }, [type, value]);

  return (
    <Input
      inputProps={{ inputMode: type === 'number' ? 'decimal' : undefined }}
      onChange={(event: ChangeEvent<HTMLInputElement>): void => {
        setText(event.target.value);
        onChange(readNotifyWebhookConstantValue(type, event.target.value));
      }}
      placeholder={type === 'number' ? '輸入數字' : '輸入固定值'}
      value={text}
      variant="base"
    />
  );
}

function readEndpointOptionName(
  endpoint: NotifyWebhookDesignerEndpoint,
): string {
  const notes = [
    `v${endpoint.version}`,
    ...(endpoint.source === 'DATABASE' ? ['後台維護'] : []),
    ...(endpoint.disabled
      ? ['已停用']
      : endpoint.deprecated
        ? ['不建議使用']
        : []),
  ];

  return `${endpoint.label}（${notes.join('，')}）`;
}

function readBindingKind(id: string | null): NotifyWebhookBindingKind | null {
  return id === 'FIELD' || id === 'CONSTANT' || id === 'CONTEXT' ? id : null;
}
